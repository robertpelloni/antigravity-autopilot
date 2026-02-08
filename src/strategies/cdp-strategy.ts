import * as vscode from 'vscode';
import { IStrategy } from './interface';
import { CDPHandler } from '../services/cdp/cdp-handler';
// @ts-ignore
import { Relauncher } from '../../main_scripts/relauncher.js'; // Requires JS import in TS if generic
import { config } from '../utils/config';
import * as path from 'path';
import * as fs from 'fs';

export class CDPStrategy implements IStrategy {
    name = 'CDP Strategy';
    isActive = false;
    private cdpHandler: CDPHandler;
    private relauncher: any; // Relauncher is JS class
    private pollTimer: NodeJS.Timeout | null = null;
    private logger: (msg: string) => void;

    constructor(private context: vscode.ExtensionContext) {
        const cdpPort = config.get<number>('cdpPort') || 9000;
        this.cdpHandler = new CDPHandler(cdpPort, cdpPort + 30);

        // Use absolute path for require
        try {
            const relauncherPath = this.context.asAbsolutePath(path.join('main_scripts', 'relauncher.js'));
            const { Relauncher } = require(relauncherPath);
            this.relauncher = new Relauncher();
        } catch (e) {
            console.error('Failed to load relauncher:', e);
        }

        this.logger = (msg: string) => console.log(`[CDPStrategy] ${msg}`);
    }

    async start(): Promise<void> {
        if (this.isActive) return;

        if (!this.relauncher) {
            vscode.window.showErrorMessage('Antigravity: Relauncher module not loaded. Check logs.');
            await config.update('autoAllEnabled', false); // Sync config
            return;
        }

        // 1. Check if CDP is available
        const isCdpRunning = await this.relauncher.isCDPRunning();
        if (!isCdpRunning) {
            const result = await this.relauncher.showRelaunchPrompt();
            if (result !== 'relaunched') {
                vscode.window.showWarningMessage('Antigravity: CDP Mode requires a relaunch to function.');
                await config.update('autoAllEnabled', false); // Sync config
                return;
            }
            return;
        }

        // 2. Start CDP Handler
        this.isActive = true;
        // Status bar is handled by extension.ts listener on config change

        try {
            const ide = vscode.env.appName.toLowerCase().includes('cursor') ? 'cursor' : 'antigravity';

            // DEBUG PATHS
            const extPath = this.context.extensionPath;
            console.log(`[DEBUG] Extension Path: ${extPath}`);
            const scriptPath = path.join(extPath, 'main_scripts', 'full_cdp_script.js');

            if (!fs.existsSync(scriptPath)) {
                throw new Error(`CDP Script not found at: ${scriptPath}`);
            }
            const scriptContent = fs.readFileSync(scriptPath, 'utf8');

            // Initial connection
            await this.connectAndInject(scriptContent, ide);

            // 3. Start Polling Loop to ensure all tabs are injected
            const pollFreq = config.get<number>('pollFrequency') || 2000;
            this.pollTimer = setInterval(async () => {
                await this.connectAndInject(scriptContent, ide);
            }, 5000); // Check for new tabs every 5s

            vscode.window.showInformationMessage('Antigravity: Auto-All ON (CDP Mode) 🚀');

        } catch (e: any) {
            this.isActive = false;
            await config.update('autoAllEnabled', false); // Sync config
            const msg = `Antigravity CDP Error: ${e.message}. \nTry restarting VS Code manually with --remote-debugging-port=9222 if this persists.`;
            vscode.window.showErrorMessage(msg);
            console.error(msg);
        }
    }

    private async connectAndInject(script: string, ide: string) {
        // Scan and connect to all pages
        const instances = await this.cdpHandler.scanForInstances();
        for (const instance of instances) {
            for (const page of instance.pages) {
                const connected = await this.cdpHandler.connectToPage(page);
                if (connected) {
                    await this.cdpHandler.injectScript(page.id, script);

                    // Send Start Command
                    await this.cdpHandler.sendCommand(page.id, 'Runtime.evaluate', {
                        expression: `(function(){
                            const g = (typeof window !== 'undefined') ? window : self;
                            if(g && g.__autoAllStart){
                                g.__autoAllStart({
                                    ide: '${ide}',
                                    isPro: true,
                                    isBackgroundMode: ${config.get('multiTabEnabled')},
                                    pollInterval: ${config.get('pollFrequency')},
                                    bannedCommands: ${JSON.stringify(config.get('bannedCommands'))},
                                    threadWaitInterval: ${config.get('threadWaitInterval')},
                                    autoApproveDelay: ${config.get('autoApproveDelay')},
                                    bumpMessage: ${JSON.stringify(config.get('bumpMessage') || 'bump')},
                                    acceptPatterns: ${JSON.stringify(config.get('acceptPatterns') || [])},
                                    rejectPatterns: ${JSON.stringify(config.get('rejectPatterns') || [])}
                                });
                            }
                        })()`
                    });
                }
            }
        }
    }

    async stop(): Promise<void> {
        if (!this.isActive) return;
        this.isActive = false;

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Send Stop Command to all pages
        const instances = await this.cdpHandler.scanForInstances(); // Get current pages
        for (const instance of instances) {
            for (const page of instance.pages) {
                await this.cdpHandler.sendCommand(page.id, 'Runtime.evaluate', {
                    expression: 'if(typeof window !== "undefined" && window.__autoAllStop) window.__autoAllStop()'
                }).catch(() => { });
            }
        }

        this.cdpHandler.disconnectAll();
        vscode.window.showInformationMessage('Antigravity: Auto-All OFF');
    }

    dispose() {
        this.stop();
    }
}
