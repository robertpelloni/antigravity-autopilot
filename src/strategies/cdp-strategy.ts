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
    private automationEnabledForWindow = true;

    private lastBumpAt = 0;
    private lastActivityAt = Date.now();
    private lastReconnectAttemptAt = 0;
    private lastStopSignalSkipLogAt = 0;
    private lastBumpTargetPageId: string | null = null;
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

    setWindowAutomationEnabled(enabled: boolean): void {
        this.automationEnabledForWindow = !!enabled;
        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader && this.automationEnabledForWindow);
    }

    isWindowAutomationEnabled(): boolean {
        return this.automationEnabledForWindow;
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

    private getSuccessfulTargetsFromResults(results: string[], targetPageIds: string[]): string[] {
        const successful: string[] = [];
        for (let i = 0; i < results.length && i < targetPageIds.length; i++) {
            const r = String(results[i] || '');
            if (r.startsWith('ok:')) {
                successful.push(targetPageIds[i]);
            }
        }
        return successful;
    }

    private getConfiguredBumpTargetPageIds(): string[] {
        const handler = this.cdpHandler as any;
        if (!handler?.connections || handler.connections.size === 0) return [];

        const broadcastToAll = config.get<boolean>('automation.bump.broadcastToAllPages') === true;
        const all: string[] = [];
        for (const [pageId] of handler.connections) {
            all.push(pageId);
        }

        // Non-broadcast mode still considers all candidates, but later narrows to a single
        // ready target. This avoids getting stuck on an arbitrary "primary" target.
        if (broadcastToAll) {
            return all;
        }

        return all;
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

        const broadcastToAll = config.get<boolean>('automation.bump.broadcastToAllPages') === true;
        if (!broadcastToAll && readyTargets.length > 1) {
            const lastTarget = this.lastBumpTargetPageId;
            const lastIndex = lastTarget ? readyTargets.indexOf(lastTarget) : -1;
            const nextIndex = lastIndex >= 0
                ? (lastIndex + 1) % readyTargets.length
                : 0;
            return { readyTargets: [readyTargets[nextIndex]], skipped };
        }

        return { readyTargets, skipped };
    }

    private async clickSubmitButtonOnPage(pageId: string, expectedText: string): Promise<boolean> {
        const handler = this.cdpHandler as any;
        const conn = handler?.connections?.get?.(pageId);

        const expression = `(() => {
            const expected = ${JSON.stringify(String(expectedText || ''))};
            const normalize = (v) => String(v || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            const isVisible = (el) => {
                if (!el || !el.isConnected || el.disabled) return false;
                const r = el.getBoundingClientRect();
                if (!r || r.width <= 0 || r.height <= 0) return false;
                const s = window.getComputedStyle(el);
                return !(s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none');
            };

            const readComposerText = () => {
                const candidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], .monaco-editor textarea'));
                for (const c of candidates) {
                    if (!isVisible(c)) continue;
                    const raw = (c && (c.value ?? c.textContent)) || '';
                    const txt = normalize(raw);
                    if (txt) return txt;
                }
                return '';
            };

            const composerText = readComposerText();
            const expectedNorm = normalize(expected);
            if (!expectedNorm || !composerText || composerText.indexOf(expectedNorm) < 0) {
                return false;
            }

            const selectors = [
                '[title*="Send" i]',
                '[aria-label*="Send" i]',
                '[title*="Submit" i]',
                '[aria-label*="Submit" i]',
                '[data-testid*="send" i]',
                '[data-testid*="submit" i]',
                'button[type="submit"]',
                '.codicon-send'
            ];
            for (const sel of selectors) {
                const nodes = Array.from(document.querySelectorAll(sel));
                for (const node of nodes) {
                    const el = node.closest?.('button, [role="button"], a, .monaco-button') || node;
                    if (!isVisible(el)) continue;
                    try { if (typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch {}
                    try { el.click(); } catch {}
                    return true;
                }
            }
            return false;
        })()`;

        const evaluate = async (sessionId?: string): Promise<boolean> => {
            const result = await handler.sendCommand(pageId, 'Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            }, undefined, sessionId).catch(() => null);
            return result?.result?.value === true;
        };

        if (await evaluate()) {
            return true;
        }

        const sessions: string[] = conn?.sessions ? Array.from(conn.sessions) : [];
        for (const sessionId of sessions) {
            if (await evaluate(sessionId)) {
                return true;
            }
        }

        return false;
    }

    async start(): Promise<void> {
        if (this.isActive) return;
        this.isActive = true;
        this.lastActivityAt = Date.now();
        this.lastBumpAt = 0;
        this.updateStatusBar();

        this.cdpHandler.setControllerRole(this.controllerRoleIsLeader && this.automationEnabledForWindow);

        void (async () => { await this.cdpHandler.connect(); })();

        // ─── STATE EVENT: keep activity heartbeat from injected runtime ───
        this.cdpHandler.on('state', async ({ state }) => {
            if (!this.isActive || !this.controllerRoleIsLeader || !this.automationEnabledForWindow) return;

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

            if (!this.isActive || !this.controllerRoleIsLeader || !this.automationEnabledForWindow) return;

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
            if (readyTargets.length > 0) {
                this.lastBumpTargetPageId = readyTargets[0];
            }
            logToOutput('[Bump] FIRING — stalled ' + actAge + 'ms, text: "' + BUMP_TEXT + '"');

            try {
                // ────────────────────────────────────────
                // STEP 1: No host-focus stealing
                // Keep fallback fully background-safe; do not pull focus every tick.
                // ────────────────────────────────────────
                logToOutput('[Bump] Step 1: Background-safe bump (skip focus command).');

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
                // STEP 3: Submit via send-button click when available (session-aware)
                // Fallback to Enter only for targets without a clickable send control.
                // ────────────────────────────────────────
                const typedTargets = this.getSuccessfulTargetsFromResults(typeResults, readyTargets);
                if (typedTargets.length === 0) {
                    logToOutput('[Bump] Aborted: no targets confirmed typed bump text.');
                    return;
                }

                const enterFallbackTargets: string[] = [];
                const submitClickedTargets: string[] = [];

                for (const pageId of typedTargets) {
                    const clicked = await this.clickSubmitButtonOnPage(pageId, BUMP_TEXT);
                    if (clicked) {
                        submitClickedTargets.push(pageId.substring(0, 8));
                    } else {
                        enterFallbackTargets.push(pageId);
                    }
                }

                logToOutput('[Bump] Submit click result: clicked=' + JSON.stringify(submitClickedTargets) + ' enterFallback=' + JSON.stringify(enterFallbackTargets.map((id) => id.substring(0, 8))));

                if (enterFallbackTargets.length === 0) {
                    logToOutput('[Bump] Done — submit via send button');
                    return;
                }

                logToOutput('[Bump] Step 4: CDP Input.dispatchKeyEvent Enter (fallback)...');
                const enterDown = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                    type: 'keyDown',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                }, enterFallbackTargets);
                const enterUp = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                    type: 'keyUp',
                    key: 'Enter',
                    code: 'Enter',
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                }, enterFallbackTargets);
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
            const windowFlag = this.automationEnabledForWindow ? 'ON' : 'OFF';
            this.statusBarItem.text = `$(check) CDP: ${windowFlag}`;
            this.statusBarItem.tooltip = this.automationEnabledForWindow
                ? 'CDP Strategy Active (current window enabled)'
                : 'CDP Strategy Active (current window automation disabled)';
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
    async getRuntimeState(): Promise<CDPRuntimeState> {
        const runtime = await this.cdpHandler.executeInFirstTruthySession('window.__antigravityGetState ? window.__antigravityGetState() : null', true).catch(() => null);
        return runtime || {};
    }
    async getDashboardSnapshot(): Promise<any> {
        const tracked = this.cdpHandler.getTrackedSessions();
        const primary = tracked.length > 0 ? tracked[0] : null;
        const runtime = await this.cdpHandler.executeInFirstTruthySession('window.__antigravityGetState ? window.__antigravityGetState() : null', true).catch(() => null);

        return {
            cdp: {
                port: config.get<number>('cdpPort') || 9222,
                connected: this.cdpHandler.isConnected(),
                connectionCount: tracked.length,
                primaryWindow: primary ? {
                    id: String(primary.id || '').substring(0, 8),
                    title: primary.title || 'Untitled',
                    url: primary.url || ''
                } : null,
                windows: tracked.map((s) => ({
                    id: String(s.id || '').substring(0, 8),
                    title: s.title || 'Untitled',
                    url: s.url || ''
                }))
            },
            windowControl: {
                enabled: this.automationEnabledForWindow,
                effectiveLeader: this.controllerRoleIsLeader && this.automationEnabledForWindow,
                controllerRoleIsLeader: this.controllerRoleIsLeader
            },
            runtime: runtime || null
        };
    }
    async executeAction(action: string): Promise<void> { }
    async sendHybridBump(message: string): Promise<boolean> { return true; }
    async sendInputSubmitFallback(): Promise<boolean> { return true; }
    async testMethod(methodName: string, text?: string): Promise<boolean> {
        const method = String(methodName || '').trim().toLowerCase();
        const bumpText = String((text || config.get<string>('actions.bump.text') || 'Proceed')).trim();
        const targetPageIds = this.getConfiguredBumpTargetPageIds();

        if (!method || targetPageIds.length === 0) {
            logToOutput(`[TestMethod] skipped method=${method || 'empty'} reason=no-targets`);
            return false;
        }

        const firstTarget = targetPageIds[0];

        if (method === 'typing:cdp-insert-text') {
            const results = await this.sendBumpInputCommand('Input.insertText', { text: bumpText }, [firstTarget]);
            logToOutput(`[TestMethod] typing:cdp-insert-text => ${JSON.stringify(results)}`);
            return results.some((r) => r.startsWith('ok:'));
        }

        if (method === 'typing:dom-set-input') {
            const expression = `(() => {
                const text = ${JSON.stringify(bumpText)};
                const isVisible = (el) => {
                    if (!el || !el.isConnected || el.disabled) return false;
                    const r = el.getBoundingClientRect();
                    if (!r || r.width <= 0 || r.height <= 0) return false;
                    const s = window.getComputedStyle(el);
                    return !(s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none');
                };
                const candidates = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"], .monaco-editor textarea'));
                for (const c of candidates) {
                    if (!isVisible(c)) continue;
                    try { if (typeof c.focus === 'function') c.focus(); } catch {}
                    if (c.isContentEditable || c.getAttribute('contenteditable') === 'true') {
                        try { document.execCommand('selectAll', false, null); } catch {}
                        try { document.execCommand('insertText', false, text); } catch { c.textContent = text; }
                    } else {
                        c.value = text;
                    }
                    c.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    c.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    return true;
                }
                return false;
            })()`;
            const result = await (this.cdpHandler as any).sendCommand(firstTarget, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
            const ok = result?.result?.value === true;
            logToOutput(`[TestMethod] typing:dom-set-input => ${ok}`);
            return ok;
        }

        if (method === 'typing:vscode-fallback') {
            const expression = `(() => {
                const text = ${JSON.stringify(bumpText)};
                const candidates = Array.from(document.querySelectorAll('textarea, .monaco-editor textarea'));
                for (const c of candidates) {
                    if (!c || c.disabled) continue;
                    try { if (typeof c.focus === 'function') c.focus(); } catch {}
                    c.value = '';
                    try { c.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })); } catch {}
                    c.value = text;
                    try { c.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })); } catch {}
                    c.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    return true;
                }
                return false;
            })()`;
            const result = await (this.cdpHandler as any).sendCommand(firstTarget, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
            const ok = result?.result?.value === true;
            logToOutput(`[TestMethod] typing:vscode-fallback => ${ok}`);
            return ok;
        }

        if (method === 'stalled:runtime-stalled'
            || method === 'stalled:waiting-for-chat-message'
            || method === 'stalled:ready-to-resume') {
            const expression = `(() => {
                const s = window.__antigravityRuntimeState || null;
                return {
                    hasRuntime: !!s,
                    stalled: s?.stalled === true,
                    waitingForChatMessage: s?.waitingForChatMessage === true,
                    readyToResume: s?.completionWaiting?.readyToResume === true,
                    completeStopSignal: s?.completeStopSignal === true,
                    status: s?.status || 'unknown'
                };
            })()`;
            const result = await (this.cdpHandler as any).sendCommand(firstTarget, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
            const value = result?.result?.value || null;
            logToOutput(`[TestMethod] ${method} => ${JSON.stringify(value)}`);
            if (!value) return false;
            if (method === 'stalled:runtime-stalled') return value.stalled === true;
            if (method === 'stalled:waiting-for-chat-message') return value.waitingForChatMessage === true;
            return value.readyToResume === true;
        }

        if (method === 'detect:send-button' || method === 'detect:keep-button' || method === 'detect:run-button' || method === 'detect:thumbs-signal') {
            const selectorMap: Record<string, string> = {
                'detect:send-button': '[title*="Send" i], [aria-label*="Send" i], [title*="Submit" i], [aria-label*="Submit" i], [data-testid*="send" i], [data-testid*="submit" i], button[type="submit"], .codicon-send',
                'detect:keep-button': '[title*="Keep" i], [aria-label*="Keep" i], [data-testid*="keep" i], button[title*="Keep" i], button[aria-label*="Keep" i]',
                'detect:run-button': '[title*="Run" i], [aria-label*="Run" i], [data-testid*="run" i], .codicon-play, button[title*="Run in Terminal" i], button[aria-label*="Run in Terminal" i]',
                'detect:thumbs-signal': '.codicon-thumbsup, .codicon-thumbsdown, [class*="thumbsup" i], [class*="thumbsdown" i], [title*="thumbs up" i], [title*="thumbs down" i], [aria-label*="thumbs up" i], [aria-label*="thumbs down" i]'
            };
            const selector = selectorMap[method];
            const expression = `(() => {
                const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
                let visible = 0;
                for (const n of nodes) {
                    const el = n.closest?.('button, [role="button"], a, span, div') || n;
                    if (!el || !el.isConnected) continue;
                    const r = el.getBoundingClientRect();
                    if (!r || r.width <= 0 || r.height <= 0) continue;
                    const s = window.getComputedStyle(el);
                    if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') continue;
                    visible++;
                }
                return { total: nodes.length, visible };
            })()`;
            const result = await (this.cdpHandler as any).sendCommand(firstTarget, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
            const value = result?.result?.value || { total: 0, visible: 0 };
            logToOutput(`[TestMethod] ${method} => ${JSON.stringify(value)}`);
            return Number(value.visible || 0) > 0;
        }

        if (method === 'click:send-dom') {
            const ok = await this.clickSubmitButtonOnPage(firstTarget, bumpText);
            logToOutput(`[TestMethod] click:send-dom => ${ok}`);
            return ok;
        }

        if (method === 'click:enter-key') {
            const down = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
            }, [firstTarget]);
            const up = await this.sendBumpInputCommand('Input.dispatchKeyEvent', {
                type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
            }, [firstTarget]);
            logToOutput(`[TestMethod] click:enter-key => down=${JSON.stringify(down)} up=${JSON.stringify(up)}`);
            return down.some((r) => r.startsWith('ok:')) || up.some((r) => r.startsWith('ok:'));
        }

        if (method === 'click:send-cdp-mouse') {
            const expression = `(() => {
                const selectors = [
                    '[title*="Send" i]','[aria-label*="Send" i]','[title*="Submit" i]','[aria-label*="Submit" i]',
                    '[data-testid*="send" i]','[data-testid*="submit" i]','button[type="submit"]','.codicon-send'
                ];
                for (const sel of selectors) {
                    const node = document.querySelector(sel);
                    const el = node?.closest?.('button, [role="button"], a, .monaco-button') || node;
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    if (!r || r.width <= 0 || r.height <= 0) continue;
                    return { x: Math.floor(r.left + r.width / 2), y: Math.floor(r.top + r.height / 2) };
                }
                return null;
            })()`;
            const coordsResult = await (this.cdpHandler as any).sendCommand(firstTarget, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
            const coords = coordsResult?.result?.value;
            if (!coords || typeof coords.x !== 'number' || typeof coords.y !== 'number') {
                logToOutput('[TestMethod] click:send-cdp-mouse => no-send-coordinates');
                return false;
            }

            const moved = await this.sendBumpInputCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x, y: coords.y, button: 'left', clickCount: 0 }, [firstTarget]);
            const pressed = await this.sendBumpInputCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 }, [firstTarget]);
            const released = await this.sendBumpInputCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 }, [firstTarget]);
            logToOutput(`[TestMethod] click:send-cdp-mouse => move=${JSON.stringify(moved)} down=${JSON.stringify(pressed)} up=${JSON.stringify(released)}`);
            return pressed.some((r) => r.startsWith('ok:')) || released.some((r) => r.startsWith('ok:'));
        }

        logToOutput(`[TestMethod] unknown method=${method}`);
        return false;
    }
}
