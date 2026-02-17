import express from 'express';
import cookieParser from 'cookie-parser';
import * as http from 'http';
import { AddressInfo } from 'net';
import { NetworkInterfaceInfo } from 'os';
import { spawn, ChildProcess } from 'child_process';
import * as QRCode from 'qrcode';
import { debugLog } from '../../../utils/logging';
import { AuthManager, AuthConfig } from '../auth/';
import { wrapCommandForWSL } from '../../../utils/wsl-helper';

export class ServerManager {
    private app: express.Application;
    private server: http.Server | null = null;
    private ngrokUrl: string | null = null;
    private ngrokProcess: ChildProcess | null = null;
    private isServerRunning = false;
    private authManager: AuthManager;
    private config: AuthConfig;

    constructor(authManager: AuthManager, config: AuthConfig) {
        this.app = express();
        this.authManager = authManager;
        this.config = config;
        this.setupMiddleware();
    }

    public updateConfig(config: AuthConfig): void {
        const wasExternalMode = this.config.useExternalServer && this.config.webPassword;
        const isNowLocalMode = !config.useExternalServer || !config.webPassword;
        
        this.config = config;
        this.authManager.updateConfig(config);
        
        // Clear sessions when switching from external to local mode
        if (wasExternalMode && isNowLocalMode) {
            this.authManager.clearSessions();
            debugLog('🔄 Cleared sessions due to mode switch from external to local');
        }
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(cookieParser());
        
        // Basic auth middleware for API routes only
        this.app.use('/api', this.authManager.getApiAuthMiddleware());

        // Apply dynamic password middleware to API routes
        this.app.use('/api', (req, res, next) => {
            // Check current config state dynamically
            if (this.config.useExternalServer && this.config.webPassword) {
                return this.authManager.getPasswordAuthMiddleware()(req, res, next);
            }
            // Skip password auth for local mode
            next();
        });
    }

    public getApp(): express.Application {
        return this.app;
    }

    private async startNgrokTunnel(port: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const ngrokArgs = ['http', port.toString(), '--region', 'us', '--log', 'stdout'];
            
            debugLog(`🚀 Starting ngrok with args: ${ngrokArgs.join(' ')}`);
            
            const { command, args: wrappedArgs } = wrapCommandForWSL('ngrok', ngrokArgs);
            this.ngrokProcess = spawn(command, wrappedArgs, {
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let output = '';
            let urlFound = false;

            this.ngrokProcess.stdout?.on('data', (data) => {
                output += data.toString();
                
                // Look for the tunnel URL in the output
                const urlMatch = output.match(/url=https?:\/\/[^\s]+/);
                if (urlMatch && !urlFound) {
                    urlFound = true;
                    const url = urlMatch[0].replace('url=', '');
                    debugLog(`✅ Ngrok tunnel established: ${url}`);
                    resolve(url);
                }
            });

            this.ngrokProcess.stderr?.on('data', (data) => {
                const errorText = data.toString();
                debugLog(`🔴 Ngrok stderr: ${errorText}`);
                
                // Check for common error patterns and provide helpful error messages
                if (errorText.includes('authentication failed') && errorText.includes('simultaneous ngrok agent sessions')) {
                    reject(new Error('Another ngrok session is already running. Please stop other ngrok processes or upgrade your ngrok account for multiple sessions.'));
                } else if (errorText.includes('ERR_NGROK_108')) {
                    reject(new Error('Ngrok session limit reached. Stop other ngrok processes or upgrade your account: https://dashboard.ngrok.com/agents'));
                } else if (errorText.includes('authentication failed')) {
                    reject(new Error('Ngrok authentication failed. Run: ngrok config add-authtoken <your-token>'));
                }
            });

            this.ngrokProcess.on('error', (error) => {
                debugLog(`❌ Ngrok process error: ${error.message}`);
                reject(new Error(`Failed to start ngrok: ${error.message}`));
            });

            this.ngrokProcess.on('exit', (code) => {
                if (code !== 0 && !urlFound) {
                    debugLog(`❌ Ngrok exited with code: ${code}`);
                    reject(new Error(`Ngrok process exited with code ${code}`));
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                if (!urlFound) {
                    this.ngrokProcess?.kill();
                    reject(new Error('Ngrok tunnel setup timeout'));
                }
            }, 30000);
        });
    }

    public async start(): Promise<string> {
        if (this.isServerRunning) {
            throw new Error('Web server is already running');
        }

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(0, '0.0.0.0', async () => {
                try {
                    const address = this.server?.address() as AddressInfo;
                    const port = address?.port;
                    if (!port) {
                        throw new Error('Failed to get server port');
                    }
                    debugLog(`🌐 Web server started on port ${port}`);
                    
                    let publicUrl: string;
                    
                    if (this.config.useExternalServer) {
                        try {
                            const ngrokUrl = await this.startNgrokTunnel(port);
                            this.ngrokUrl = ngrokUrl;
                            publicUrl = this.ngrokUrl;
                            debugLog(`🌍 External server (ngrok): ${this.ngrokUrl}`);
                        } catch (error) {
                            debugLog(`❌ Failed to start ngrok tunnel: ${error}`);
                            throw error;
                        }
                    } else {
                        const networkInterfaces = require('os').networkInterfaces();
                        let localIP = 'localhost';
                        
                        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
                            if (interfaces) {
                                for (const iface of interfaces as NetworkInterfaceInfo[]) {
                                    if (iface.family === 'IPv4' && !iface.internal) {
                                        localIP = iface.address;
                                        break;
                                    }
                                }
                                if (localIP !== 'localhost') break;
                            }
                        }
                        
                        publicUrl = `http://${localIP}:${port}`;
                        debugLog(`🏠 Local network server: ${publicUrl}`);
                    }
                    
                    this.isServerRunning = true;
                    resolve(publicUrl);
                } catch (error) {
                    debugLog(`❌ Failed to start web server: ${error}`);
                    reject(error);
                }
            });

            this.server.on('error', (error) => {
                debugLog(`❌ Web server error: ${error}`);
                reject(error);
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.isServerRunning) {
            return;
        }

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server!.close(() => resolve());
            });
            this.server = null;
        }

        if (this.ngrokProcess) {
            try {
                debugLog('🔄 Stopping ngrok process...');
                this.ngrokProcess.kill('SIGTERM');
                this.ngrokProcess = null;
            } catch (error) {
                debugLog(`⚠️ Error stopping ngrok process: ${error}`);
            }
            this.ngrokUrl = null;
        }

        this.isServerRunning = false;
        debugLog('📱 Mobile server stopped');
    }

    public async generateQRCode(): Promise<string> {
        if (!this.isServerRunning) {
            throw new Error('Web server is not running');
        }

        const webUrl = this.getWebUrl();
        if (!webUrl) {
            throw new Error('Failed to get web URL for QR code');
        }
        
        debugLog(`📱 QR Code URL: ${webUrl}`);
        
        return QRCode.toDataURL(webUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
    }

    public getServerUrl(): string {
        if (!this.isServerRunning) {
            return '';
        }
        
        if (this.config.useExternalServer && this.ngrokUrl) {
            return this.ngrokUrl;
        }
        
        const address = this.server?.address() as AddressInfo;
        const port = address?.port;
        if (!port) return '';
        
        const networkInterfaces = require('os').networkInterfaces();
        let localIP = 'localhost';
        
        for (const [name, interfaces] of Object.entries(networkInterfaces)) {
            if (interfaces) {
                for (const iface of interfaces as NetworkInterfaceInfo[]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        localIP = iface.address;
                        break;
                    }
                }
                if (localIP !== 'localhost') break;
            }
        }
        
        return `http://${localIP}:${port}`;
    }

    public getServerStatus(): { 
        running: boolean; 
        url: string; 
        isExternal: boolean; 
        hasPassword: boolean;
        blockedIPs: number;
    } {
        return {
            running: this.isServerRunning,
            url: this.getServerUrl(),
            isExternal: this.config.useExternalServer,
            hasPassword: this.config.useExternalServer && !!this.config.webPassword,
            blockedIPs: this.authManager.getBlockedIPsCount()
        };
    }

    public getWebUrl(): string | null {
        if (!this.isServerRunning) {
            return null;
        }
        
        const baseUrl = this.getServerUrl();
        if (!baseUrl) {
            return null;
        }
        
        const webUrl = `${baseUrl}?token=${this.config.authToken}`;
        return webUrl;
    }

    public isRunning(): boolean {
        return this.isServerRunning;
    }

    public getHttpServer(): http.Server | null {
        return this.server;
    }
}