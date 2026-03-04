import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { logToOutput } from '../utils/output-channel';

export type CDPRuntimeState = any;

/**
 * v9.1 — THE FIX.
 *
 * WHY EVERYTHING BEFORE FAILED:
 * VS Code chat input is a MONACO EDITOR, not a standard textarea.
 * Monaco's textarea is a hidden input proxy — setting its .value does NOTHING
 * because Monaco's content model lives in the editor, not the DOM textarea.
 *
 * THE METHOD THAT WORKS:
 * 1. Focus chat via VS Code command (guaranteed)
 * 2. CDP Input.insertText — browser-level input, Monaco handles it like real typing
 * 3. CDP Input.dispatchKeyEvent Enter — browser-level, Monaco handles it like real Enter
 *
 * No DOM traversal. No textarea finding. No native setters. No React workarounds.
 * Just: focus → type → enter. Like a human.
 */
export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;
    private cdpHandler: CDPHandler;
    private statusBarItem: vscode.StatusBarItem;
    private context: vscode.ExtensionContext;
    private controllerRoleIsLeader = false;

    private lastClickAt = 0;
    private lastBumpAt = 0;
    private lastActivityAt = Date.now();
    private wasGenerating = false;
    private stallTimer: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        const { cdpClient } = require('../providers/cdp-client');
        this.cdpHandler = cdpClient.getHandler();
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9999);
        this.statusBarItem.command = 'antigravity.toggleAutoAccept';
        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader);
    }

    setControllerRole(isLeader: boolean): void {
        this.controllerRoleIsLeader = !!isLeader;
        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader);
    }

    setHostWindowFocused(focused: boolean): void {
        this.cdpHandler.setHostWindowFocused(!!focused);
    }

    /**
     * Send a raw CDP command to ALL connected pages (main page context only).
     * Used for Input domain commands (insertText, dispatchKeyEvent).
     */
    private async sendToAllPages(method: string, params: any = {}): Promise<string[]> {
        const results: string[] = [];
        // Access connections via the handler's public sendCommand
        // We need to get page IDs — use getPrimaryConnectedPageId or iterate
        const handler = this.cdpHandler as any;
        if (!handler.connections) return ['no-connections'];

        for (const [pageId] of handler.connections) {
            try {
                await handler.sendCommand(pageId, method, params);
                results.push('ok:' + pageId.substring(0, 8));
            } catch (e: any) {
                results.push('err:' + (e?.message || e));
            }
        }
        return results;
    }

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.lastActivityAt = Date.now();
        this.lastClickAt = 0;
        this.lastBumpAt = 0;
        this.updateStatusBar();

        void (async () => { await this.cdpHandler.connect(); })();

        // ─── STATE EVENT: detect buttons and click them ───
        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const isGenerating = state.isGenerating;
            const buttons: string[] = state.buttons || [];

            logToOutput('[State] Gen: ' + isGenerating + ', Buttons: ' + buttons.join(', '));

            if (isGenerating) {
                this.wasGenerating = true;
                this.lastActivityAt = now;
            } else if (this.wasGenerating) {
                this.wasGenerating = false;
                this.lastActivityAt = now;
            }

            // Button click throttle: 2s
            if (now - this.lastClickAt < 2000) return;

            const enabled = !!config.get<boolean>('autopilotAutoAcceptEnabled')
                || !!config.get<boolean>('autoAllEnabled')
                || !!config.get<boolean>('autoAcceptEnabled');

            if (!enabled || buttons.length === 0 || isGenerating) return;

            const btnPriority = ['run', 'expand', 'allow', 'accept_all', 'keep', 'retry', 'continue'];
            let targetBtn: string | null = null;
            for (const b of btnPriority) {
                if (buttons.includes(b)) { targetBtn = b; break; }
            }
            if (!targetBtn) return;

            this.lastClickAt = now;
            this.lastActivityAt = now;

            const textMap: Record<string, string[]> = {
                run: ['run', 'run tool'],
                expand: ['expand', 'requires input'],
                allow: ['allow', 'always allow'],
                accept_all: ['accept all', 'apply all'],
                keep: ['keep'],
                retry: ['retry'],
                continue: ['continue'],
            };
            const matchTexts = textMap[targetBtn] || [targetBtn];

            logToOutput('[Click] ' + targetBtn);

            // Button click via CDP Runtime.evaluate (DOM injection — proven working for buttons)
            const clickScript = `(() => {
                var mt = ${JSON.stringify(matchTexts)};
                function qsa(sel, root) {
                    root = root || document;
                    var r = [];
                    try { r = Array.from(root.querySelectorAll(sel)); } catch(e) {}
                    try {
                        var all = root.querySelectorAll('*');
                        for (var i = 0; i < all.length; i++) {
                            try { if (all[i].shadowRoot) r = r.concat(qsa(sel, all[i].shadowRoot)); } catch(e) {}
                        }
                    } catch(e) {}
                    return r;
                }
                var btns = qsa('button, [role="button"], .monaco-button');
                for (var i = 0; i < btns.length; i++) {
                    var b = btns[i];
                    if (!b.isConnected || b.disabled || (b.clientWidth === 0 && b.clientHeight === 0)) continue;
                    var t = (b.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                    var a = (b.getAttribute('aria-label') || '').toLowerCase();
                    var ti = (b.getAttribute('title') || '').toLowerCase();
                    for (var m = 0; m < mt.length; m++) {
                        if (t === mt[m] || a === mt[m] || ti === mt[m] || t.indexOf(mt[m]) >= 0) {
                            b.click();
                            return 'clicked:' + t;
                        }
                    }
                }
                return 'not-found';
            })()`;

            const r = await this.cdpHandler.executeInAllSessions(clickScript).catch(() => null);
            logToOutput('[Click] => ' + JSON.stringify(r));
        });

        // ─── STALL DETECTION + BUMP ───
        const STALL_MS = 10000;
        const BUMP_COOLDOWN_MS = 30000;

        this.stallTimer = setInterval(async () => {
            const now = Date.now();
            const actAge = now - this.lastActivityAt;
            const bumpAge = now - this.lastBumpAt;

            logToOutput(`[TICK] active=${this.isActive} leader=${this.controllerRoleIsLeader} actAge=${actAge}ms bumpAge=${bumpAge}ms`);

            if (!this.isActive || !this.controllerRoleIsLeader) return;
            if (actAge < STALL_MS) return;
            if (bumpAge < BUMP_COOLDOWN_MS) return;

            const BUMP_TEXT = config.get<string>('actions.bump.text') || 'Proceed';

            this.lastBumpAt = now;
            this.lastActivityAt = now;
            logToOutput('[Bump] FIRING — stalled ' + actAge + 'ms, text: "' + BUMP_TEXT + '"');

            try {
                // ────────────────────────────────────────
                // STEP 1: Focus chat via VS Code command
                // This guarantees the Monaco chat input has keyboard focus
                // ────────────────────────────────────────
                logToOutput('[Bump] Step 1: Focus chat panel...');
                try {
                    await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                } catch {
                    try { await vscode.commands.executeCommand('workbench.action.chat.open'); } catch { }
                }
                await new Promise(r => setTimeout(r, 500));

                // ────────────────────────────────────────
                // STEP 2: Type text via CDP Input.insertText
                // This is BROWSER-LEVEL input — Monaco sees it as real keyboard typing
                // No DOM manipulation, no textarea.value, no native setters
                // ────────────────────────────────────────
                logToOutput('[Bump] Step 2: CDP Input.insertText "' + BUMP_TEXT + '"...');
                const typeResults = await this.sendToAllPages('Input.insertText', { text: BUMP_TEXT });
                logToOutput('[Bump] Type result: ' + JSON.stringify(typeResults));
                await new Promise(r => setTimeout(r, 300));

                // ────────────────────────────────────────
                // STEP 3: Submit via CDP Input.dispatchKeyEvent (Enter)
                // Also browser-level — Monaco processes it like a real Enter press
                // ────────────────────────────────────────
                logToOutput('[Bump] Step 3: CDP Input.dispatchKeyEvent Enter...');
                const enterDown = await this.sendToAllPages('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                });
                const enterUp = await this.sendToAllPages('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                });
                logToOutput('[Bump] Enter result: down=' + JSON.stringify(enterDown) + ' up=' + JSON.stringify(enterUp));

                logToOutput('[Bump] Done — CDP Input domain (browser-level)');
            } catch (e: any) {
                logToOutput('[Bump] ERROR: ' + (e?.message || e));
            }
        }, 3000);

        vscode.window.showInformationMessage('Antigravity: CDP Strategy v9.1 ON');
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;
        if (this.stallTimer) { clearInterval(this.stallTimer); this.stallTimer = null; }
        this.cdpHandler.disconnectAll();
        this.cdpHandler.removeAllListeners('state');
        this.updateStatusBar();
    }

    private updateStatusBar() {
        if (this.isActive) {
            this.statusBarItem.text = '$(check) CDP: ON';
            this.statusBarItem.tooltip = 'CDP Strategy Active';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(circle-slash) CDP: OFF';
            this.statusBarItem.tooltip = 'CDP Strategy Inactive';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        this.statusBarItem.show();
    }

    dispose() { this.stop(); this.statusBarItem.dispose(); }

    // Compatibility stubs
    isConnected(): boolean { return this.cdpHandler.isConnected(); }
    async getRuntimeState(): Promise<CDPRuntimeState> { return {}; }
    async executeAction(action: string): Promise<void> { }
    async sendHybridBump(message: string): Promise<boolean> { return true; }
    async sendInputSubmitFallback(): Promise<boolean> { return true; }
    async testMethod(methodName: string, text?: string): Promise<boolean> { return true; }
}
