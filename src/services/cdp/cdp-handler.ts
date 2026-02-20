import WebSocket from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
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

    constructor(startPort?: number, endPort?: number) {
        super();
        const configuredPort = config.get<number>('cdpPort') || 9000;
        this.startPort = startPort ?? configuredPort;
        this.endPort = endPort ?? configuredPort;
        this.connections = new Map();
        this.messageId = 1;
        this.pendingMessages = new Map();
        this.timeoutMs = config.get<number>('cdpTimeout') || 10000;
        this.startWatchdogLoop();
    }

    async scanForInstances(): Promise<{ port: number, pages: any[] }[]> {
        const instances = [];
        const portsToCheck = new Set<number>();

        // Scan configured port range first, then well-known CDP fallbacks.
        for (let p = this.startPort; p <= this.endPort; p++) portsToCheck.add(p);

        // Also check common CDP defaults to recover from frequent host/editor port drift
        // (e.g. extension configured for 9000 while editor exposes 9222).
        const fallbackPorts = [9222, 9000];
        for (const fallbackPort of fallbackPorts) {
            if (fallbackPort >= this.startPort && fallbackPort <= this.endPort) {
                continue;
            }
            portsToCheck.add(fallbackPort);
        }

        for (const port of portsToCheck) {
            try {
                const pages = await this.getPages(port);
                if (pages.length > 0) instances.push({ port, pages });
            } catch (e) { }
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

    getPages(port: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 500 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(data);
                        // Phase 27: Intelligent Filter
                        const allowedTypes = ['page', 'webview', 'iframe', 'background_page'];
                        resolve(pages.filter((p: any) =>
                            p.webSocketDebuggerUrl && allowedTypes.includes(p.type)
                        ));
                    }
                    catch (e) { reject(e); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });
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
                    await this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' });

                    // 1b. Inject Auto-Continue Script (if enabled)
                    if (config.get<boolean>('autoContinueScriptEnabled') !== false) {
                        const automationConfig = {
                            clickRun: config.get<boolean>('automation.actions.clickRun') ?? true,
                            clickExpand: config.get<boolean>('automation.actions.clickExpand') ?? true,
                            clickAccept: config.get<boolean>('automation.actions.clickAccept') ?? true,
                            clickAcceptAll: config.get<boolean>('automation.actions.clickAcceptAll') ?? true,
                            clickContinue: config.get<boolean>('automation.actions.clickContinue') ?? true,
                            clickSubmit: config.get<boolean>('automation.actions.clickSubmit') ?? true,
                            clickFeedback: config.get<boolean>('automation.actions.clickFeedback') ?? false,
                            autoScroll: config.get<boolean>('automation.actions.autoScroll') ?? true,
                            // Auto-Reply
                            autoReply: config.get<boolean>('automation.actions.autoReply') ?? true,
                            autoReplyText: config.get<string>('automation.actions.autoReplyText') ?? config.get<string>('actions.bump.text') ?? config.get<string>('bumpMessage') ?? 'continue',
                            controls: {
                                run: {
                                    detectMethods: config.get<string[]>('automation.controls.run.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.run.actionMethods') ?? ['dom-click', 'native-click', 'alt-enter'],
                                    delayMs: config.get<number>('automation.controls.run.delayMs') ?? 100
                                },
                                expand: {
                                    detectMethods: config.get<string[]>('automation.controls.expand.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.expand.actionMethods') ?? ['dom-click', 'native-click', 'alt-enter'],
                                    delayMs: config.get<number>('automation.controls.expand.delayMs') ?? 50
                                },
                                accept: {
                                    detectMethods: config.get<string[]>('automation.controls.accept.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.accept.actionMethods') ?? ['accept-all-first', 'accept-single', 'dom-click'],
                                    delayMs: config.get<number>('automation.controls.accept.delayMs') ?? 100
                                },
                                submit: {
                                    detectMethods: config.get<string[]>('automation.controls.submit.detectMethods') ?? ['enabled-flag', 'not-generating'],
                                    actionMethods: config.get<string[]>('automation.controls.submit.actionMethods') ?? ['click-send', 'enter-key'],
                                    delayMs: config.get<number>('automation.controls.submit.delayMs') ?? 100
                                },
                                acceptAll: {
                                    detectMethods: config.get<string[]>('automation.controls.acceptAll.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.acceptAll.actionMethods') ?? ['accept-all-button', 'keep-button', 'allow-all-button', 'dom-click'],
                                    delayMs: config.get<number>('automation.controls.acceptAll.delayMs') ?? 100
                                },
                                continue: {
                                    detectMethods: config.get<string[]>('automation.controls.continue.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.continue.actionMethods') ?? ['continue-button', 'keep-button', 'dom-click'],
                                    delayMs: config.get<number>('automation.controls.continue.delayMs') ?? 100
                                },
                                feedback: {
                                    detectMethods: config.get<string[]>('automation.controls.feedback.detectMethods') ?? ['enabled-flag', 'not-generating', 'action-cooldown'],
                                    actionMethods: config.get<string[]>('automation.controls.feedback.actionMethods') ?? ['thumbs-up', 'helpful-button', 'dom-click'],
                                    delayMs: config.get<number>('automation.controls.feedback.delayMs') ?? 150
                                }
                            },
                            bump: {
                                detectMethods: config.get<string[]>('automation.bump.detectMethods') ?? ['feedback-visible', 'not-generating', 'last-sender-user', 'network-error-retry', 'waiting-for-input', 'loaded-conversation', 'completed-all-tasks', 'skip-ai-question'],
                                typeMethods: config.get<string[]>('automation.bump.typeMethods') ?? ['exec-command', 'native-setter', 'dispatch-events'],
                                submitMethods: config.get<string[]>('automation.bump.submitMethods') ?? ['click-send', 'enter-key'],
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
                                autoReplyDelayMs: config.get<number>('automation.timing.autoReplyDelayMs') ?? 10000
                            }
                        };

                        try {
                            // Inject config first
                            await this.sendCommand(page.id, 'Runtime.evaluate', {
                                expression: `window.__antigravityConfig = ${JSON.stringify(automationConfig)};`,
                                awaitPromise: false
                            });

                            // Inject script
                            await this.sendCommand(page.id, 'Runtime.evaluate', {
                                expression: AUTO_CONTINUE_SCRIPT,
                                awaitPromise: false
                            });
                            console.log(`[CDP] Injected Auto-Continue Script into ${page.id} with config`, automationConfig);
                        } catch (e) {
                            console.error(`[CDP] Failed to inject Auto-Continue Script into ${page.id}`, e);
                        }
                    }

                    // 3. Explicit Target Discovery (Belt & Suspenders) - CONFIG GATED (Default: True)
                    const explicitDiscovery = config.get<boolean>('experimental.cdpExplicitDiscovery') ?? true;
                    if (explicitDiscovery) {
                        try {
                            const { targetInfos } = await this.sendCommand(page.id, 'Target.getTargets');
                            if (targetInfos) {
                                for (const info of targetInfos) {
                                    if (['webview', 'iframe'].includes(info.type)) {
                                        console.log(`[CDP] Explicitly attaching to existing target: ${info.type} ${info.url}`);
                                        // Wait briefly for webview stabilization (prevent blank screen race)
                                        await new Promise(r => setTimeout(r, 500));

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
                        const conn = this.connections.get(page.id);
                        if (conn) {
                            conn.sessions.add(sessionId);
                        }
                        this.sendCommand(page.id, 'Runtime.enable', {}, undefined, sessionId).catch(() => { });
                        this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' }, undefined, sessionId).catch(() => { });
                        this.emit('sessionAttached', { pageId: page.id, sessionId, type: msg.params.targetInfo.type, url: msg.params.targetInfo.url });
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
                    } else if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__ANTIGRAVITY_BRIDGE__') {
                        const payload = msg.params.payload;
                        const originSessionId = msg.sessionId;
                        this.handleBridgeMessage(page.id, payload, originSessionId);
                    } else if (msg.method === 'Runtime.consoleAPICalled') {
                        // Fallback Console Bridge
                        const text = msg.params.args[0]?.value || '';
                        const originSessionId = msg.sessionId;

                        // Check if it's a bridge message
                        if (text.startsWith('__ANTIGRAVITY')) {
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
                expression: "typeof window.__autoAllStart",
                returnByValue: true
            }, 1000, sessionId);

            if (force || check?.result?.value !== 'function') {
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
    }

    isConnected(): boolean {
        return this.connections.size > 0;
    }

    async connect(targetFilter?: string): Promise<boolean> {
        const instances = await this.scanForInstances();
        let connectedCount = 0;
        const multiTabEnabled = config.get<boolean>('multiTabEnabled') ?? false;

        console.log(`[CDP] Connect requested. Filter: "${targetFilter || 'NONE'}"`);

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
                    const filter = targetFilter.toLowerCase();
                    // Match if title includes filter 
                    // OR if it's a shared resource we might want? No, strict is better for now.
                    if (!title.includes(filter)) {
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
                    if (!multiTabEnabled) return true;
                }
            }
        }

        return connectedCount > 0;
    }

    private async handleBridgeMessage(pageId: string, text: string, sessionId?: string) {
        if (typeof text !== 'string') return;

        try {
            if (text.startsWith('__ANTIGRAVITY_CLICK__:')) {
                const parts = text.split(':');
                const x = parseInt(parts[1]);
                const y = parseInt(parts[2]);
                if (!isNaN(x) && !isNaN(y)) {
                    // Click = Pressed (buttons=1) + Delay + Released
                    await this.sendCommand(pageId, 'Input.dispatchMouseEvent', {
                        type: 'mousePressed',
                        x, y,
                        button: 'left',
                        buttons: 1, // Bitmask: Left button down
                        clickCount: 1
                    }, undefined, sessionId);

                    await new Promise(r => setTimeout(r, 50));

                    await this.sendCommand(pageId, 'Input.dispatchMouseEvent', {
                        type: 'mouseReleased',
                        x, y,
                        button: 'left',
                        buttons: 0,
                        clickCount: 1
                    }, undefined, sessionId);
                }
            } else if (text.startsWith('__ANTIGRAVITY_TYPE__:')) {
                const content = text.substring('__ANTIGRAVITY_TYPE__:'.length);
                if (content) {
                    await this.sendCommand(pageId, 'Input.insertText', { text: content }, undefined, sessionId);
                }
            } else if (text.startsWith('__ANTIGRAVITY_COMMAND__:')) {
                const raw = text.substring('__ANTIGRAVITY_COMMAND__:'.length).trim();
                if (raw) {
                    // Format: "commandId|jsonArgs"
                    const pipeIndex = raw.indexOf('|');
                    let commandId = raw;
                    let args = undefined;

                    if (pipeIndex > 0) {
                        commandId = raw.substring(0, pipeIndex).trim();
                        try {
                            args = JSON.parse(raw.substring(pipeIndex + 1));
                        } catch (e) {
                            console.error('[Bridge] Failed to parse args for command ' + commandId);
                        }
                    }

                    if (commandId) {
                        console.log(`[Bridge] Executing Command: ${commandId}`, args);
                        const vscode = require('vscode');
                        try {
                            const blockedCommandPattern = /(extensions?|marketplace|install|uninstall|show\s*extensions|workbench\.view\.extensions)/i;
                            if (blockedCommandPattern.test(commandId)) {
                                logToOutput(`[Bridge] Blocked unsafe command: ${commandId}`);
                                return;
                            }
                            if (args) await vscode.commands.executeCommand(commandId, args);
                            else await vscode.commands.executeCommand(commandId);
                        } catch (e: any) {
                            console.error(`[Bridge] Command execution failed: ${e.message}`);
                        }
                    }
                }
            } else if (text.startsWith('__ANTIGRAVITY_HYBRID_BUMP__:')) {
                // Phase 52: Hybrid Bump Strategy
                const bumpText = text.substring('__ANTIGRAVITY_HYBRID_BUMP__:'.length);
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

                        if (shouldOpenChat) {
                            logToOutput(`[Bump-Step] 2. Executing 'workbench.action.chat.open'`);
                            await vscode.commands.executeCommand('workbench.action.chat.open');
                            await new Promise((r: any) => setTimeout(r, Math.max(100, typingDelay * 6))); // Open -> Focus delay
                        } else {
                            logToOutput(`[Bump-Step] 2. Skipping 'workbench.action.chat.open' (Configured)`);
                        }

                        // Try specific focus command for GitHub Copilot Chat if available, or fallback to generic
                        logToOutput(`[Bump-Step] 3. Focusing Input ('workbench.action.chat.focusInput')`);
                        await vscode.commands.executeCommand('workbench.action.chat.focusInput');
                        await new Promise((r: any) => setTimeout(r, Math.max(100, typingDelay * 4))); // Focus -> Paste delay

                        logToOutput(`[Bump-Step] 4. Pasting Clipboard`);
                        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                    } catch (e: any) {
                        logToOutput(`[Bump-Error] Text Entry Failed: ${e.message}`);
                    }
                }

                // 2. Submit (Multi-Strategy)
                await new Promise((r: any) => setTimeout(r, submitDelay));
                const commands = [
                    'workbench.action.chat.submit',
                    'workbench.action.chat.send',
                    'interactive.acceptChanges',
                    'workbench.action.terminal.chat.accept',
                    'inlineChat.accept'
                ];

                logToOutput(`[Bump-Step] 5. Submitting via Commands`);
                for (const cmd of commands) {
                    try {
                        // logToOutput(`[Bump-Trace] Trying submit command: ${cmd}`);
                        await vscode.commands.executeCommand(cmd);
                    } catch (e) { }
                }

                // 3. Fallback: Physical Enter Key (CDP)
                await new Promise(r => setTimeout(r, Math.max(100, submitDelay / 2)));
                logToOutput(`[Bump-Step] 6. Fallback CDP Enter Key`);
                await this.dispatchKeyEventToAll({
                    type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
                    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
                    text: '\r', unmodifiedText: '\r'
                });
                await new Promise(r => setTimeout(r, 50));
                await this.dispatchKeyEventToAll({
                    type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
                    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
                    text: '\r', unmodifiedText: '\r'
                });
                logToOutput(`[Bump-End] Hybrid Bump Sequence Complete`);
            } else if (text.startsWith('__ANTIGRAVITY_ACTION__:')) {
                const raw = text.substring('__ANTIGRAVITY_ACTION__:'.length);
                const [groupRaw, detailRaw] = raw.split('|');
                const group = (groupRaw || 'click').trim() as ActionSoundGroup;
                const detail = (detailRaw || '').trim();
                logToOutput(`[AutoAction:${group}] ${detail || 'triggered'}`);
                SoundEffects.playActionGroup(group);

                if (group === 'submit' && detail === 'keys') {
                    // Issue actual CDP Enter keys since DOM dispatchEvent gets ignored by Monaco
                    await this.sendCommand(pageId, 'Input.dispatchKeyEvent', {
                        type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
                        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
                        text: '\r', unmodifiedText: '\r'
                    }, undefined, sessionId);
                    await new Promise(r => setTimeout(r, 60));
                    await this.sendCommand(pageId, 'Input.dispatchKeyEvent', {
                        type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
                        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
                        text: '\r', unmodifiedText: '\r'
                    }, undefined, sessionId);
                }
            } else if (text.startsWith('__ANTIGRAVITY_LOG__:')) {
                const raw = text.substring('__ANTIGRAVITY_LOG__:'.length);
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
                    if (window.__autoAllGetRuntimeState) {
                        return window.__autoAllGetRuntimeState();
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
        const safe = JSON.stringify(String(message));
        const expression = `
            (function() {
                const msg = ${safe};
                const payload = '__ANTIGRAVITY_HYBRID_BUMP__:' + msg;
                if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                    window.__ANTIGRAVITY_BRIDGE__(payload);
                } else {
                    console.log(payload);
                }
                return true;
            })()
        `;
        const results = await this.executeInAllSessions(expression, true);
        if (!Array.isArray(results)) return false;
        return results.some(r => r === true);
    }
    // --- Watchdog ---
    startWatchdogLoop() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);

        this.watchdogInterval = setInterval(async () => {
            const enabled = config.get<boolean>('watchdogEnabled') ?? true;
            if (!enabled) return;

            const timeoutMs = config.get<number>('watchdogTimeoutMs') || 15000;
            const now = Date.now();

            for (const [pageId, conn] of this.connections) {
                try {
                    // Check heartbeat
                    const result = await this.sendCommand(pageId, 'Runtime.evaluate', {
                        expression: 'window.__antigravityHeartbeat',
                        returnByValue: true,
                        awaitPromise: false
                    }, 2000);

                    const lastHeartbeat = result?.result?.value;

                    if (typeof lastHeartbeat === 'number') {
                        const diff = now - lastHeartbeat;
                        if (diff > timeoutMs) {
                            console.log(`[Watchdog] Script dead on ${pageId} (Last heartbeat: ${diff}ms ago). Re-injecting...`);
                            // Force re-injection
                            await this.injectScript(pageId, require('fs').readFileSync(require('path').join(__dirname, '../../../main_scripts/full_cdp_script.js'), 'utf8'), true);
                        }
                    } else {
                        // No heartbeat found (maybe page reloaded?)
                        // If we tracked injection, we could be smarter. For now, assume if connection is open but no heartbeat var, we need to inject.
                        // But we don't want to spam inject on pages that don't need it or are loading.
                        // Check readyState first?
                        const readyState = await this.sendCommand(pageId, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
                        if (readyState?.result?.value === 'complete') {
                            console.log(`[Watchdog] No heartbeat on ready page ${pageId}. Injecting...`);
                            await this.injectScript(pageId, require('fs').readFileSync(require('path').join(__dirname, '../../../main_scripts/full_cdp_script.js'), 'utf8'), true);
                        }
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

