import WebSocket from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { config } from '../../utils/config';

export class CDPHandler extends EventEmitter {
    private startPort: number;
    private endPort: number;
    private connections: Map<string, any>;
    private messageId: number;
    private pendingMessages: Map<number, { resolve: Function, reject: Function }>;
    private timeoutMs: number;

    constructor(startPort = 9000, endPort = 9030) {
        super();
        this.startPort = startPort;
        this.endPort = endPort;
        this.connections = new Map();
        this.messageId = 1;
        this.pendingMessages = new Map();
        this.timeoutMs = config.get<number>('cdpTimeout') || 10000;
    }

    async scanForInstances(): Promise<{ port: number, pages: any[] }[]> {
        const instances = [];
        const additionalPorts = [9222, 9229];
        const portsToCheck = new Set<number>();

        // Add configured range
        for (let p = this.startPort; p <= this.endPort; p++) portsToCheck.add(p);
        // Add standard ports
        additionalPorts.forEach(p => portsToCheck.add(p));

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
        report += `Scanning ports: ${this.startPort}-${this.endPort}, 9222, 9229\n\n`;

        if (instances.length === 0) {
            report += 'No active CDP instances found.\n';
            report += 'Ensure VS Code is launched with --remote-debugging-port=9222 (or similar).\n';
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
                this.connections.set(page.id, { ws, injected: false, sessions: new Set() });

                try {
                    // 1. Enable Runtime on Main Page
                    await this.sendCommand(page.id, 'Runtime.enable');
                    await this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' });

                    // 3. Explicit Target Discovery (Belt & Suspenders)
                    const { targetInfos } = await this.sendCommand(page.id, 'Target.getTargets');
                    if (targetInfos) {
                        for (const info of targetInfos) {
                            if (['webview', 'iframe', 'other'].includes(info.type)) {
                                console.log(`[CDP] Explicitly attaching to existing target: ${info.type} ${info.url}`);
                                this.sendCommand(page.id, 'Target.attachToTarget', { targetId: info.targetId, flatten: true })
                                    .catch(e => console.error(`[CDP] Failed to attach to ${info.targetId}:`, e));
                            }
                        }
                    }

                    // 2. Enable Discovery (Phase 38: Aggressive)
                    // We need this to find the OOP Chat Iframe
                    await this.sendCommand(page.id, 'Target.setDiscoverTargets', { discover: true });
                } catch (e) {
                    console.log('[CDP] Setup failed', e);
                }

                resolve(true);
            });
            ws.on('message', async (data: any) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // Phase 38: Aggressive Attachment
                    if (msg.method === 'Target.targetCreated') {
                        const info = msg.params.targetInfo;
                        // Log for diagnosis
                        // console.log(`[CDP] Target: ${info.type} - ${info.url}`);

                        if (info.type === 'webview' || info.type === 'iframe' || info.type === 'other') {
                            // Attach to everything that looks nested
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
                        this.handleBridgeMessage(page.id, text, originSessionId);
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

    async connect(): Promise<boolean> {
        const instances = await this.scanForInstances();
        let connectedCount = 0;

        for (const instance of instances) {
            for (const page of instance.pages) {
                if (this.connections.has(page.id)) {
                    connectedCount++;
                    continue;
                }

                const ok = await this.connectToPage(page);
                if (ok) {
                    connectedCount++;
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
                console.log(`[Bridge] Hybrid Bump Triggered: "${bumpText}"`);
                const vscode = require('vscode');

                if (bumpText) {
                    await vscode.env.clipboard.writeText(bumpText);
                    await vscode.commands.executeCommand('workbench.action.chat.open');
                    await new Promise((r: any) => setTimeout(r, 300));
                    await vscode.commands.executeCommand('workbench.action.chat.focusInput');
                    await new Promise((r: any) => setTimeout(r, 200));
                    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                }

                // 2. Submit (Multi-Strategy)
                await new Promise((r: any) => setTimeout(r, 800));
                const commands = [
                    'workbench.action.chat.submit',
                    'workbench.action.chat.send',
                    'interactive.acceptChanges',
                    'workbench.action.terminal.chat.accept',
                    'inlineChat.accept'
                ];
                for (const cmd of commands) {
                    try { await vscode.commands.executeCommand(cmd); } catch (e) { }
                }

                // 3. Fallback: Physical Enter Key (CDP)
                await new Promise(r => setTimeout(r, 200));
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
            }
        } catch (e) {
            console.error('Bridge Message Handler Error', e);
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
}

