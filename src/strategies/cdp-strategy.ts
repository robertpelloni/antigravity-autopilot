import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';
import { logToOutput } from '../utils/output-channel';

export type CDPRuntimeState = any;

/**
 * v9.0 — NUCLEAR REWRITE.
 *
 * THREE concerns, ONE interaction method (CDP executeInAllSessions):
 * 1. Click buttons (Run, Expand, Allow, Accept All, Keep, Retry, Continue)
 * 2. Type + submit bump text (single atomic script — no separate steps)
 * 3. Stall detection (timer-based)
 *
 * KEY FIX: React ignores `textarea.value = x`. Must use the NATIVE setter:
 *   Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text)
 * Then dispatchEvent(new Event('input', {bubbles:true})) to trigger React state.
 *
 * The type+submit is ONE script — no separate steps, no lost focus, no race conditions.
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

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.lastActivityAt = Date.now();
        this.lastClickAt = 0;
        this.lastBumpAt = 0;
        this.updateStatusBar();

        void (async () => { await this.cdpHandler.connect(); })();

        // ─── STATE EVENT HANDLER ───
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

        // ─── STALL TIMER / BUMP ───
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
                // Focus the chat panel first
                try { await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus'); } catch { }
                await new Promise(r => setTimeout(r, 500));

                // SINGLE ATOMIC SCRIPT: find textarea → set value via native setter → dispatch input → dispatch Enter
                // Everything in ONE script execution = no lost focus, no race conditions
                const escaped = BUMP_TEXT.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                const bumpScript = `(() => {
                    try {
                        // Shadow DOM recursive search
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

                        // Find THE chat textarea (exclude search/find/filter)
                        var tas = qsa('textarea');
                        var el = null;
                        for (var i = 0; i < tas.length; i++) {
                            var t = tas[i];
                            if (!t.isConnected || (t.clientWidth === 0 && t.clientHeight === 0)) continue;
                            var a = (t.getAttribute('aria-label') || '').toLowerCase();
                            var p = (t.getAttribute('placeholder') || '').toLowerCase();
                            if (a.indexOf('search') >= 0 || a.indexOf('find') >= 0 || a.indexOf('filter') >= 0) continue;
                            if (p.indexOf('search') >= 0 || p.indexOf('find') >= 0 || p.indexOf('filter') >= 0) continue;
                            el = t;
                            break;
                        }

                        if (!el) return 'no-textarea:' + tas.length;

                        // CRITICAL: Use native value setter — React ignores direct .value assignment
                        el.focus();
                        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                        nativeSetter.call(el, '${escaped}');
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));

                        // Small delay then submit — all in same script context so el reference is stable
                        setTimeout(function() {
                            // Try Enter key dispatch
                            var opts = {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true};
                            el.dispatchEvent(new KeyboardEvent('keydown', opts));
                            el.dispatchEvent(new KeyboardEvent('keypress', opts));
                            el.dispatchEvent(new KeyboardEvent('keyup', opts));

                            // Also try to find and click a send/submit button as fallback
                            var sendBtns = qsa('button, [role="button"]');
                            for (var i = 0; i < sendBtns.length; i++) {
                                var b = sendBtns[i];
                                if (!b.isConnected || b.disabled) continue;
                                var a = (b.getAttribute('aria-label') || '').toLowerCase();
                                var t = (b.getAttribute('title') || '').toLowerCase();
                                if (a === 'send' || a === 'submit' || t === 'send' || t === 'submit' ||
                                    a.indexOf('send message') >= 0 || a.indexOf('send request') >= 0) {
                                    b.click();
                                    break;
                                }
                            }
                        }, 200);

                        return 'typed-native-setter';
                    } catch(e) {
                        return 'error:' + e.message;
                    }
                })()`;

                const result = await this.cdpHandler.executeInAllSessions(bumpScript).catch(() => null);
                logToOutput('[Bump] Result: ' + JSON.stringify(result));
            } catch (e: any) {
                logToOutput('[Bump] ERROR: ' + (e?.message || e));
            }
        }, 3000);

        vscode.window.showInformationMessage('Antigravity: CDP Strategy v9 ON');
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
