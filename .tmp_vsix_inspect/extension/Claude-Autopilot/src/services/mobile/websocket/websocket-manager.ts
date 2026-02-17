import * as WebSocket from 'ws';
import * as http from 'http';
import { debugLog } from '../../../utils/logging';
import { 
    messageQueue, 
    isRunning, 
    claudeOutputBuffer, 
    processingQueue,
    sessionReady
} from '../../../core/state';
import { FileUtils } from '../utils';

export class WebSocketManager {
    private wss: WebSocket.Server | null = null;
    private clients: Set<WebSocket> = new Set();
    private authToken: string;
    private fileUtils: FileUtils;

    constructor(authToken: string) {
        this.authToken = authToken;
        this.fileUtils = new FileUtils();
    }

    public updateAuthToken(authToken: string): void {
        this.authToken = authToken;
    }

    public setupWebSocket(server: http.Server): void {
        if (!server) return;

        this.wss = new WebSocket.Server({ 
            server: server,
            path: '/ws'
        });
        
        this.wss.on('connection', (ws: WebSocket, req) => {
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const token = url.searchParams.get('token');
            
            if (token !== this.authToken) {
                ws.close(1008, 'Unauthorized');
                return;
            }

            debugLog('📱 Mobile client connected');
            this.clients.add(ws);

            const workspace = this.fileUtils.getWorkspaceInfo();
            ws.send(JSON.stringify({
                type: 'initialState',
                data: {
                    status: { isRunning, sessionReady, processingQueue, workspace },
                    queue: this.getQueueData(),
                    output: claudeOutputBuffer
                }
            }));

            ws.on('close', () => {
                debugLog('📱 Mobile client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error: Error) => {
                this.clients.delete(ws);
            });
        });
    }

    private getQueueData() {
        return messageQueue.map(msg => ({
            id: msg.id,
            text: msg.text.substring(0, 200) + (msg.text.length > 200 ? '...' : ''),
            status: msg.status,
            timestamp: msg.timestamp
        }));
    }

    public broadcastToClients(message: any): void {
        const messageStr = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    }

    public notifyQueueUpdate(): void {
        this.broadcastToClients({ 
            type: 'queueUpdate', 
            queue: this.getQueueData() 
        });
    }

    public notifyStatusUpdate(): void {
        const workspace = this.fileUtils.getWorkspaceInfo();
        this.broadcastToClients({ 
            type: 'statusUpdate',
            status: { isRunning, sessionReady, processingQueue, workspace }
        });
    }

    public notifyOutputUpdate(): void {
        this.broadcastToClients({ 
            type: 'outputUpdate', 
            output: claudeOutputBuffer,
            timestamp: Date.now()
        });
    }

    public close(): void {
        this.clients.forEach(client => {
            client.close();
        });
        this.clients.clear();

        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }

    public getClientCount(): number {
        return this.clients.size;
    }
}