
import { CDPHandler } from '../services/cdp/cdp-handler';
import { createLogger } from '../utils/logger';
import { config } from '../utils/config';

const log = createLogger('CDPClient');

export class CDPClient {
    private handler: CDPHandler;
    private isPro = true;

    constructor() {
        this.handler = new CDPHandler();
    }

    async connect(): Promise<boolean> {
        return await this.handler.connect(); // Assuming handler has a connect method or similar
    }

    isConnected(): boolean {
        return this.handler.isConnected();
    }

    async injectPrompt(prompt: string): Promise<boolean> {
        // Find active tab and inject prompt
        const instances = await this.handler.scanForInstances();
        for (const instance of instances) {
            for (const page of instance.pages) {
                // Simplified check - in reality we might check title or url more robustly
                if (page.url.includes('editor') || page.title.includes('Cursor') || page.title.includes('Visual Studio Code')) {
                    const script = `
                        (function() {
                            // Helper to find chat input
                            function findChatInput() {
                                const inputs = Array.from(document.querySelectorAll('textarea, div[contenteditable="true"]'));
                                for (const input of inputs) {
                                    const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                                    const aria = (input.getAttribute('aria-label') || '').toLowerCase();
                                    if (placeholder.includes('chat') || placeholder.includes('ask') || placeholder.includes('follow up') ||
                                        aria.includes('chat') || aria.includes('input')) {
                                        return input;
                                    }
                                }
                                return inputs.find(i => i.offsetParent !== null); // Fallback to visible
                            }

                            const input = findChatInput();
                            if (input) {
                                input.focus();
                                // React/Monaco often needs native value setter
                                const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                                if (nativeTextAreaValueSetter && input.tagName === 'TEXTAREA') {
                                    nativeTextAreaValueSetter.call(input, ${JSON.stringify(prompt)});
                                } else {
                                    input.value = ${JSON.stringify(prompt)};
                                    input.innerText = ${JSON.stringify(prompt)}; // For contenteditable
                                }
                                
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                
                                // Find send button
                                // Look for button near input with "send" icon or label
                                const container = input.closest('div, form');
                                if (container) {
                                    const buttons = Array.from(container.querySelectorAll('button'));
                                    const sendBtn = buttons.find(b => {
                                        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
                                        return label.includes('send') || label.includes('submit') || b.querySelector('.codicon-send');
                                    });
                                    if (sendBtn) {
                                        setTimeout(() => sendBtn.click(), 100);
                                        return true;
                                    }
                                }
                                // Fallback: try Enter key
                                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                                return true;
                            }
                            return false;
                        })()
                    `;
                    try {
                        const result = await this.handler.sendCommand(page.id, 'Runtime.evaluate', { expression: script, returnByValue: true });
                        if (result && result.result && result.result.value) {
                            log.info('Prompt injected successfully');
                            return true;
                        }
                    } catch (e) {
                        log.error(`Failed to inject prompt: ${e.message}`);
                    }
                }
            }
        }
        return false;
    }

    async waitForResponse(timeoutMs: number): Promise<string> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const instances = await this.handler.scanForInstances();
            for (const instance of instances) {
                for (const page of instance.pages) {
                    if (page.url.includes('editor') || page.title.includes('Cursor')) {
                        const script = `
                            (function() {
                                // Logic to detect if AI is thinking or if last message is from AI and done
                                const messages = Array.from(document.querySelectorAll('.markdown-body, .chat-response')); // Hypothetical selectors
                                if (messages.length === 0) return null;
                                
                                const lastMsg = messages[messages.length - 1];
                                // Check if "thinking" or "generating" indicator exists
                                const isThinking = document.querySelector('.codicon-loading, .typing-indicator');
                                
                                if (!isThinking && lastMsg.innerText.length > 0) {
                                    return lastMsg.innerText;
                                }
                                return null;
                            })()
                        `;
                        try {
                            const result = await this.handler.sendCommand(page.id, 'Runtime.evaluate', { expression: script, returnByValue: true });
                            if (result && result.result && result.result.value) {
                                return result.result.value;
                            }
                        } catch (e) {
                            // Ignore errors during polling
                        }
                    }
                }
            }

            await new Promise(r => setTimeout(r, 1000)); // Poll every 1s
        }

        throw new Error('Timeout waiting for AI response');
    }

    async evaluate(expression: string): Promise<any> {
        const instances = await this.handler.scanForInstances();
        for (const instance of instances) {
            for (const page of instance.pages) {
                if (page.url.includes('editor') || page.title.includes('Cursor') || page.title.includes('Visual Studio Code')) {
                    const result = await this.handler.sendCommand(page.id, 'Runtime.evaluate', {
                        expression,
                        returnByValue: true,
                        awaitPromise: true
                    });
                    if (result && result.result) {
                        return result.result.value;
                    }
                }
            }
        }
        return null;
    }

    async switchModel(modelId: string): Promise<boolean> {
        log.info(`Switching to model ${modelId}`);
        const script = `
            (function() {
                // 1. Find model dropdown (often near top of chat)
                const dropdowns = Array.from(document.querySelectorAll('[aria-label="Model"], .model-selector, .dropdown'));
                const modelDropdown = dropdowns.find(d => d.textContent.includes('Claude') || d.textContent.includes('GPT') || d.textContent.includes('Gemini'));
                
                if (modelDropdown) {
                    modelDropdown.click();
                    // Wait for options to appear (simplified sync wait)
                    // In reality, we might need a separate step, but let's try to find option immediately assuming synchronous DOM update or existing list
                    
                    const options = Array.from(document.querySelectorAll('[role="option"], .dropdown-item'));
                    const targetOption = options.find(o => o.textContent.toLowerCase().includes(${JSON.stringify(modelId.toLowerCase())}));
                    
                    if (targetOption) {
                        targetOption.click();
                        return true;
                    }
                }
                return false;
            })()
        `;

        try {
            // We need to run this on the correct page
            const instances = await this.handler.scanForInstances();
            for (const instance of instances) {
                for (const page of instance.pages) {
                    if (page.url.includes('editor')) {
                        const result = await this.handler.sendCommand(page.id, 'Runtime.evaluate', { expression: script, returnByValue: true });
                        if (result && result.result && result.result.value) {
                            return true;
                        }
                    }
                }
            }
        } catch (e) {
            log.error(`Failed to switch model: ${e.message}`);
        }

        return false;
    }
}

export const cdpClient = new CDPClient();
