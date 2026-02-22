import * as vscode from 'vscode';
import express = require('express');
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import cors = require('cors');
import { createLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { sendAutoResumeMessage } from '../../core/runtime-auto-resume-guard-effects';

const log = createLogger('RemoteServer');

export class RemoteServer {
    private app: express.Express | null = null;
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private isActive = false;
    private extensionContext: vscode.ExtensionContext;
    private connections: Set<WebSocket> = new Set();

    constructor(context: vscode.ExtensionContext) {
        this.extensionContext = context;
    }

    public async start() {
        if (this.isActive) return;

        try {
            const enabled = config.get<boolean>('remoteControlEnabled');
            if (!enabled) return;

            const port = config.get<number>('remoteControlPort') || 8000;

            this.app = express();
            this.server = http.createServer(this.app);
            this.wss = new WebSocketServer({ server: this.server });

            this.app.use(cors());
            this.app.use(express.json());

            const frontendPath = path.join(this.extensionContext.extensionPath, 'assets', 'remote-ui');
            this.app.use(express.static(frontendPath));

            this.app.get('/api/health', (req, res) => {
                res.json({ status: 'ok', activeConnections: this.connections.size });
            });

            // Mirroring the WebSocket bridge patterns from AntiBridge
            this.wss.on('connection', (ws, req) => {
                const urlPath = req.url || '';

                // Allow direct root connection or /ws/extension legacy paths
                this.connections.add(ws);
                log.info(`Remote client connected on path ${urlPath}`);

                ws.send(JSON.stringify({ type: 'status', message: 'Connected to Antigravity Remote Server' }));

                ws.on('message', async (message) => {
                    try {
                        const data = JSON.parse(message.toString());

                        if (data.type === 'ping') {
                            ws.send('pong');
                            return;
                        }

                        // Handle Send Message from Mobile App
                        if (data.type === 'send_message' && data.text) {
                            log.info(`Remote Client sent message: "${data.text}"`);
                            ws.send(JSON.stringify({ type: 'status', message: '🚀 Sending message...', level: 'info' }));

                            try {
                                await sendAutoResumeMessage('manual', null, { messageOverride: data.text } as any);
                                ws.send(JSON.stringify({ type: 'status', message: '✅ Sent to IDE!', level: 'success' }));
                            } catch (err: any) {
                                ws.send(JSON.stringify({ type: 'status', message: `❌ Failed: ${err.message}`, level: 'error' }));
                            }
                        }
                    } catch (e) {
                        log.error(`WebSocket message error: ${e}`);
                    }
                });

                ws.on('close', () => {
                    log.info('Remote client disconnected');
                    this.connections.delete(ws);
                });

                ws.on('error', (err) => {
                    log.error(`WebSocket client error: ${err.message}`);
                });
            });

            await new Promise<void>((resolve, reject) => {
                this.server!.listen(port, '0.0.0.0', () => {
                    resolve();
                }).on('error', reject);
            });

            this.isActive = true;
            log.info(`Remote Control Server listening on http://localhost:${port}`);
            vscode.window.showInformationMessage(`Antigravity Remote Control active on port ${port} 📱`);
        } catch (error) {
            log.error(`Failed to start RemoteServer: ${error}`);
            vscode.window.showErrorMessage(`Failed to start Remote Control Server: ${(error as Error).message}`);
        }
    }

    public async stop() {
        if (!this.isActive) return;

        for (const ws of this.connections) {
            ws.close();
        }
        this.connections.clear();

        if (this.wss) {
            this.wss.close();
        }

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => resolve());
            });
        }

        this.isActive = false;
        log.info('Remote Control Server stopped');
    }

    public toggle() {
        if (this.isActive) {
            this.stop();
        } else {
            this.start();
        }
    }
}

export const activateRemoteServer = async (context: vscode.ExtensionContext): Promise<RemoteServer> => {
    const server = new RemoteServer(context);
    await server.start();
    return server;
};
