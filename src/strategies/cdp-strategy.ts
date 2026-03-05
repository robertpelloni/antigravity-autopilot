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

    private lastBumpAt = 0;
    private lastActivityAt = Date.now();
    private lastReconnectAttemptAt = 0;
    private lastStopSignalSkipLogAt = 0;
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
     * Send a raw CDP command for bump input/submit.
     * Default behavior targets only the primary connected page to avoid cross-window fan-out.
     * Set antigravity.automation.bump.broadcastToAllPages=true to opt into legacy broadcast behavior.
     */
    private async sendBumpInputCommand(method: string, params: any = {}, targetPageIds?: string[]): Promise<string[]> {
        const results: string[] = [];
        const handler = this.cdpHandler as any;
        if (!handler.connections) return ['no-connections'];
        if (handler.connections.size === 0) return ['no-connections'];

        const resolvedTargets = Array.isArray(targetPageIds)
            ? targetPageIds.filter((id) => typeof id === 'string' && id.length > 0)
            : this.getConfiguredBumpTargetPageIds();

        if (resolvedTargets.length === 0) return ['no-connections'];

        for (const pageId of resolvedTargets) {
            try {
                await handler.sendCommand(pageId, method, params);
                results.push('ok:' + pageId.substring(0, 8));
            } catch (e: any) {
                results.push('err:' + (e?.message || e));
            }
        }
        return results;
    }

    private getConfiguredBumpTargetPageIds(): string[] {
        const handler = this.cdpHandler as any;
        if (!handler?.connections || handler.connections.size === 0) return [];

        const broadcastToAll = config.get<boolean>('automation.bump.broadcastToAllPages') === true;
        if (broadcastToAll) {
            const all: string[] = [];
            for (const [pageId] of handler.connections) {
                all.push(pageId);
            }
            return all;
        }

        if (typeof handler.getPrimaryConnectedPageId === 'function') {
            const primary = handler.getPrimaryConnectedPageId();
            if (primary) return [primary];
        }

        const fallback = handler.connections.keys().next();
        return (!fallback.done && fallback.value) ? [fallback.value as string] : [];
    }

    private async hasCompleteStopSignalOnPage(pageId: string): Promise<{ ready: boolean; reason: string }> {
        if (!pageId) return { ready: false, reason: 'missing-page-id' };

        const expression = `(() => {
            const state = window.__antigravityRuntimeState || null;
            if (!state || typeof state !== 'object') {
                return { ready: false, reason: 'runtime-state-missing' };
            }

            const readyToResume = state?.completionWaiting?.readyToResume === true;
            const stopped = state?.stalled === true;
            const completeSignal = state?.completeStopSignal === true;

            const ready = readyToResume && stopped && completeSignal;
            if (ready) {
                return { ready: true, reason: 'runtime-ready-to-resume' };
            }

            if (!stopped) return { ready: false, reason: 'runtime-not-stalled' };
            if (!completeSignal) return { ready: false, reason: 'runtime-missing-stop-signal' };
            return { ready: false, reason: 'runtime-not-ready' };
        })()`;

        const handler = this.cdpHandler as any;
        const conn = handler?.connections?.get?.(pageId);

        const evaluate = async (sessionId?: string): Promise<{ ready: boolean; reason: string } | null> => {
            const result = await handler.sendCommand(pageId, 'Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            }, undefined, sessionId).catch(() => null);

            const value = result?.result?.value;
            if (!value || typeof value.ready !== 'boolean') {
                return null;
            }

            return { ready: value.ready === true, reason: String(value.reason || '') || 'unknown' };
        };

        const main = await evaluate();
        if (main?.ready) {
            return { ready: true, reason: `main:${main.reason}` };
        }

        const mainReason = main?.reason || 'main-unavailable';
        const sessionReasons: string[] = [];

        const sessions: string[] = conn?.sessions ? Array.from(conn.sessions) : [];
        for (const sessionId of sessions) {
            const sessionResult = await evaluate(sessionId);
            if (sessionResult?.ready) {
                return { ready: true, reason: `session:${sessionResult.reason}` };
            }
            sessionReasons.push(`${sessionId.substring(0, 8)}:${sessionResult?.reason || 'session-unavailable'}`);
        }

        return {
            ready: false,
            reason: sessionReasons.length > 0
                ? `${mainReason}|${sessionReasons.join(',')}`
                : mainReason
        };
    }

    private async getReadyStopSignalTargets(): Promise<{ readyTargets: string[]; skipped: string[] }> {
        const configuredTargets = this.getConfiguredBumpTargetPageIds();
        const readyTargets: string[] = [];
        const skipped: string[] = [];

        for (const pageId of configuredTargets) {
            const signal = await this.hasCompleteStopSignalOnPage(pageId);
            if (signal.ready) {
                readyTargets.push(pageId);
            } else {
                skipped.push(`${pageId.substring(0, 8)}:${signal.reason}`);
            }
        }

        return { readyTargets, skipped };
    }

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.lastActivityAt = Date.now();
        this.lastBumpAt = 0;
        this.updateStatusBar();

        void (async () => { await this.cdpHandler.connect(); })();

        // ─── STATE EVENT: keep activity heartbeat from injected runtime ───
        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader) return;

            const now = Date.now();
            const generating = state?.isGenerating === true;
            const stalled = state?.stalled === true;
            if (generating || !stalled) {
                this.lastActivityAt = now;
            }
        });

        // ─── STALL DETECTION + BUMP ───
        const STALL_MS = 10000;
        const BUMP_COOLDOWN_MS = 30000;

        this.stallTimer = setInterval(async () => {
            const now = Date.now();
            const actAge = now - this.lastActivityAt;
            const bumpAge = now - this.lastBumpAt;
            const connected = this.cdpHandler.isConnected();

            logToOutput(`[TICK] active=${this.isActive} leader=${this.controllerRoleIsLeader} connected=${connected} actAge=${actAge}ms bumpAge=${bumpAge}ms`);

            if (!this.isActive || !this.controllerRoleIsLeader) return;

            // Recover if startup happened before CDP endpoint became available.
            if (!connected) {
                const reconnectCooldownMs = 5000;
                if ((now - this.lastReconnectAttemptAt) >= reconnectCooldownMs) {
                    this.lastReconnectAttemptAt = now;
                    const ok = await this.cdpHandler.connect().catch(() => false);
                    logToOutput(`[CDP] Reconnect attempt => ${ok ? 'connected' : 'no-targets'}`);
                }
                return;
            }

            if (actAge < STALL_MS) return;
            if (bumpAge < BUMP_COOLDOWN_MS) return;

            const { readyTargets, skipped } = await this.getReadyStopSignalTargets();
            if (readyTargets.length === 0) {
                if ((now - this.lastStopSignalSkipLogAt) > 5000) {
                    this.lastStopSignalSkipLogAt = now;
                    logToOutput(`[Bump] Skipped: no complete-stop target windows (${skipped.join(', ') || 'none-ready'}).`);
                }
                return;
            }

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
                const typeResults = await this.sendBumpInputCommand('Input.insertText', { text: BUMP_TEXT }, readyTargets);
                logToOutput('[Bump] Type result: ' + JSON.stringify(typeResults));
                if (typeResults.length === 0 || typeResults.includes('no-connections')) {
                    logToOutput('[Bump] Aborted: no connected CDP targets available for typing.');
                    return;
                }
                await new Promise(r => setTimeout(r, 300));

                // ────────────────────────────────────────
                // STEP 3: Submit via CDP Input.dispatchKeyEvent (Enter)
                // Also browser-level — Monaco processes it like a real Enter press
                // ────────────────────────────────────────
                logToOutput('[Bump] Step 3: CDP Input.dispatchKeyEvent Enter...');
                const enterDown = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                }, readyTargets);
                const enterUp = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                }, readyTargets);
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
