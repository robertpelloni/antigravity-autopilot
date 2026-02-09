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
        for (let port = this.startPort; port <= this.endPort; port++) {
            try {
                const pages = await this.getPages(port);
                if (pages.length > 0) instances.push({ port, pages });
            } catch (e) { }
        }
        return instances;
    }

    getPages(port: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/json/list', timeout: 1000 }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(data);
                        // Phase 27: Intelligent Filter (Regression Fix)
                        // v4.3.3 worked with "page". v4.6.x failed with "all".
                        // We must exclude "node" and "service_worker" to prevent crashes.
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

                // Enable Runtime to receive console messages & binding calls
                await this.sendCommand(page.id, 'Runtime.enable');
                await this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' });

                // Phase 31: Restore AutoAttach (Needed for OOP Iframes)
                try {
                    await this.sendCommand(page.id, 'Target.setAutoAttach', {
                        autoAttach: true,
                        waitForDebuggerOnStart: false,
                        flatten: true
                    });
                } catch (e) {
                    console.log('[CDP] AutoAttach failed (harmless if target mismatch)', e);
                }

                resolve(true);
            });
            ws.on('message', async (data: any) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // Phase 31: Handle Child Targets (Strictly)
                    if (msg.method === 'Target.attachedToTarget') {
                        const sessionId = msg.params.sessionId;
                        const type = msg.params.targetInfo.type;
                        // Filter: Only care about iframes/webviews
                        if (type === 'iframe' || type === 'webview' || type === 'page') {
                            // Enable Runtime on child session
                            this.sendCommand(page.id, 'Runtime.enable', {}, undefined, sessionId).catch(() => { });
                            this.sendCommand(page.id, 'Runtime.addBinding', { name: '__ANTIGRAVITY_BRIDGE__' }, undefined, sessionId).catch(() => { });

                            this.emit('sessionAttached', { pageId: page.id, sessionId, type, url: msg.params.targetInfo.url });
                        }
                    }

                    // Phase 30: Capture Context Creation
                    if (msg.method === 'Runtime.executionContextCreated') {
                        const ctx = msg.params.context;
                        // Emit so Strategy can inject
                        this.emit('contextCreated', { pageId: page.id, contextId: ctx.id, origin: ctx.origin, sessionId: msg.sessionId });
                    }

                    if (msg.id && this.pendingMessages.has(msg.id)) {
                        const { resolve: res, reject: rej } = this.pendingMessages.get(msg.id)!;
                        this.pendingMessages.delete(msg.id);
                        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
                    } else if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__ANTIGRAVITY_BRIDGE__') {
                        // ROBUST Binding Bridge (Check sessionId!)
                        const payload = msg.params.payload;
                        const originSessionId = msg.sessionId; // If flat, this is set
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
        return instances.length > 0;
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
                // ... (existing command logic doesn't need sessionId as it runs in Extension Host)
                // BUT: We might want to know WHICH target sent it contextually?
                // Probably not for global commands.
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
            }
        } catch (e) {
            console.error('Bridge Message Handler Error', e);
        }
    }

}
