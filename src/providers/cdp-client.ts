
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
        return await this.handler.connect();
    }

    isConnected(): boolean {
        return this.handler.isConnected();
    }

    async sendMessage(text: string): Promise<boolean> {
        // Find active tab and send message
        const instances = await this.handler.scanForInstances();
        for (const instance of instances) {
            for (const page of instance.pages) {
                if (page.url.includes('editor') || page.title.includes('Cursor') || page.title.includes('Visual Studio Code')) {
                    const script = `(function() {
                        function findChatInput() {
                            // 1. Try common selectors
                            const selectors = [
                                'textarea', 
                                'div[contenteditable="true"]', 
                                '[role="textbox"]',
                                '.monaco-editor textarea',
                                '.input-area textarea'
                            ];
                            
                            const inputs = Array.from(document.querySelectorAll(selectors.join(',')));
                            
                            // 2. Filter for potential chat inputs
                            for (const input of inputs) {
                                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                                const aria = (input.getAttribute('aria-label') || '').toLowerCase();
                                const className = (input.className || '').toLowerCase();
                                
                                // High confidence matches
                                if (placeholder.includes('chat') || placeholder.includes('ask') || placeholder.includes('follow up') || placeholder.includes('type') ||
                                    aria.includes('chat') || aria.includes('input') || aria.includes('message') ||
                                    className.includes('chat') || className.includes('composer')) {
                                    
                                    // Ensure it's visible
                                    if (input.offsetParent !== null) return input;
                                }
                            }
                            
                            // 3. Fallback: Any visible textarea/textbox that is likely the main input
                            return inputs.find(i => i.offsetParent !== null && i.clientHeight > 10);
                        }

                        let input = findChatInput();
                        if (!input) {
                            // Ultimate Fallback: Active active element if it looks editable
                            const active = document.activeElement;
                            if (active && (active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true' || active.tagName === 'INPUT')) {
                                input = active;
                            }
                        }

                        if (input) {
                            input.focus();
                            
                            // 0. Clearing any existing popups/autocompletes
                            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                            
                            // Method 1: execCommand (Best for contenteditable/monaco)
                            const success = document.execCommand('insertText', false, text);
                            
                            // Method 2: Native Setter (Fallback for React inputs)
                            if (!success) {
                                const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                                if (input.tagName === 'TEXTAREA' && nativeTextAreaValueSetter) {
                                    nativeTextAreaValueSetter.call(input, ${JSON.stringify(text)});
                                } else {
                                    input.value = ${JSON.stringify(text)};
                                    input.innerText = ${JSON.stringify(text)};
                                }
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            
                            // Wait a split second for UI to update, then click send
                            setTimeout(() => {
                                // Look for button near input with "send" icon or label
                                const container = input.closest('div, form, .input-box, .chat-input-container, .input-row');
                                let sendBtn = null;
                                
                                if (container) {
                                    const buttons = Array.from(container.querySelectorAll('button, [role="button"], .codicon-send, .monaco-button'));
                                    sendBtn = buttons.find(b => {
                                        const label = (b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
                                        const cls = (b.className || '').toLowerCase();
                                        const title = (b.getAttribute('title') || '').toLowerCase();
                                        return label.includes('send') || label.includes('submit') || cls.includes('send') || title.includes('send');
                                    });
                                }
                                
                                if (sendBtn) {
                                    sendBtn.click();
                                } else {
                                    // Fallback: Enter key (and Shift+Enter just in case, but usually Enter sends)
                                    const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
                                    input.dispatchEvent(enter);
                                }
                            }, 200);

                            return true;
                        }
                        return false;
                    })()`;

                    try {
                        const result = await this.handler.sendCommand(page.id, 'Runtime.evaluate', { expression: script, returnByValue: true });
                        if (result && result.result && result.result.value) {
                            log.info('Sent message: ' + text);
                            return true;
                        }
                    } catch (e: any) {
                        log.error('Failed to send message: ' + e.message);
                    }
                }
            }
        }
        return false;
    }

    async injectPrompt(prompt: string): Promise<boolean> {
        return this.sendMessage(prompt);
    }

    async waitForResponse(timeoutMs: number): Promise<string> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const instances = await this.handler.scanForInstances();
            for (const instance of instances) {
                for (const page of instance.pages) {
                    if (page.url.includes('editor') || page.title.includes('Cursor')) {
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
        log.info('Switching to model ' + modelId);
        const script = `(function() {
            // 1. Find model dropdown (often near top of chat)
            const dropdowns = Array.from(document.querySelectorAll('[aria-label="Model"], .model-selector, .dropdown'));
            const modelDropdown = dropdowns.find(d => d.textContent.includes('Claude') || d.textContent.includes('GPT') || d.textContent.includes('Gemini'));
            
            if (modelDropdown) {
                modelDropdown.click();
                
                const options = Array.from(document.querySelectorAll('[role="option"], .dropdown-item'));
                const targetOption = options.find(o => o.textContent.toLowerCase().includes(${JSON.stringify(modelId.toLowerCase())}));
                
                if (targetOption) {
                    targetOption.click();
                    return true;
                }
            }
            return false;
        })()`;

        try {
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
        } catch (e: any) {
            log.error('Failed to switch model: ' + e.message);
        }

        return false;
    }
}

export const cdpClient = new CDPClient();
