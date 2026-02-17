import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { debugLog } from '../../utils/logging';
import { AuthManager, AuthConfig } from './auth/';
import { StaticRoutes, APIRoutes } from './routes';
import { WebSocketManager } from './websocket/';
import { ServerManager } from './server';
import { FileSearchService } from './search';
import { MESSAGE_TYPES } from './types';

export class MobileServer {
    private authManager: AuthManager;
    private staticRoutes: StaticRoutes;
    private apiRoutes: APIRoutes;
    private webSocketManager: WebSocketManager;
    private serverManager: ServerManager;
    private fileSearchService: FileSearchService;
    private config: AuthConfig;

    constructor() {
        this.config = {
            authToken: uuidv4(),
            useExternalServer: false,
            webPassword: '',
            passwordAttempts: new Map(),
            blockedIPs: new Set(),
            activeSessions: new Set()
        };
        
        this.loadConfiguration();
        
        this.authManager = new AuthManager(this.config, () => this.stop());
        this.staticRoutes = new StaticRoutes(this.authManager, this.config);
        this.fileSearchService = new FileSearchService();
        this.apiRoutes = new APIRoutes(this.authManager, this.config, this.fileSearchService);
        this.webSocketManager = new WebSocketManager(this.config.authToken);
        this.serverManager = new ServerManager(this.authManager, this.config);
        
        this.setupRoutes();
        this.setupNotificationCallbacks();
    }

    private loadConfiguration(): void {
        const vsCodeConfig = vscode.workspace.getConfiguration('claudeAutopilot');
        this.config.useExternalServer = vsCodeConfig.get<boolean>('webInterface.useExternalServer', false);
        this.config.webPassword = vsCodeConfig.get<string>('webInterface.password', '');
        
        if (this.authManager) {
            this.authManager.updateConfig(this.config);
        }
        if (this.staticRoutes) {
            this.staticRoutes.updateConfig(this.config);
        }
        if (this.webSocketManager) {
            this.webSocketManager.updateAuthToken(this.config.authToken);
        }
        if (this.serverManager) {
            this.serverManager.updateConfig(this.config);
        }
    }

    private setupRoutes(): void {
        const app = this.serverManager.getApp();
        
        this.staticRoutes.setupRoutes(app);
        this.apiRoutes.setupRoutes(app);
    }

    private setupNotificationCallbacks(): void {
        this.apiRoutes.setNotificationCallback((type: string) => {
            switch (type) {
                case MESSAGE_TYPES.QUEUE_UPDATE:
                    this.webSocketManager.notifyQueueUpdate();
                    break;
                case MESSAGE_TYPES.STATUS_UPDATE:
                    this.webSocketManager.notifyStatusUpdate();
                    break;
                case MESSAGE_TYPES.OUTPUT_UPDATE:
                    this.webSocketManager.notifyOutputUpdate();
                    break;
                case 'queueUpdate':
                    this.webSocketManager.broadcastToClients({ type: 'queueUpdate', queue: [] });
                    break;
            }
        });
    }

    public async start(): Promise<string> {
        this.loadConfiguration();
        
        const url = await this.serverManager.start();
        
        const httpServer = this.serverManager.getHttpServer();
        if (httpServer) {
            this.webSocketManager.setupWebSocket(httpServer);
        }
        
        return url;
    }

    public async stop(): Promise<void> {
        this.webSocketManager.close();
        await this.serverManager.stop();
        this.authManager.clearSessions();
    }

    public async generateQRCode(): Promise<string> {
        return this.serverManager.generateQRCode();
    }

    public getServerUrl(): string {
        return this.serverManager.getServerUrl();
    }

    public getServerStatus(): { 
        running: boolean; 
        url: string; 
        isExternal: boolean; 
        hasPassword: boolean;
        blockedIPs: number;
    } {
        return this.serverManager.getServerStatus();
    }

    public getWebUrl(): string | null {
        return this.serverManager.getWebUrl();
    }

    public getAuthToken(): string {
        return this.config.authToken;
    }

    public isRunning(): boolean {
        return this.serverManager.isRunning();
    }

    public notifyQueueUpdate(): void {
        this.webSocketManager.notifyQueueUpdate();
    }

    public notifyStatusUpdate(): void {
        this.webSocketManager.notifyStatusUpdate();
    }

    public notifyOutputUpdate(): void {
        this.webSocketManager.notifyOutputUpdate();
    }
}

let server: MobileServer | null = null;

export function getMobileServer(): MobileServer {
    if (!server) {
        server = new MobileServer();
    }
    return server;
}
