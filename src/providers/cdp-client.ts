
import { CDPHandler } from '../services/cdp/cdp-handler';
import { createLogger } from '../utils/logger';
import { config } from '../utils/config';

const log = createLogger('CDPClient');

export class CDPClient {
    private handler: CDPHandler;
    private isPro = true;

    constructor() {
        const configuredPortRaw = config.get<number | string>('cdpPort');
        const configuredPort = typeof configuredPortRaw === 'string' ? parseInt(configuredPortRaw, 10) : configuredPortRaw;
        if (typeof configuredPort === 'number' && Number.isFinite(configuredPort) && configuredPort > 0) {
            this.handler = new CDPHandler(configuredPort, configuredPort);
        } else {
            this.handler = new CDPHandler();
        }
    }

    getHandler(): CDPHandler {
        return this.handler;
    }

    async connect(): Promise<boolean> {
        return await this.handler.connect();
    }

    isConnected(): boolean {
        return this.handler.isConnected();
    }

    async sendMessage(text: string): Promise<boolean> {
        const script = `(function() {
            const runtimeLeader = window.__antigravityConfig?.runtime?.isLeader;
            if (runtimeLeader !== true) {
                return false;
            }

            if (document.visibilityState !== 'visible') {
                return false;
            }

            if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
                return false;
            }

            if (typeof window.__antigravityTypeAndSubmit === 'function') {
                return window.__antigravityTypeAndSubmit(${JSON.stringify(text)}) === true;
            }

            // Hard safety: do not use legacy broad textarea/keyboard fallback here.
            // That fallback can target terminal/explorer surfaces in forked UIs.
            // Caller should rely on injected runtime APIs or bridge-controlled strategies only.
            return false;
        })()`;

        try {
            const result = await this.handler.executeInFirstTruthySession(script, true);
            if (result === true) {
                log.info('Sent message: ' + text);
                return true;
            }
        } catch (e: any) {
            log.error('Failed to send message: ' + e.message);
        }
        return false;
    }

    async injectPrompt(prompt: string): Promise<boolean> {
        return this.sendMessage(prompt);
    }

    async waitForResponse(timeoutMs: number): Promise<string> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const script = `(function() {
                // Logic to detect if AI is thinking or if last message is from AI and done
                const messages = Array.from(document.querySelectorAll('.markdown-body, .chat-response'));
                if (messages.length === 0) return null;
                
                const lastMsg = messages[messages.length - 1];
                // Check if "thinking" or "generating" indicator exists
                const isThinking = document.querySelector('.codicon-loading, .typing-indicator');
                
                if (!isThinking && lastMsg.innerText.length > 0) {
                    return lastMsg.innerText;
                }
                return null;
            })()`;

            try {
                const results = await this.handler.executeInAllSessions(script, true);
                const successfulResult = results.find(r => typeof r === 'string' && r.length > 0);
                if (successfulResult) {
                    return successfulResult;
                }
            } catch (e) {
                // Ignore errors during polling
            }

            await new Promise(r => setTimeout(r, 1000)); // Poll every 1s
        }

        throw new Error('Timeout waiting for AI response');
    }

    async evaluate(expression: string): Promise<any> {
        try {
            const results = await this.handler.executeInAllSessions(expression, true);
            return results.length > 0 ? results[0] : null;
        } catch {
            return null;
        }
    }

    async switchModel(modelId: string): Promise<boolean> {
        log.info('Switching to model ' + modelId);
        // ... (existing implementation)
        return false;
    }

    async sendHybridBump(message: string): Promise<boolean> {
        return this.handler.sendHybridBump(message);
    }
}

export const cdpClient = new CDPClient();
