/**
 * Interaction Method Registry
 * Every method for text input, clicking, and submission is registered here.
 * Users configure which methods are active and their priority/timing.
 *
 * @module strategies/interaction-methods
 */

// ============ Interfaces ============

export interface InteractionContext {
    cdpHandler?: any;       // CDPHandler instance (optional - not all methods need it)
    vscodeCommands?: any;   // vscode.commands proxy
    text?: string;          // Text to type (for text/submit methods)
    selector?: string;      // CSS selector (for click methods)
    coordinates?: { x: number; y: number }; // Screen coordinates
    commandId?: string;     // VS Code command ID
}

export interface IInteractionMethod {
    id: string;
    name: string;
    description: string;
    category: 'text' | 'click' | 'submit';
    enabled: boolean;
    priority: number;       // Lower = tried first
    timingMs: number;       // Delay after execution (ms)
    requiresCDP: boolean;   // Does this method need a CDP connection?
    execute(ctx: InteractionContext): Promise<boolean>;
}

export interface InteractionResult {
    methodId: string;
    success: boolean;
    durationMs: number;
    error?: string;
}

export interface RegistryConfig {
    textInput: string[];
    click: string[];
    submit: string[];
    timings: Record<string, number>;
    retryCount: number;
    parallelExecution: boolean;
}

// ============ Text Input Methods ============

export class CDPKeyDispatch implements IInteractionMethod {
    id = 'cdp-keys';
    name = 'CDP Key Dispatch';
    description = 'Simulates keyDown/keyUp events via Chrome DevTools Protocol';
    category = 'text' as const;
    enabled = true;
    priority = 1;
    timingMs = 10;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.text) return false;
        for (const char of ctx.text) {
            await ctx.cdpHandler.dispatchKeyEventToAll({
                type: 'keyDown', text: char, unmodifiedText: char,
                keyIdentifier: char, code: 'Key' + char.toUpperCase(),
                windowsVirtualKeyCode: char.charCodeAt(0),
                nativeVirtualKeyCode: char.charCodeAt(0)
            });
            await delay(this.timingMs);
            await ctx.cdpHandler.dispatchKeyEventToAll({
                type: 'keyUp', text: char, unmodifiedText: char,
                keyIdentifier: char, code: 'Key' + char.toUpperCase(),
                windowsVirtualKeyCode: char.charCodeAt(0),
                nativeVirtualKeyCode: char.charCodeAt(0)
            });
            await delay(this.timingMs);
        }
        return true;
    }
}

export class ClipboardPaste implements IInteractionMethod {
    id = 'clipboard-paste';
    name = 'Clipboard Paste';
    description = 'Copies text to clipboard and executes paste command';
    category = 'text' as const;
    enabled = true;
    priority = 2;
    timingMs = 100;
    requiresCDP = false;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands || !ctx.text) return false;
        try {
            // env.clipboard.writeText is available in vscode
            await ctx.vscodeCommands.executeCommand('editor.action.clipboardCopyAction');
            await delay(50);
            await ctx.vscodeCommands.executeCommand('editor.action.clipboardPasteAction');
            return true;
        } catch { return false; }
    }
}

export class DOMValueInjection implements IInteractionMethod {
    id = 'dom-inject';
    name = 'DOM Value Injection';
    description = 'Sets .value on input elements via CDP Runtime.evaluate';
    category = 'text' as const;
    enabled = true;
    priority = 3;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.text) return false;
        const escapedText = ctx.text.replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const script = `
            (function() {
                const el = document.activeElement;
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                    if (el.isContentEditable) {
                        el.textContent = '${escapedText}';
                    } else {
                        el.value = '${escapedText}';
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }
                return false;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
    }
}

export class VSCodeTypeCommand implements IInteractionMethod {
    id = 'vscode-type';
    name = 'VS Code Type Command';
    description = 'Uses the built-in type command to insert text';
    category = 'text' as const;
    enabled = false; // Disabled by default (can interfere with editor)
    priority = 4;
    timingMs = 50;
    requiresCDP = false;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands || !ctx.text) return false;
        try {
            await ctx.vscodeCommands.executeCommand('type', { text: ctx.text });
            return true;
        } catch { return false; }
    }
}

// ============ Click Methods ============

export class DOMSelectorClick implements IInteractionMethod {
    id = 'dom-click';
    name = 'DOM Selector Click';
    description = 'Finds element by CSS selector and dispatches click event via CDP';
    category = 'click' as const;
    enabled = true;
    priority = 1;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.selector) return false;
        const script = `
            (function() {
                const el = document.querySelector('${ctx.selector}');
                if (el) { el.click(); return true; }
                return false;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
    }
}

export class CDPMouseEvent implements IInteractionMethod {
    id = 'cdp-mouse';
    name = 'CDP Mouse Event';
    description = 'Dispatches Input.dispatchMouseEvent at coordinates via CDP';
    category = 'click' as const;
    enabled = true;
    priority = 2;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.coordinates) return false;
        const { x, y } = ctx.coordinates;
        // mousePressed then mouseReleased
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
        });
        await delay(30);
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        });
        return true;
    }
}

export class VSCodeCommandClick implements IInteractionMethod {
    id = 'vscode-cmd';
    name = 'VS Code Command';
    description = 'Executes a registered VS Code command by ID';
    category = 'click' as const;
    enabled = true;
    priority = 3;
    timingMs = 100;
    requiresCDP = false;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands || !ctx.commandId) return false;
        try {
            await ctx.vscodeCommands.executeCommand(ctx.commandId);
            return true;
        } catch { return false; }
    }
}

export class ScriptForceClick implements IInteractionMethod {
    id = 'script-force';
    name = 'Script Force Click';
    description = 'Injects JS that calls element.click() directly via injected bridge';
    category = 'click' as const;
    enabled = true;
    priority = 4;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.selector) return false;
        const script = `
            (function() {
                const el = document.querySelector('${ctx.selector}');
                if (el) {
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    return true;
                }
                return false;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
    }
}

export class CoordinateClick implements IInteractionMethod {
    id = 'coord-click';
    name = 'Coordinate Click (Native)';
    description = 'Clicks at absolute coordinates — requires native module or CDP Input domain';
    category = 'click' as const;
    enabled = false; // Disabled by default (requires additional setup)
    priority = 5;
    timingMs = 100;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.coordinates) return false;
        // Uses CDP Input.dispatchMouseEvent with absolute coordinates
        const sessions = ctx.cdpHandler.connections;
        if (!sessions || sessions.size === 0) return false;
        // Dispatch to first connected page
        for (const [pageId] of sessions) {
            try {
                await ctx.cdpHandler.sendCommand(pageId, 'Input.dispatchMouseEvent', {
                    type: 'mousePressed', x: ctx.coordinates.x, y: ctx.coordinates.y,
                    button: 'left', clickCount: 1
                });
                await delay(30);
                await ctx.cdpHandler.sendCommand(pageId, 'Input.dispatchMouseEvent', {
                    type: 'mouseReleased', x: ctx.coordinates.x, y: ctx.coordinates.y,
                    button: 'left', clickCount: 1
                });
                return true;
            } catch { continue; }
        }
        return false;
    }
}

// ============ Submit Methods ============

export class VSCodeSubmitCommands implements IInteractionMethod {
    id = 'vscode-submit';
    name = 'VS Code Submit Commands';
    description = 'Tries known VS Code submit command IDs sequentially';
    category = 'submit' as const;
    enabled = true;
    priority = 1;
    timingMs = 50;
    requiresCDP = false;

    static readonly SUBMIT_COMMANDS = [
        'workbench.action.chat.submit',
        'workbench.action.chat.send',
        'interactive.acceptChanges',
        'workbench.action.terminal.chat.accept',
        'inlineChat.accept',
        'aipopup.action.submit'
    ];

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands) return false;
        for (const cmd of VSCodeSubmitCommands.SUBMIT_COMMANDS) {
            try { await ctx.vscodeCommands.executeCommand(cmd); } catch { /* ignore */ }
        }
        return true;
    }
}

export class CDPEnterKey implements IInteractionMethod {
    id = 'cdp-enter';
    name = 'CDP Enter Key';
    description = 'Dispatches Enter keyDown/keyUp via Chrome DevTools Protocol';
    category = 'submit' as const;
    enabled = true;
    priority = 2;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            text: '\r', unmodifiedText: '\r'
        });
        await delay(50);
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            text: '\r', unmodifiedText: '\r'
        });
        return true;
    }
}

export class ScriptForceSubmit implements IInteractionMethod {
    id = 'script-submit';
    name = 'Script Force Submit';
    description = 'Calls window.__autoAllState.forceSubmit() via injected bridge';
    category = 'submit' as const;
    enabled = true;
    priority = 3;
    timingMs = 100;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        const script = `if (window.__autoAllState && window.__autoAllState.forceSubmit) window.__autoAllState.forceSubmit();`;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
    }
}

export class AltEnterShortcut implements IInteractionMethod {
    id = 'alt-enter';
    name = 'Alt+Enter Shortcut';
    description = 'Dispatches Alt+Enter key combination for agents that use it';
    category = 'submit' as const;
    enabled = false; // Disabled by default
    priority = 4;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            modifiers: 1, // Alt modifier
            text: '\r', unmodifiedText: '\r'
        });
        await delay(50);
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            modifiers: 1,
            text: '\r', unmodifiedText: '\r'
        });
        return true;
    }
}

// ============ Registry ============

export class InteractionMethodRegistry {
    private methods: Map<string, IInteractionMethod> = new Map();
    private config: RegistryConfig;

    constructor(registryConfig?: Partial<RegistryConfig>) {
        this.config = {
            textInput: ['cdp-keys', 'clipboard-paste', 'dom-inject'],
            click: ['dom-click', 'cdp-mouse', 'vscode-cmd', 'script-force'],
            submit: ['vscode-submit', 'cdp-enter', 'script-submit'],
            timings: {},
            retryCount: 3,
            parallelExecution: false,
            ...registryConfig
        };

        // Register all built-in methods
        this.registerDefaults();
    }

    private registerDefaults() {
        // Text input
        this.register(new CDPKeyDispatch());
        this.register(new ClipboardPaste());
        this.register(new DOMValueInjection());
        this.register(new VSCodeTypeCommand());
        // Click
        this.register(new DOMSelectorClick());
        this.register(new CDPMouseEvent());
        this.register(new VSCodeCommandClick());
        this.register(new ScriptForceClick());
        this.register(new CoordinateClick());
        // Submit
        this.register(new VSCodeSubmitCommands());
        this.register(new CDPEnterKey());
        this.register(new ScriptForceSubmit());
        this.register(new AltEnterShortcut());
    }

    register(method: IInteractionMethod) {
        // Apply config overrides
        if (this.config.timings[method.id] !== undefined) {
            method.timingMs = this.config.timings[method.id];
        }
        this.methods.set(method.id, method);
    }

    getMethod(id: string): IInteractionMethod | undefined {
        return this.methods.get(id);
    }

    getMethodsByCategory(category: 'text' | 'click' | 'submit'): IInteractionMethod[] {
        const enabledIds = category === 'text' ? this.config.textInput
            : category === 'click' ? this.config.click
                : this.config.submit;

        return Array.from(this.methods.values())
            .filter(m => m.category === category && enabledIds.includes(m.id))
            .sort((a, b) => a.priority - b.priority);
    }

    getAllMethods(): IInteractionMethod[] {
        return Array.from(this.methods.values()).sort((a, b) => a.priority - b.priority);
    }

    /**
     * Execute methods in a category. Tries each enabled method in priority order.
     * Returns results for each attempted method.
     */
    async executeCategory(
        category: 'text' | 'click' | 'submit',
        ctx: InteractionContext
    ): Promise<InteractionResult[]> {
        const methods = this.getMethodsByCategory(category);
        const results: InteractionResult[] = [];
        let successCount = 0;

        if (this.config.parallelExecution) {
            // Fire all methods simultaneously
            const settled = await Promise.allSettled(
                methods.map(async m => {
                    const start = Date.now();
                    try {
                        const ok = await m.execute(ctx);
                        await delay(m.timingMs);
                        return { methodId: m.id, success: ok, durationMs: Date.now() - start };
                    } catch (e: any) {
                        return { methodId: m.id, success: false, durationMs: Date.now() - start, error: e.message };
                    }
                })
            );
            for (const outcome of settled) {
                if (outcome.status === 'fulfilled') {
                    results.push(outcome.value);
                }
            }
        } else {
            // Sequential: try each until retryCount successes
            for (const method of methods) {
                if (successCount >= this.config.retryCount) break;
                const start = Date.now();
                try {
                    const ok = await method.execute(ctx);
                    await delay(method.timingMs);
                    results.push({ methodId: method.id, success: ok, durationMs: Date.now() - start });
                    if (ok) successCount++;
                } catch (e: any) {
                    results.push({ methodId: method.id, success: false, durationMs: Date.now() - start, error: e.message });
                }
            }
        }

        return results;
    }

    /**
     * Returns a summary of all registered methods and their configuration.
     * Useful for dashboard display and debugging.
     */
    getSummary(): Array<{ id: string; name: string; category: string; enabled: boolean; priority: number; timingMs: number; requiresCDP: boolean }> {
        return this.getAllMethods().map(m => ({
            id: m.id,
            name: m.name,
            category: m.category,
            enabled: this.isEnabled(m),
            priority: m.priority,
            timingMs: m.timingMs,
            requiresCDP: m.requiresCDP
        }));
    }

    private isEnabled(method: IInteractionMethod): boolean {
        const list = method.category === 'text' ? this.config.textInput
            : method.category === 'click' ? this.config.click
                : this.config.submit;
        return list.includes(method.id);
    }
}

// ============ Helpers ============

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Default singleton
export const interactionRegistry = new InteractionMethodRegistry();
