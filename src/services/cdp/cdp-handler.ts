import WebSocket from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { config } from '../../utils/config';
import { AUTO_CONTINUE_SCRIPT } from '../../scripts/auto-continue';
import { logToOutput } from '../../utils/output-channel';
import { SoundEffects, ActionSoundGroup } from '../../utils/sound-effects';

export class CDPHandler extends EventEmitter {
    private startPort: number;
    private endPort: number;
    private connections: Map<string, any>;
    private messageId: number;
    private pendingMessages: Map<number, { resolve: Function, reject: Function }>;
    private timeoutMs: number;
    private watchdogInterval: NodeJS.Timeout | null = null;
    private watchdogState: Map<string, { attempts: number; lastAttemptAt: number }> = new Map();
    private recentAutomationSignals: Map<string, number> = new Map();
    private recentActionDispatch: Map<string, number> = new Map();
    private discoveredPort: number | null = null;
    private controllerRoleIsLeader = false;
    private hostWindowFocused = vscode.window.state.focused;
    private connectInFlight: Promise<boolean> | null = null;

    private isSingleTargetMode(): boolean {
        const forceSinglePrimary = config.get<boolean>('automation.forceSinglePrimaryPage');
        if (forceSinglePrimary !== false) {
            return true;
        }

        return !(config.get<boolean>('multiTabEnabled') ?? false);
    }

    private getPrimaryConnectedPageId(): string | null {
        const iterator = this.connections.keys();
        const first = iterator.next();
        return first?.done ? null : (first.value as string);
    }

    private isPrimaryPageEligible(pageId: string): boolean {
        if (!this.shouldInjectAutoContinueRuntime()) {
            return false;
        }

        if (!this.isSingleTargetMode()) {
            return true;
        }

        const primaryPageId = this.getPrimaryConnectedPageId();
        return primaryPageId === pageId;
    }

    private pruneNonPrimaryConnections(): void {
        if (!this.isSingleTargetMode() || this.connections.size <= 1) {
            return;
        }

        const primaryPageId = this.getPrimaryConnectedPageId();
        if (!primaryPageId) {
            return;
        }

        for (const [pageId, conn] of this.connections) {
            if (pageId === primaryPageId) {
                continue;
            }
            try { conn.ws.close(); } catch { }
            this.connections.delete(pageId);
            this.watchdogState.delete(pageId);
        }
    }

    private shouldInjectAutoContinueRuntime(): boolean {
        if (config.get<boolean>('autoContinueScriptEnabled') === false) {
            return false;
        }

        if (this.controllerRoleIsLeader) {
            return true;
        }

        return config.get<boolean>('controller.followerUiAutomationEnabled') ?? false;
    }

    private async pushAutomationConfigToConnection(pageId: string, sessionId?: string): Promise<void> {
        await this.sendCommand(pageId, 'Runtime.evaluate', {
            expression: this.getAutomationConfigExpression(),
            awaitPromise: false
        }, 5000, sessionId).catch(() => { });
    }

    private async stopAutoContinueRuntime(pageId: string, sessionId?: string): Promise<void> {
        await this.sendCommand(pageId, 'Runtime.evaluate', {
            expression: `(() => {
                try {
                    if (typeof window.stopAutoContinue === 'function') {
                        window.stopAutoContinue();
                    }
                    window.__antigravityAutoContinueRunning = false;
                } catch (e) {}
                return true;
            })()`,
            awaitPromise: false
        }, 2000, sessionId).catch(() => { });
    }

    private async syncAutomationRuntimeEligibility(): Promise<void> {
        this.pruneNonPrimaryConnections();

        const shouldInject = this.shouldInjectAutoContinueRuntime();
        const singleTargetMode = this.isSingleTargetMode();
        const primaryPageId = singleTargetMode ? this.getPrimaryConnectedPageId() : null;

        for (const [pageId, conn] of this.connections) {
            const pageEligible = shouldInject && (!singleTargetMode || pageId === primaryPageId);

            await this.pushAutomationConfigToConnection(pageId);
            for (const sessionId of conn.sessions) {
                await this.pushAutomationConfigToConnection(pageId, sessionId);
            }

            if (!pageEligible) {
                await this.stopAutoContinueRuntime(pageId);
                for (const sessionId of conn.sessions) {
                    await this.stopAutoContinueRuntime(pageId, sessionId);
                }
            }
        }
    }

    private isAntigravityHostApp(): boolean {
        try {
            const appName = String((vscode as any)?.env?.appName || '').toLowerCase();
            return appName.includes('antigravity');
        } catch {
            return false;
        }
    }

    constructor(startPort?: number, endPort?: number) {
        super();
        const explicitStart = (typeof startPort === 'number' && Number.isFinite(startPort) && startPort > 0) ? startPort : 0;
        const explicitEnd = (typeof endPort === 'number' && Number.isFinite(endPort) && endPort > 0) ? endPort : explicitStart;

        this.startPort = explicitStart;
        this.endPort = explicitEnd;
        this.connections = new Map();
        this.messageId = 1;
        this.pendingMessages = new Map();
        this.timeoutMs = config.get<number>('cdpTimeout') || 10000;
        if (this.startPort > 0 && this.endPort > 0) {
            logToOutput(`[CDPHandler] Initialized with explicit port range: ${this.startPort}-${this.endPort}`);
        } else {
            logToOutput('[CDPHandler] Initialized in auto-discovery-only mode (no implicit fallback ports).');
        }
        this.startWatchdogLoop();
    }

    setControllerRole(isLeader: boolean): void {
        const next = !!isLeader;
        const changed = this.controllerRoleIsLeader !== next;
        this.controllerRoleIsLeader = next;

        if (!changed || this.connections.size === 0) {
            return;
        }

        this.syncAutomationRuntimeEligibility().catch(() => { });

        logToOutput(`[CDPHandler] Controller role synced to runtime config: ${this.controllerRoleIsLeader ? 'leader' : 'follower'}`);
    }

    setHostWindowFocused(focused: boolean): void {
        const next = !!focused;
        if (this.hostWindowFocused === next) {
            return;
        }

        this.hostWindowFocused = next;
        if (this.connections.size === 0) {
            return;
        }

        this.syncAutomationRuntimeEligibility().catch(() => { });

        logToOutput(`[CDPHandler] Host window focus synced to runtime config: ${this.hostWindowFocused ? 'focused' : 'unfocused'}`);
    }

    /**
     * Auto-discover the actual CDP port using multiple strategies:
     * 1. Internal Antigravity API: vscode.antigravityUnifiedStateSync.BrowserPreferences.getBrowserCdpPort()
     * 2. DevToolsActivePort file in the Antigravity user data directory
    * 3. Optional explicit constructor port (only when caller passes it deliberately)
     */

    async executeInFirstTruthySession(expression: string, returnByValue: boolean = true): Promise<any | null> {
        for (const [pageId, conn] of this.connections) {
            try {
                const mainResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression,
                    returnByValue,
                    awaitPromise: true
                });
                const mainValue = mainResult?.result?.value;
                if (mainValue) {
                    return mainValue;
                }
            } catch {
                // ignore
            }

            for (const sessionId of conn.sessions) {
                try {
                    const sessionResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                        expression,
                        returnByValue,
                        awaitPromise: true
                    }, undefined, sessionId);
                    const sessionValue = sessionResult?.result?.value;
                    if (sessionValue) {
                        return sessionValue;
                    }
                } catch {
                    // ignore
                }
            }
        }

        return null;
    }
    private async autoDiscoverPort(): Promise<number | null> {
        if (!this.isAntigravityHostApp()) {
            logToOutput('[CDPHandler] Skipping Antigravity CDP auto-discovery in non-Antigravity host app.');
            return null;
        }

        // Strategy 1: Use internal Antigravity API (same as chrome-devtools-mcp extension)
        try {
            const vsCodeAny = vscode as any;
            if (vsCodeAny.antigravityUnifiedStateSync?.BrowserPreferences?.getBrowserCdpPort) {
                const port = await vsCodeAny.antigravityUnifiedStateSync.BrowserPreferences.getBrowserCdpPort();
                if (typeof port === 'number' && port > 0) {
                    logToOutput(`[CDPHandler] Auto-discovered CDP port via internal API: ${port}`);
                    return port;
                }
            }
        } catch (e: any) {
            logToOutput(`[CDPHandler] Strategy 1 (internal API getBrowserCdpPort) threw an error: ${e.stack || e.message || e}`);
        }

        // Strategy 2: Read DevToolsActivePort file from Antigravity user data dir
        try {
            const userDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity');
            const portFilePath = path.join(userDataDir, 'DevToolsActivePort');
            if (fs.existsSync(portFilePath)) {
                const content = fs.readFileSync(portFilePath, 'utf8');
                const [rawPort] = content.split('\n').map(l => l.trim()).filter(l => !!l);
                const port = parseInt(rawPort, 10);
                if (!isNaN(port) && port > 0 && port <= 65535) {
                    // Verify the port is actually listening before committing
                    try {
                        await this.getPages(port);
                        logToOutput(`[CDPHandler] Auto-discovered CDP port via DevToolsActivePort: ${port}`);
                        return port;
                    } catch {
                        logToOutput(`[CDPHandler] DevToolsActivePort says ${port} but it's not responding (stale file).`);
                    }
                }
            }
        } catch (e: any) {
            logToOutput(`[CDPHandler] DevToolsActivePort read failed: ${e.message || e}`);
        }

        return null;
    }

    async scanForInstances(): Promise<{ port: number, pages: any[] }[]> {
        const instances = [];
        const portsToCheck = new Set<number>();

        // Auto-discover the real CDP port if not already cached
        if (!this.discoveredPort) {
            this.discoveredPort = await this.autoDiscoverPort();
        }

        // If we auto-discovered a port, use that FIRST (it overrides config)
        if (this.discoveredPort) {
            portsToCheck.add(this.discoveredPort);
        }

        // Recovery fallback: allow explicit configured cdpPort only inside Antigravity host.
        // This is not a hardwired port; it's user-controlled config and only used when discovery is absent.
        if (portsToCheck.size === 0 && this.isAntigravityHostApp()) {
            const configuredPortRaw = config.get<number | string>('cdpPort');
            const configuredPort = typeof configuredPortRaw === 'string' ? parseInt(configuredPortRaw, 10) : configuredPortRaw;
            if (typeof configuredPort === 'number' && Number.isFinite(configuredPort) && configuredPort > 0) {
                portsToCheck.add(configuredPort);
                logToOutput(`[CDPHandler] Auto-discovery unavailable; using explicit configured cdpPort=${configuredPort} (Antigravity host only).`);
            }
        }

        // Optional explicit constructor port range fallback (only if caller supplied it).
        // Suppress this fallback when auto-discovery already yielded a concrete port.
        if (!this.discoveredPort && this.startPort > 0 && this.endPort > 0) {
            for (let p = this.startPort; p <= this.endPort; p++) portsToCheck.add(p);
        }

        logToOutput(`[CDPHandler] Scanning CDP on ports: ${[...portsToCheck].join(', ')}...`);

        for (const port of portsToCheck) {
            try {
                const pages = await this.getPages(port);
                if (pages.length > 0) instances.push({ port, pages });
            } catch (e: any) {
                if (e.code === 'ECONNREFUSED') {
                    // Do NOT clear the discovered port — it may just not be ready yet
                    // (Electron takes a few seconds to start the CDP server after launch)
                    logToOutput(`[CDPHandler] Port ${port} not ready yet (ECONNREFUSED). Will retry.`);
                } else {
                    logToOutput(`[CDPHandler] Error scanning port ${port}: ${e.message || e}`);
                }
            }
        }
        return instances;
    }

    async diagnose(): Promise<string> {
        const instances = await this.scanForInstances();
        let report = `CDP Diagnostic Report (${new Date().toISOString()})\n`;
        report += `Scanning port: ${this.startPort}${this.startPort !== this.endPort ? '-' + this.endPort : ''}\n\n`;

        if (instances.length === 0) {
            report += 'No active CDP instances found.\n';
            report += `Ensure your editor is launched with --remote-debugging-port=${this.startPort}.\n`;
            return report;
        }

        for (const instance of instances) {
            report += `Port ${instance.port}:\n`;
            for (const page of instance.pages) {
                let hasFocus = false;
                try {
                    // Try to check focus if we can connect briefly or if we are already connected
                    const conn = this.connections.get(page.id);
                    if (conn) {
                        const result = await this.sendCommand(page.id, 'Runtime.evaluate', {
                            expression: 'document.hasFocus()',
                            returnByValue: true
                        }, 1000);
                        hasFocus = result?.result?.value === true;
                    }
                } catch (e) { }

                report += `  - [${page.type}] ${page.title || 'No Title'}\n`;
                report += `    URL: ${page.url}\n`;
                report += `    WebSocket: ${page.webSocketDebuggerUrl}\n`;
                report += `    Connected: ${this.connections.has(page.id) ? 'YES' : 'NO'}\n`;
                report += `    Focused: ${hasFocus ? 'YES' : 'NO/Unknown'}\n`;
                report += '\n';
            }
        }
        return report;
    }

    private isAntigravityPageTarget(p: any): boolean {
        if (!p || typeof p !== 'object') return false;
        if (!p.webSocketDebuggerUrl) return false;
        if (p.type !== 'page') return false;

        const title = String(p.title || '').toLowerCase();
        const url = String(p.url || '').toLowerCase();

        const antigravityMarkers = [
            'antigravity',
            '/programs/antigravity/',
            '\\programs\\antigravity\\',
            '/roaming/antigravity/',
            '\\roaming\\antigravity\\'
        ];

        const hasAntigravityMarker = antigravityMarkers.some(marker => title.includes(marker) || url.includes(marker));
        if (!hasAntigravityMarker) return false;

        const foreignMarkers = ['visual studio code', 'vscode insiders', 'cursor'];
        const appearsForeign = foreignMarkers.some(marker => title.includes(marker) || url.includes(marker));
        if (appearsForeign && !title.includes('antigravity') && !url.includes('antigravity')) {
            return false;
        }

        return true;
    }

    getPages(port: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 500 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(data);
                        const filtered = pages.filter((p: any) => this.isAntigravityPageTarget(p));

                        if (filtered.length === 0) {
                            logToOutput(`[CDPHandler] Port ${port} returned ${pages.length} raw targets. Antigravity page targets: 0.`);
                            if (pages.length > 0) {
                                logToOutput(`[CDPHandler] First raw target on port ${port}: ${JSON.stringify(pages[0])}`);
                            }
                        }
                        resolve(filtered);
                    } catch (e: any) {
                        logToOutput(`[CDPHandler] Error parsing JSON list from port ${port}: ${e.message || e}`);
                        reject(e);
                    }
                });
            });
            req.on('error', (e: any) => {
                // Suppress ECONNREFUSED noise since it just means the port isn't active
                if (e.code !== 'ECONNREFUSED') {
                    logToOutput(`[CDPHandler] Network error while scanning port ${port}: ${e.message || e}`);
                }
                reject(e);
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('timeout'));
            });
        });
    }

    private getAutomationConfigExpression(): string {
        const getArr = (key: string, defItems: string[]) => {
            const val = config.get<string[]>(key);
            if (!val || val.length === 0) return defItems;
            return val;
        };

        const automationConfig = {
            clickRun: config.get<boolean>('automation.actions.clickRun') ?? true,
            clickExpand: config.get<boolean>('automation.actions.clickExpand') ?? true,
            clickAccept: config.get<boolean>('automation.actions.clickAccept') ?? true,
            clickAcceptAll: config.get<boolean>('automation.actions.clickAcceptAll') ?? true,
            clickContinue: config.get<boolean>('automation.actions.clickContinue') ?? true,
            clickSubmit: config.get<boolean>('automation.actions.clickSubmit') ?? false,
            clickFeedback: config.get<boolean>('automation.actions.clickFeedback') ?? false,
            autoScroll: config.get<boolean>('automation.actions.autoScroll') ?? true,
            autoReply: config.get<boolean>('automation.actions.autoReply') ?? true,
            controls: {
                run: {
                    detectMethods: getArr('automation.controls.run.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.run.actionMethods', ['dom-click', 'native-click']),
                    delayMs: config.get<number>('automation.controls.run.delayMs') ?? 100
                },
                expand: {
                    detectMethods: getArr('automation.controls.expand.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.expand.actionMethods', ['dom-click', 'native-click']),
                    delayMs: config.get<number>('automation.controls.expand.delayMs') ?? 50
                },
                accept: {
                    detectMethods: getArr('automation.controls.accept.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.accept.actionMethods', ['accept-all-first', 'accept-single', 'dom-click']),
                    delayMs: config.get<number>('automation.controls.accept.delayMs') ?? 100
                },
                submit: {
                    detectMethods: getArr('automation.controls.submit.detectMethods', ['enabled-flag', 'not-generating']),
                    actionMethods: getArr('automation.controls.submit.actionMethods', ['click-send', 'enter-key']),
                    delayMs: config.get<number>('automation.controls.submit.delayMs') ?? 100
                },
                acceptAll: {
                    detectMethods: getArr('automation.controls.acceptAll.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.acceptAll.actionMethods', ['accept-all-button', 'keep-button', 'allow-all-button', 'dom-click']),
                    delayMs: config.get<number>('automation.controls.acceptAll.delayMs') ?? 100
                },
                continue: {
                    detectMethods: getArr('automation.controls.continue.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.continue.actionMethods', ['continue-button', 'keep-button', 'dom-click']),
                    delayMs: config.get<number>('automation.controls.continue.delayMs') ?? 100
                },
                feedback: {
                    detectMethods: getArr('automation.controls.feedback.detectMethods', ['enabled-flag', 'not-generating', 'action-cooldown']),
                    actionMethods: getArr('automation.controls.feedback.actionMethods', ['thumbs-up', 'helpful-button', 'dom-click']),
                    delayMs: config.get<number>('automation.controls.feedback.delayMs') ?? 150
                }
            },
            bump: {
                text: config.get<string>('actions.bump.text') || 'Proceed',
                requireFocused: config.get<boolean>('automation.bump.requireFocused') ?? true,
                requireVisible: config.get<boolean>('automation.bump.requireVisible') ?? true,
                detectMethods: getArr('automation.bump.detectMethods', ['feedback-visible', 'not-generating', 'last-sender-user', 'network-error-retry', 'waiting-for-input', 'loaded-conversation', 'completed-all-tasks', 'skip-ai-question']),
                typeMethods: getArr('automation.bump.typeMethods', ['exec-command', 'native-setter', 'dispatch-events']),
                submitMethods: getArr('automation.bump.submitMethods', ['click-send']),
                userDelayMs: config.get<number>('automation.bump.userDelayMs') ?? 3000,
                retryDelayMs: config.get<number>('automation.bump.retryDelayMs') ?? 2000,
                typingDelayMs: config.get<number>('actions.bump.typingDelayMs') ?? 50,
                submitDelayMs: config.get<number>('actions.bump.submitDelayMs') ?? 100
            },
            debug: {
                highlightClicks: config.get<boolean>('automation.debug.highlightClicks') ?? false,
                verboseLogging: config.get<boolean>('automation.debug.verboseLogging') ?? false,
                logAllActions: config.get<boolean>('automation.debug.logAllActions') ?? true,
                logToExtension: config.get<boolean>('automation.debug.logToExtension') ?? true
            },
            timing: {
                pollIntervalMs: config.get<number>('automation.timing.pollIntervalMs') ?? 1500,
                actionThrottleMs: config.get<number>('automation.timing.actionThrottleMs') ?? 1000,
                cooldownMs: config.get<number>('automation.timing.cooldownMs') ?? 2500,
                randomness: config.get<number>('automation.timing.randomness') ?? 100,
                autoReplyDelayMs: config.get<number>('automation.timing.autoReplyDelayMs') ?? 10000,
                stalledMs: config.get<number>('automation.bump.userDelayMs') ?? 7000,
                bumpCooldownMs: (config.get<number>('actions.bump.cooldown') ?? 30) * 1000,
                submitCooldownMs: Math.max(500, config.get<number>('actions.bump.submitDelayMs') ?? 100) * 10
            },
            runtime: {
                isLeader: this.controllerRoleIsLeader,
                role: this.controllerRoleIsLeader ? 'leader' : 'follower',
                windowFocused: this.hostWindowFocused
            }
        };

        return `window.__antigravityConfig = ${JSON.stringify(automationConfig)};`;
    }

    async connectToPage(page: any): Promise<boolean> {
        return new Promise((resolve) => {
            const ws = new WebSocket(page.webSocketDebuggerUrl);
            ws.on('open', async () => {
                this.connections.set(page.id, {
                    ws,
                    injected: false,
                    sessions: new Set(),
                    url: page.url,
                    title: page.title,
                    type: page.type
                });

                try {
                    // 1. Enable Runtime on Main Page
                    await this.sendCommand(page.id, 'Runtime.enable');

                    // In single-target mode, only keep the actively focused visible page.
                    // This prevents one leader window from controlling every open Antigravity page.
                    const singleTargetMode = this.isSingleTargetMode();
                    if (singleTargetMode) {
                        const existingPrimary = this.getPrimaryConnectedPageId();
                        if (existingPrimary && existingPrimary !== page.id) {
                            this.connections.delete(page.id);
                            try { ws.close(); } catch { }
                            resolve(false);
                            return;
                        }

                        const focusCheck = await this.sendCommand(page.id, 'Runtime.evaluate', {
                            expression: `(() => document.visibilityState === 'visible' && ((typeof document.hasFocus !== 'function') || document.hasFocus()))()`,
                            returnByValue: true,
                            awaitPromise: false
                        }, 1500).catch(() => null);

                        const isFocusedVisible = focusCheck?.result?.value === true;
                        if (!isFocusedVisible) {
                            this.connections.delete(page.id);
                            try { ws.close(); } catch { }
                            resolve(false);
                            return;
                        }
                    }

                    if (page.type === 'page') {
                        await this.sendCommand(page.id, 'Runtime.addBinding', { name: '__AUTOPILOT_BRIDGE__' });
                        await this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' }); // Still register fake legacy bridge to block it
                    }
                    // 1a. Kill any Zombie Loops from previous Extension reloads
                    await this.sendCommand(page.id, 'Runtime.evaluate', {
                        expression: `
                            if (window.__autopilotStop) { window.__autopilotStop(); }
                            if (window.__autopilotState) { window.__autopilotState.isRunning = false; window.__autopilotState.sessionID = null; }
                            if (window.stopAutoContinue) { window.stopAutoContinue(); }
                        `,
                        awaitPromise: false
                    });

                    // 1b. Inject Auto-Continue Script only when this window is eligible to run automation.
                    if (this.isPrimaryPageEligible(page.id)) {
                        try {
                            // Inject config first
                            await this.pushAutomationConfigToConnection(page.id);

                            // Inject script
                            await this.sendCommand(page.id, 'Runtime.evaluate', {
                                expression: AUTO_CONTINUE_SCRIPT,
                                awaitPromise: false
                            });
                            console.log(`[CDP] Injected Auto-Continue Script into ${page.id} with config`);
                        } catch (e) {
                            console.error(`[CDP] Failed to inject Auto-Continue Script into ${page.id}`, e);
                        }
                    } else {
                        await this.pushAutomationConfigToConnection(page.id);
                        await this.stopAutoContinueRuntime(page.id);
                    }

                    // 3. Explicit Target Discovery (Belt & Suspenders) - CONFIG GATED (Default: True)
                    const explicitDiscovery = config.get<boolean>('experimental.cdpExplicitDiscovery') ?? false;
                    if (explicitDiscovery) {
                        try {
                            const { targetInfos } = await this.sendCommand(page.id, 'Target.getTargets');
                            if (targetInfos) {
                                const attachableTargets = targetInfos.filter((info: any) => ['webview', 'iframe'].includes(info.type));
                                if (attachableTargets.length > 0) {
                                    // Give the host a moment to stabilize its views before we aggressively attach
                                    await new Promise(r => setTimeout(r, 800));

                                    for (const info of attachableTargets) {
                                        console.log(`[CDP] Explicitly attaching to existing target: ${info.type} ${info.url}`);
                                        this.sendCommand(page.id, 'Target.attachToTarget', { targetId: info.targetId, flatten: true })
                                            .catch(e => console.error(`[CDP] Failed to attach to ${info.targetId}:`, e));
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('[CDP] Explicit discovery failed', e);
                        }
                    }

                    // 2. Enable Discovery (Phase 38: Aggressive) - CONFIG GATED
                    // We need this to find the OOP Chat Iframe (Optional, creates conflicts)
                    const aggressive = config.get<boolean>('experimental.cdpAggressiveDiscovery') || false;
                    if (aggressive) {
                        await this.sendCommand(page.id, 'Target.setDiscoverTargets', { discover: true });
                    }
                } catch (e) {
                    console.log('[CDP] Setup failed', e);
                }

                resolve(true);
            });
            ws.on('message', async (data: any) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // Phase 38: Aggressive Attachment (Config-Gated)
                    const aggressive = config.get<boolean>('experimental.cdpAggressiveDiscovery') || false;
                    if (aggressive && msg.method === 'Target.targetCreated') {
                        const info = msg.params.targetInfo;
                        // Log for diagnosis
                        // console.log(`[CDP] Target: ${info.type} - ${info.url}`);

                        if (info.type === 'webview' || info.type === 'iframe') {
                            // Attach to nested targets (skip 'other' to reduce noise)
                            this.sendCommand(page.id, 'Target.attachToTarget', { targetId: info.targetId, flatten: true })
                                .catch(e => console.error(`[CDP] Failed to attach to new target ${info.targetId}:`, e));
                        }
                    }

                    // Handle Attachment Success
                    if (msg.method === 'Target.attachedToTarget') {
                        const sessionId = msg.params.sessionId;
                        const targetInfo = msg.params.targetInfo;
                        const conn = this.connections.get(page.id);
                        if (conn) {
                            conn.sessions.add(sessionId);
                        }
                        this.sendCommand(page.id, 'Page.enable', {}, undefined, sessionId).catch(() => { });
                        this.sendCommand(page.id, 'Runtime.enable', {}, undefined, sessionId).catch(() => { });

                        // Add Bridge Binding generically to all sessions, since chat inputs are often in unprivileged internal webviews
                        this.sendCommand(page.id, 'Runtime.addBinding', { name: '__AUTOPILOT_BRIDGE__' }, undefined, sessionId).catch(() => { });
                        this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' }, undefined, sessionId).catch(() => { });

                        const sessionPageEligible = this.isPrimaryPageEligible(page.id);
                        if (sessionPageEligible) {
                            try {
                                this.pushAutomationConfigToConnection(page.id, sessionId).catch(e => console.error(`[CDP] config injection error on session ${sessionId}`, e));

                                this.sendCommand(page.id, 'Runtime.evaluate', {
                                    expression: AUTO_CONTINUE_SCRIPT,
                                    awaitPromise: false
                                }, undefined, sessionId).catch(e => console.error(`[CDP] script injection error on session ${sessionId}`, e));
                                console.log(`[CDP] Injected Auto-Continue Script into nested session ${sessionId}`);
                            } catch (e) {
                                console.error(`[CDP] Failed to inject Auto-Continue into nested session ${sessionId}`, e);
                            }
                        } else {
                            this.pushAutomationConfigToConnection(page.id, sessionId).catch(() => { });
                            this.stopAutoContinueRuntime(page.id, sessionId).catch(() => { });
                        }

                        this.sendCommand(page.id, 'DOM.enable', {}, undefined, sessionId).catch(() => { });
                        this.emit('sessionAttached', { pageId: page.id, sessionId, type: targetInfo?.type, url: targetInfo?.url });
                    }

                    // Inject on Context Creation (Main Page + Nested)
                    if (msg.method === 'Runtime.executionContextCreated') {
                        const ctx = msg.params.context;
                        this.emit('contextCreated', { pageId: page.id, contextId: ctx.id, origin: ctx.origin, sessionId: msg.sessionId });
                    }

                    if (msg.id && this.pendingMessages.has(msg.id)) {
                        const { resolve: res, reject: rej } = this.pendingMessages.get(msg.id)!;
                        this.pendingMessages.delete(msg.id);
                        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
                    } else if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__AUTOPILOT_BRIDGE__') {
                        this.handleBridgeMessage(page.id, msg.params.payload, msg.sessionId);
                    } else if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__ANTIGRAVITY_BRIDGE__') {
                        // Sinkhole legacy bridge calls to prevent legacy UI ghost loops
                    } else if (msg.method === 'Runtime.consoleAPICalled') {
                        // Fallback Console Bridge
                        const text = msg.params.args[0]?.value || '';
                        const originSessionId = msg.sessionId;

                        // Check if it's a bridge message
                        if (typeof text === 'string' && (text.startsWith('__ANTIGRAVITY') || text.startsWith('__AUTOPILOT'))) {
                            this.handleBridgeMessage(page.id, text, originSessionId);
                        } else {
                            // Forward interesting logs to OutputChannel
                            const lowerText = text.toLowerCase();
                            if (lowerText.includes('[autoall]') || lowerText.includes('[cdp]') || lowerText.includes('antigravity')) {
                                logToOutput(`[Browser] ${text}`);
                            } else if (config.get('automation.debug.verboseLogging')) {
                                logToOutput(`[Browser-Verbose] ${text}`);
                            }
                        }
                    }
                } catch (e) {
                    console.error('[CDP Bridge Error]', e);
                }
            });
            ws.on('error', (err: Error) => {
                console.log(`WS Error on ${page.id}: ${err.message}`);
                this.connections.delete(page.id);
                resolve(false);
            });
            ws.on('close', () => {
                this.connections.delete(page.id);
            });
        });
    }

    async sendCommand(pageId: string, method: string, params: any = {}, timeoutMs?: number, sessionId?: string): Promise<any> {
        const conn = this.connections.get(pageId);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('dead'));
        const id = this.messageId++;
        const timeout = timeoutMs || this.timeoutMs;

        return new Promise((resolve, reject) => {
            this.pendingMessages.set(id, { resolve, reject });
            const message: any = { id, method, params };
            if (sessionId) message.sessionId = sessionId;
            conn.ws.send(JSON.stringify(message));
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error(`timeout after ${timeout}ms`));
                }
            }, timeout);
        });
    }

    async injectScript(pageId: string, scriptContent: string, force: boolean = false, sessionId?: string): Promise<void> {
        const conn = this.connections.get(pageId);
        if (!conn) return;

        // Note: We don't track 'injected' state per session perfectly yet, simplify to always try injection
        // or check simple existence.

        // For sub-sessions, we don't store `injected` flag on `conn`.
        // We could store it in a nested map, but for now just try-inject.

        try {
            // Check existence
            const check = await this.sendCommand(pageId, 'Runtime.evaluate', {
                expression: `(() => ({
                    legacy: typeof window.__autopilotStart === 'function',
                    modernRunning: window.__antigravityAutoContinueRunning === true,
                    modernApi: typeof window.__antigravityGetState === 'function'
                }))()`,
                returnByValue: true
            }, 1000, sessionId);

            const marker = check?.result?.value;
            const hasRuntime = !!(marker?.legacy || marker?.modernRunning || marker?.modernApi);

            await this.pushAutomationConfigToConnection(pageId, sessionId);

            const singleTargetMode = this.isSingleTargetMode();
            const primaryPageId = singleTargetMode ? this.getPrimaryConnectedPageId() : null;
            const pageEligible = this.shouldInjectAutoContinueRuntime() && (!singleTargetMode || pageId === primaryPageId);

            if (!pageEligible) {
                if (hasRuntime) {
                    await this.stopAutoContinueRuntime(pageId, sessionId);
                }
                return;
            }

            if (force || !hasRuntime) {

                // Inject script
                await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression: scriptContent,
                    userGesture: true,
                    awaitPromise: true
                }, 10000, sessionId);

                // If main page, mark injected
                if (!sessionId) conn.injected = true;
            }
        } catch (e) {
            // console.error(`Injection failed on ${pageId} ${sessionId || ''}`, e);
        }
    }

    resetInjectionState() {
        for (const [, conn] of this.connections) {
            conn.injected = false;
        }
    }

    disconnectAll() {
        for (const [, conn] of this.connections) {
            try { conn.ws.close(); } catch (e) { }
        }
        this.connections.clear();
        this.watchdogState.clear();
        this.recentAutomationSignals.clear();
        this.recentActionDispatch.clear();
    }

    isConnected(): boolean {
        return this.connections.size > 0;
    }

    async connect(targetFilter?: string): Promise<boolean> {
        if (this.connectInFlight) {
            return this.connectInFlight;
        }

        this.connectInFlight = this.connectInternal(targetFilter);
        try {
            return await this.connectInFlight;
        } finally {
            this.connectInFlight = null;
        }
    }

    private async connectInternal(targetFilter?: string): Promise<boolean> {
        const instances = await this.scanForInstances();
        let connectedCount = 0;
        const multiTabEnabled = !this.isSingleTargetMode() && (config.get<boolean>('multiTabEnabled') ?? false);

        if (!multiTabEnabled && this.connections.size > 0) {
            this.pruneNonPrimaryConnections();
            return true;
        }

        logToOutput(`[CDP] Connect requested. Filter: "${targetFilter || 'NONE'}" (Instances found: ${instances.length})`);

        for (const instance of instances) {
            for (const page of instance.pages) {
                if (this.connections.has(page.id)) {
                    connectedCount++;
                    if (!multiTabEnabled) return true;
                    continue;
                }

                // Smart Target Filtering
                if (targetFilter) {
                    const title = (page.title || '').toLowerCase();
                    const url = (page.url || '').toLowerCase();
                    const filter = targetFilter.toLowerCase();
                    // Match if title includes filter 
                    // OR if it's a shared resource we might want? No, strict is better for now.
                    if (!title.includes(filter) && !url.includes(filter)) {
                        // console.log(`[CDP] Skipping target "${page.title}" (Mismatch filter "${filter}")`);
                        continue;
                    }
                }

                // If not multi-tab and we already have a connection, skip/return
                // Note: We return true if we have at least one connection.
                if (!multiTabEnabled && this.connections.size > 0) {
                    return true;
                }

                const ok = await this.connectToPage(page);
                if (ok) {
                    connectedCount++;
                    this.pruneNonPrimaryConnections();
                    if (!multiTabEnabled) return true;
                }
            }
        }

        return connectedCount > 0;
    }

    private async handleBridgeMessage(pageId: string, text: string, sessionId?: string) {
        if (typeof text !== 'string') return;

        try {
            // Text input routing
            if (text.startsWith('__AUTOPILOT_TYPE__:')) {
                const content = text.substring('__AUTOPILOT_TYPE__:'.length);
                this.insertTextToOriginSession(pageId, sessionId, content).catch(() => { });
            } else if (text.startsWith('__ANTIGRAVITY_COMMAND__:')) {
                // [LEGACY ZOMBIE KILLER]
                // The legacy `full_cdp_script.js` sends `__ANTIGRAVITY_COMMAND__:workbench.action.terminal.chat.accept` 
                // which aliases to "Customize Layout" on the Antigravity fork.
                // The modern extension never uses `__ANTIGRAVITY_COMMAND__`. It uses `__AUTOPILOT_ACTION__`.
                // Severing this bridge permanently stops the ghost clicks.
                const raw = text.substring('__ANTIGRAVITY_COMMAND__:'.length);
                logToOutput(`[Bridge] Blocked legacy command execution: ${raw}`);
            } else if (text.startsWith('__AUTOPILOT_PLAY_SOUND__:')) {
                const effect = text.substring('__AUTOPILOT_PLAY_SOUND__:'.length).trim() as any;
                if (config.get<boolean>('audioFeedbackEnabled')) {
                    SoundEffects.play(effect);
                }
            } else if (text.startsWith('__AUTOPILOT_DEBUG_LOG__:')) {
                const logMsg = text.substring('__AUTOPILOT_DEBUG_LOG__:'.length).trim();
                if (config.get<boolean>('debugLoggingEnabled')) {
                    console.log(`[Browser Debug] ${logMsg}`);
                }
            } else if (text.startsWith('__AUTOPILOT_HYBRID_BUMP__:')) {
                if (!this.controllerRoleIsLeader) {
                    logToOutput('[Bump-Blocked] Ignoring hybrid bump bridge payload in follower window.');
                    return;
                }

                // Phase 52: Hybrid Bump Strategy
                const bumpText = text.substring('__AUTOPILOT_HYBRID_BUMP__:'.length);
                const vscode = require('vscode');

                if (bumpText) {
                    logToOutput(`[Bump-Start] Initiating Hybrid Bump: "${bumpText}"`);
                }

                // Read configuration for delays
                const bumpConfig = config.get<{ typingDelayMs: number; submitDelayMs: number; openChat?: boolean }>('actions.bump') || {};
                const typingDelay = bumpConfig.typingDelayMs || 50;
                const submitDelay = bumpConfig.submitDelayMs || 800;
                const shouldOpenChat = bumpConfig.openChat === true; // Default false to avoid opening new threads; user can explicitly enable

                if (bumpText) {
                    try {
                        logToOutput(`[Bump-Step] 1. Writing to Clipboard`);
                        await vscode.env.clipboard.writeText(bumpText);

                        // NOTE: chat.open / chat.focusInput REMOVED — triggers Customize Layout on Antigravity fork
                        logToOutput(`[Bump-Step] 2-3. Skipping all chat.* commands (Antigravity fork safety)`);

                        logToOutput(`[Bump-Step] 4. Pasting Clipboard`);
                        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                    } catch (e: any) {
                        logToOutput(`[Bump-Error] Text Entry Failed: ${e.message}`);
                    }
                }

                // NO COMMANDS! We rely purely on the frontend CDP script to click the submit button.
                // Any command we execute here (even interactive.acceptChanges) might be aliased to Customize Layout on the fork.
                logToOutput(`[Bump-Step] 5. Skipping command-based submits (Safety)`);

                // 3. Safety: Do NOT emit global CDP Enter fallback.
                // It can target non-chat UI focus and trigger native menu/layout actions.
                await new Promise(r => setTimeout(r, Math.max(100, submitDelay / 2)));
                logToOutput(`[Bump-Step] 6. Skipping unsafe global CDP Enter fallback`);
                logToOutput(`[Bump-End] Hybrid Bump Sequence Complete`);
            } else if (text.startsWith('__AUTOPILOT_ACTION__:')) {
                const raw = text.substring('__AUTOPILOT_ACTION__:'.length);
                const [groupRaw, detailRaw] = raw.split('|');
                const group = (groupRaw || 'click').trim() as ActionSoundGroup;
                const detail = (detailRaw || '').trim();
                this.noteAutomationSignal(pageId, sessionId);

                if (!this.shouldDispatchAction(pageId, sessionId, group, detail)) {
                    return;
                }

                logToOutput(`[AutoAction:${group}] ${detail || 'triggered'}`);
                const soundGroup = group === 'accept-all' ? 'accept' : group;
                SoundEffects.playActionGroup(soundGroup as ActionSoundGroup);

                if (group === 'submit') {
                    // Frontend runtime already performed submit attempts directly.
                    // Do not relay submit back into backend interaction methods, which can re-type
                    // action detail text (e.g. "alt-enter or enter key") and create noisy loops.
                    if (detail === 'keys') {
                        logToOutput(`[AutoAction:submit] Blocked unsafe CDP Enter relay for submit|keys`);
                    }
                } else if (group === 'run' || group === 'expand' || group === 'continue' || group === 'accept' || group === 'accept-all') {
                    const routedGroup = group === 'accept-all' ? 'accept' : group;
                    this.emit('action', { group: routedGroup, detail });
                }
            } else if (text.startsWith('__AUTOPILOT_LOG__:')) {
                const raw = text.substring('__AUTOPILOT_LOG__:'.length);
                this.noteAutomationSignal(pageId, sessionId);
                logToOutput(`[AutoContinue] ${raw}`);
            }
        } catch (e) {
            console.error('Bridge Message Handler Error', e);
            logToOutput(`[Bridge-Error] ${e}`);
        }
    }

    async executeScriptInAllSessions(script: string) {
        for (const [pageId, conn] of this.connections) {
            this.injectScript(pageId, script).catch(() => { });
            for (const sessionId of conn.sessions) {
                this.injectScript(pageId, script, false, sessionId).catch(() => { });
            }
        }
    }

    async dispatchKeyEventToAll(event: any) {
        for (const [pageId, conn] of this.connections) {
            this.sendCommand(pageId, 'Input.dispatchKeyEvent', event).catch(() => { });
            for (const sessionId of conn.sessions) {
                this.sendCommand(pageId, 'Input.dispatchKeyEvent', event, undefined, sessionId).catch(() => { });
            }
        }
    }

    async dispatchMouseEventToAll(event: any) {
        for (const [pageId, conn] of this.connections) {
            this.sendCommand(pageId, 'Input.dispatchMouseEvent', event).catch(() => { });
            for (const sessionId of conn.sessions) {
                this.sendCommand(pageId, 'Input.dispatchMouseEvent', event, undefined, sessionId).catch(() => { });
            }
        }
    }

    async insertTextToAll(text: string) {
        for (const [pageId, conn] of this.connections) {
            this.sendCommand(pageId, 'Input.insertText', { text }).catch(() => { });
            for (const sessionId of conn.sessions) {
                this.sendCommand(pageId, 'Input.insertText', { text }, undefined, sessionId).catch(() => { });
            }
        }
    }

    private async insertTextToOriginSession(pageId: string, sessionId: string | undefined, text: string): Promise<void> {
        if (!pageId || !text) {
            return;
        }

        if (!sessionId) {
            this.sendCommand(pageId, 'Input.insertText', { text }).catch(() => { });
            return;
        }

        const gateResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
            expression: `(() => {
                const isLeader = window.__antigravityConfig?.runtime?.isLeader === true;
                const visible = document.visibilityState === 'visible';
                const focused = (typeof document.hasFocus !== 'function') || document.hasFocus();
                return isLeader && visible && focused;
            })()`,
            returnByValue: true,
            awaitPromise: true
        }, undefined, sessionId).catch(() => null);

        if (gateResult?.result?.value === true) {
            this.sendCommand(pageId, 'Input.insertText', { text }, undefined, sessionId).catch(() => { });
        } else {
            logToOutput('[Bridge] Blocked __AUTOPILOT_TYPE__ relay for non-eligible origin session');
        }
    }

    async executeInAllSessions(expression: string, returnByValue: boolean = true): Promise<any[]> {
        const results: any[] = [];
        for (const [pageId, conn] of this.connections) {
            try {
                const mainResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                    expression,
                    returnByValue,
                    awaitPromise: true
                });
                results.push(mainResult?.result?.value);
            } catch {
                // ignore
            }

            for (const sessionId of conn.sessions) {
                try {
                    const sessionResult = await this.sendCommand(pageId, 'Runtime.evaluate', {
                        expression,
                        returnByValue,
                        awaitPromise: true
                    }, undefined, sessionId);
                    results.push(sessionResult?.result?.value);
                } catch {
                    // ignore
                }
            }
        }
        return results;
    }

    async captureScreenshots(): Promise<string[]> {
        const screenshots: string[] = [];
        for (const [pageId] of this.connections) {
            try {
                const result = await this.sendCommand(pageId, 'Page.captureScreenshot', { format: 'png' });
                if (result?.data) {
                    screenshots.push(result.data);
                }
            } catch {
                // ignore capture errors for pages that do not support screenshots
            }
        }
        return screenshots;
    }

    getConnectedPageIds(): string[] {
        return Array.from(this.connections.keys());
    }

    getTrackedSessions(): { id: string, url: string, title: string, type: string }[] {
        const sessions: { id: string, url: string, title: string, type: string }[] = [];
        for (const [id, conn] of this.connections) {
            sessions.push({
                id,
                url: conn.url || 'Unknown URL',
                title: conn.title || 'Untitled',
                type: conn.type || 'page'
            });
        }
        return sessions;
    }

    /**
     * Retrieves automation runtime state from injected Auto-All script.
     * Returns the first non-null state snapshot discovered across sessions.
     */
    async getAutomationRuntimeState(): Promise<any | null> {
        try {
            const expression = `
                (function() {
                    if (window.__autopilotGetRuntimeState) {
                        return window.__autopilotGetRuntimeState();
                    }
                    return null;
                })()
            `;
            const states = await this.executeInAllSessions(expression, true);
            for (const state of states) {
                if (state && typeof state === 'object') {
                    return state;
                }
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Sends a chat bump/resume message through the browser bridge.
     */
    async sendHybridBump(message: string): Promise<boolean> {
        if (!message || !message.trim()) return false;
        if (!this.controllerRoleIsLeader) {
            logToOutput('[Bump-Blocked] sendHybridBump skipped in follower window (leader-only dispatch).');
            return false;
        }
        const safe = JSON.stringify(String(message));
        const expression = `
            (function() {
                const msg = ${safe};
                const payload = '__AUTOPILOT_HYBRID_BUMP__:' + msg;
                if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
                    window.__AUTOPILOT_BRIDGE__(payload);
                    return true;
                }
                return false;
            })()
        `;
        const result = await this.executeInFirstTruthySession(expression, true);
        return result === true;
    }

    private noteAutomationSignal(pageId: string, sessionId?: string): void {
        const now = Date.now();
        this.recentAutomationSignals.set(pageId, now);
        if (sessionId) {
            this.recentAutomationSignals.set(`${pageId}::${sessionId}`, now);
        }
    }

    private shouldDispatchAction(pageId: string, sessionId: string | undefined, group: string, detail: string): boolean {
        const now = Date.now();
        const normalizedDetail = String(detail || '').trim().toLowerCase();
        const highImpactGroups = new Set(['submit', 'run', 'expand', 'continue', 'accept', 'accept-all']);
        const actionScope = highImpactGroups.has(group) ? 'page' : (sessionId || 'main');
        const key = `${pageId}::${actionScope}::${group}::${normalizedDetail}`;
        const lastTs = this.recentActionDispatch.get(key) || 0;

        const throttleMs = group === 'submit' ? 1500 : 200;
        if (lastTs > 0 && (now - lastTs) < throttleMs) {
            return false;
        }

        this.recentActionDispatch.set(key, now);
        return true;
    }

    private hasRecentAutomationSignal(pageId: string, sessions: Set<string>, now: number, graceMs: number): boolean {
        const pageTs = this.recentAutomationSignals.get(pageId) || 0;
        if (pageTs > 0 && (now - pageTs) < graceMs) {
            return true;
        }

        for (const sessionId of sessions) {
            const ts = this.recentAutomationSignals.get(`${pageId}::${sessionId}`) || 0;
            if (ts > 0 && (now - ts) < graceMs) {
                return true;
            }
        }

        return false;
    }

    private async getWatchdogSnapshot(pageId: string, sessionId?: string): Promise<any | null> {
        try {
            const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                expression: `(() => ({
                    heartbeat: window.__antigravityHeartbeat,
                    readyState: document.readyState,
                    visible: document.visibilityState,
                    focused: (typeof document.hasFocus === 'function') ? document.hasFocus() : true,
                    running: window.__antigravityAutoContinueRunning === true,
                    hasAutopilotApi:
                        typeof window.__autopilotStart === 'function'
                        || !!window.__autopilotState
                        || typeof window.__antigravityGetState === 'function'
                        || typeof window.__antigravityTypeAndSubmit === 'function'
                }))()`,
                returnByValue: true,
                awaitPromise: false
            }, 2000, sessionId);
            return result?.result?.value || null;
        } catch {
            return null;
        }
    }
    // --- Watchdog ---
    startWatchdogLoop() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);

        this.watchdogInterval = setInterval(async () => {
            const enabled = config.get<boolean>('watchdogEnabled') ?? true;
            if (!enabled) return;

            const timeoutMs = config.get<number>('watchdogTimeoutMs') || 15000;
            const reinjectCooldownMs = config.get<number>('watchdogReinjectCooldownMs') || 15000;
            const maxConsecutiveReinjects = config.get<number>('watchdogMaxConsecutiveReinjects') || 3;
            const recentActivityGraceMs = config.get<number>('watchdogRecentActivityGraceMs') || 12000;
            const now = Date.now();

            // Safety gate: watchdog reinjection should only run in the active leader window.
            // Background/follower windows naturally throttle timers and can look "stale" even when healthy.
            if (!this.controllerRoleIsLeader || !this.hostWindowFocused) {
                return;
            }

            for (const [pageId, conn] of this.connections) {
                try {
                    const singleTargetMode = this.isSingleTargetMode();
                    const primaryPageId = singleTargetMode ? this.getPrimaryConnectedPageId() : null;
                    if (singleTargetMode && pageId !== primaryPageId) {
                        await this.stopAutoContinueRuntime(pageId);
                        for (const sessionId of conn.sessions) {
                            await this.stopAutoContinueRuntime(pageId, sessionId);
                        }
                        continue;
                    }

                    const state = this.watchdogState.get(pageId) || { attempts: 0, lastAttemptAt: 0 };
                    const withinCooldown = (now - state.lastAttemptAt) < reinjectCooldownMs;

                    if (singleTargetMode) {
                        continue;
                    }

                    if (this.hasRecentAutomationSignal(pageId, conn.sessions, now, recentActivityGraceMs)) {
                        continue;
                    }

                    const snapshots: any[] = [];
                    const mainSnapshot = await this.getWatchdogSnapshot(pageId);
                    if (mainSnapshot) snapshots.push(mainSnapshot);
                    for (const sessionId of conn.sessions) {
                        const sessionSnapshot = await this.getWatchdogSnapshot(pageId, sessionId);
                        if (sessionSnapshot) snapshots.push(sessionSnapshot);
                    }

                    if (snapshots.length === 0) {
                        continue;
                    }

                    // Only evaluate watchdog health for foreground-eligible snapshots.
                    // This avoids re-inject storms from hidden/background sessions.
                    const eligibleSnapshots = snapshots.filter((snap: any) =>
                        snap?.readyState === 'complete' && snap?.visible === 'visible' && snap?.focused === true
                    );

                    if (eligibleSnapshots.length === 0) {
                        continue;
                    }

                    const freshHeartbeat = eligibleSnapshots.some((snap: any) =>
                        typeof snap?.heartbeat === 'number' && (now - snap.heartbeat) <= timeoutMs
                    );

                    if (freshHeartbeat) {
                        if (state.attempts > 0 || state.lastAttemptAt > 0) {
                            this.watchdogState.set(pageId, { attempts: 0, lastAttemptAt: 0 });
                        }
                        continue;
                    }

                    const staleHeartbeat = eligibleSnapshots.some((snap: any) =>
                        typeof snap?.heartbeat !== 'number' || (now - snap.heartbeat) > timeoutMs
                    );

                    const hasAutomationSurface = eligibleSnapshots.some((snap: any) =>
                        snap?.running === true || snap?.hasAutopilotApi === true
                    );

                    if (!withinCooldown && state.attempts < maxConsecutiveReinjects && staleHeartbeat && hasAutomationSurface) {
                        const staleDiffs = eligibleSnapshots
                            .map((snap: any) => (typeof snap?.heartbeat === 'number' ? (now - snap.heartbeat) : null))
                            .filter((n: number | null) => typeof n === 'number') as number[];
                        const maxDiff = staleDiffs.length > 0 ? Math.max(...staleDiffs) : -1;
                        const reason = `stale or missing heartbeat on active target${maxDiff >= 0 ? ` (${maxDiff}ms)` : ''}`;
                        logToOutput(`[Watchdog] ${reason} on ${pageId}. Re-injecting script.`);
                        await this.injectScript(pageId, AUTO_CONTINUE_SCRIPT, true);
                        this.watchdogState.set(pageId, { attempts: state.attempts + 1, lastAttemptAt: now });
                    }
                } catch (e) {
                    // Connection might be dead, handled by 'close' event
                }
            }

        }, 5000); // Check every 5s
    }

    stopWatchdogLoop() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    }
}

