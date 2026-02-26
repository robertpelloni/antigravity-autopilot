/**
 * Interaction Method Registry
 * Every method for text input, clicking, and submission is registered here.
 * Users configure which methods are active and their priority/timing.
 *
 * @module strategies/interaction-methods
 */

import * as vscode from 'vscode';
import { SoundEffects } from '../utils/sound-effects';
import { logToOutput } from '../utils/output-channel';

// ============ Interfaces ============

export interface InteractionContext {
    cdpHandler?: any;       // CDPHandler instance (optional - not all methods need it)
    vscodeCommands?: any;   // vscode.commands proxy
    text?: string;          // Text to type (for text/submit methods)
    selector?: string;      // CSS selector (for click methods)
    coordinates?: { x: number; y: number }; // Screen coordinates
    commandId?: string;     // VS Code command ID
    acceptPatterns?: string[];
    rejectPatterns?: string[];
    visualDiffThreshold?: number;
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

export interface MethodDescriptor {
    id: string;
    name: string;
    description: string;
    category: 'text' | 'click' | 'submit';
    requiresCDP: boolean;
}

const DEFAULT_ACCEPT_PATTERNS = [
    'accept', 'accept all', 'run', 'run command', 'retry', 'apply', 'execute',
    'confirm', 'allow once', 'allow', 'proceed', 'continue', 'yes', 'ok',
    'save', 'approve', 'overwrite', 'expand'
];

const DEFAULT_REJECT_PATTERNS = [
    'skip', 'reject', 'cancel', 'close', 'refine', 'deny', 'no', 'dismiss',
    'abort', 'ask every time', 'always run', 'always allow', 'stop', 'pause', 'disconnect'
];

// ============ Text Input Methods ============

export class CDPKeyDispatch implements IInteractionMethod {
    id = 'cdp-keys';
    name = 'CDP Key Dispatch';
    description = 'Simulates keyDown/keyUp events via Chrome DevTools Protocol';
    category = 'text' as const;
    enabled = true;
    priority = 1;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.text) return false;
        for (const char of ctx.text) {
            const vkCode = char.toUpperCase().charCodeAt(0);
            await ctx.cdpHandler.dispatchKeyEventToAll({
                type: 'keyDown', text: char, unmodifiedText: char,
                keyIdentifier: char, code: 'Key' + char.toUpperCase(),
                windowsVirtualKeyCode: vkCode,
                nativeVirtualKeyCode: vkCode
            });
            await delay(this.timingMs);
            await ctx.cdpHandler.dispatchKeyEventToAll({
                type: 'keyUp', text: char, unmodifiedText: char,
                keyIdentifier: char, code: 'Key' + char.toUpperCase(),
                windowsVirtualKeyCode: vkCode,
                nativeVirtualKeyCode: vkCode
            });
            await delay(this.timingMs);
        }
        return true;
    }
}

export class CDPInsertText implements IInteractionMethod {
    id = 'cdp-insert-text';
    name = 'CDP Insert Text';
    description = 'Uses Input.insertText for active text input';
    category = 'text' as const;
    enabled = true;
    priority = 2;
    timingMs = 20;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.text) return false;
        try {
            if (typeof ctx.cdpHandler.insertTextToAll === 'function') {
                await ctx.cdpHandler.insertTextToAll(ctx.text);
                return true;
            }

            if (typeof ctx.cdpHandler.executeScriptInAllSessions === 'function') {
                const escapedText = escapeJsSingleQuoted(ctx.text);
                const script = `
                    (function() {
                        const el = document.activeElement;
                        if (!el) return false;
                        if (el.isContentEditable) {
                            document.execCommand('insertText', false, '${escapedText}');
                            return true;
                        }
                        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                            el.value = (el.value || '') + '${escapedText}';
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            return true;
                        }
                        return false;
                    })()
                `;
                await ctx.cdpHandler.executeScriptInAllSessions(script);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export class ClipboardPaste implements IInteractionMethod {
    id = 'clipboard-paste';
    name = 'Clipboard Paste';
    description = 'Copies text to clipboard and executes paste command';
    category = 'text' as const;
    enabled = false; // Disabled by default to prevent hijacking active editor
    priority = 2;
    timingMs = 100;
    requiresCDP = false;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands || !ctx.text) return false;
        try {
            await vscode.env.clipboard.writeText(ctx.text);
            await delay(50);
            await ctx.vscodeCommands.executeCommand('editor.action.clipboardPasteAction');
            return true;
        } catch { return false; }
    }
}

export class BridgeType implements IInteractionMethod {
    id = 'bridge-type';
    name = 'Bridge Type Injection';
    description = 'Sends __ANTIGRAVITY_TYPE__ payload to extension bridge';
    category = 'text' as const;
    enabled = true;
    priority = 4;
    timingMs = 30;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.text) return false;
        const escapedText = escapeJsSingleQuoted(ctx.text);
        const script = `
                const payload = '__AUTOPILOT_TYPE__:${escapedText}';
                if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
                    window.__AUTOPILOT_BRIDGE__(payload);
                } else {
                    console.log(payload);
                }
                return true;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
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
                        let nativeSetter = el.tagName === 'TEXTAREA'
                            ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
                            : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                            
                        if (nativeSetter) {
                            nativeSetter.call(el, '${escapedText}');
                        } else {
                            el.value = '${escapedText}';
                        }
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
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


export class DOMScanClick implements IInteractionMethod {
    id = 'dom-scan-click';
    name = 'DOM Scan + Click';
    description = 'Scans candidate elements, applies accept/reject patterns, and clicks best match';
    category = 'click' as const;
    enabled = true;
    priority = 1;
    timingMs = 30;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        const acceptPatterns = JSON.stringify((ctx.acceptPatterns && ctx.acceptPatterns.length > 0) ? ctx.acceptPatterns : DEFAULT_ACCEPT_PATTERNS);
        const rejectPatterns = JSON.stringify((ctx.rejectPatterns && ctx.rejectPatterns.length > 0) ? ctx.rejectPatterns : DEFAULT_REJECT_PATTERNS);
        const selectorCsv = JSON.stringify((ctx.selector || '').trim());

        const script = `
            (function() {
                const accept = ${acceptPatterns}.map(x => String(x).toLowerCase());
                const reject = ${rejectPatterns}.map(x => String(x).toLowerCase());

                const selectorCsv = ${selectorCsv};
                const selectorParts = selectorCsv
                    ? selectorCsv.split(',').map(s => s.trim()).filter(Boolean)
                    : [];

                const fallbackSelectors = [];

                const allSelectors = Array.from(new Set([...selectorParts, ...fallbackSelectors]));

                const seen = new Set();
                const candidates = [];
                for (const sel of allSelectors) {
                    let nodes = [];
                    try { nodes = Array.from(document.querySelectorAll(sel)); } catch (e) { nodes = []; }
                    for (const node of nodes) {
                        if (!seen.has(node)) {
                            seen.add(node);
                            candidates.push(node);
                        }
                    }
                }
                function visible(el) {
                    if (!el || !el.isConnected) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && !el.disabled && rect.width > 0 && rect.height > 0;
                }

                function isNodeBanned(el) {
                    if (!el) return false;
                    const banned = '.codicon-settings-gear, .codicon-gear, .codicon-layout, .codicon-attach, .codicon-paperclip, .codicon-add, .codicon-plus, .codicon-history, .codicon-trash, .codicon-clear-all';
                    if (el.matches && el.matches(banned)) return true;
                    if (el.querySelector && el.querySelector(banned)) return true;
                    let current = el;
                    while(current) {
                        if (current.nodeType === 1) { // ELEMENT_NODE
                             const attrs = ((current.getAttribute('aria-label') || '') + ' ' + (current.getAttribute('title') || '')).toLowerCase();
                             if (/(customize layout|layout control|add context|attach context|attach a file|new chat|clear chat|clear session|view as|open in)/i.test(attrs)) return true;
                             if (current.matches && current.matches('.quick-input-widget, .monaco-quick-input-container, .suggest-widget, .rename-box, .settings-editor, .extensions-viewlet, [id*="workbench.view.extensions"], .pane-header, .panel-header, .view-pane-header, .title-actions, .tabs-and-actions-container, .part.activitybar, .part.statusbar, .part.titlebar, .panel-switcher-container, .monaco-panel .composite.title, .dialog-container, .notifications-toasts, .monaco-dialog-box, .monaco-menu, .monaco-menu-container, .menubar, .menubar-menu-button, [role="menu"], [role="menuitem"], [role="menubar"]')) return true;
                             if (current.getAttribute('role') === 'tab' || current.getAttribute('role') === 'tablist') return true;
                        }
                        current = current.parentElement || (current.getRootNode && current.getRootNode().host) || null;
                    }
                    
                    // Global Workbench safety lock (Prevent clicking native IDE elements outside of safe embedded content like webviews)
                    if (window === window.top) {
                        if (el.closest && el.closest('.monaco-workbench') && !el.closest('iframe, webview, .webview, #webview')) {
                             return true;
                        }
                    }
                    return false;
                }

                for (const el of candidates) {
                    if (isNodeBanned(el)) continue;

                    let text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim().toLowerCase();
                    
                    // Icon-only button handling (Run / Expand)
                    if (!text) {
                        const classList = (el.className || '').toLowerCase();
                        if (classList.includes('codicon-play') || classList.includes('codicon-run') || classList.includes('codicon-debug-start')) {
                            text = 'run';
                        } else if (classList.includes('codicon-chevron-right') || classList.includes('monaco-tl-twistie')) { 
                            // chevron-right usually means collapsed/expandable
                            text = 'expand';
                        } else if (classList.includes('codicon-check') || classList.includes('codicon-check-all')) {
                            text = 'accept';
                        }
                    }

                    if (!text || text.length > 120) continue;
                    if (!visible(el)) continue;
                    if (reject.some(p => text.includes(p))) continue;
                    if (!accept.some(p => text.includes(p))) continue;
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return true;
                }

                return false;
            })()
        `;

        const results = await ctx.cdpHandler.executeInAllSessions?.(script, true);
        return Array.isArray(results) ? results.some((r: any) => !!r) : true;
    }
}

export class BridgeCoordinateClick implements IInteractionMethod {
    id = 'bridge-click';
    name = 'Bridge Coordinate Click';
    description = 'Finds target element and sends __ANTIGRAVITY_CLICK__ through bridge';
    category = 'click' as const;
    enabled = false; // Keep disabled: coordinate relay can drift into workbench chrome
    priority = 3;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.selector) return false;
        const escapedSelector = escapeJsSingleQuoted(ctx.selector);

        // This is the absolute root cause fix.
        // We inject the entire Workbench Chrome Banlist into this eval script.
        // Without this, 'document.querySelector' executed on the Main Window CDP Session
        // would find the OS Menu "Run" item on the global title bar, compute coordinates,
        // and physically click Title Bar regions (hitting Customize Layout due to zoom scaling).
        const script = `
            (function() {
                const el = document.querySelector('${escapedSelector}');
                if (!el) return false;
                
                const isBanned = el.closest('.quick-input-widget, .monaco-quick-input-container, .suggest-widget, .rename-box, .settings-editor, .extensions-viewlet, [id*="workbench.view.extensions"], .pane-header, .panel-header, .view-pane-header, .title-actions, .tabs-and-actions-container, .part.activitybar, .part.statusbar, .part.titlebar, .panel-switcher-container, .monaco-panel .composite.title, .dialog-container, .notifications-toasts, .monaco-dialog-box, .monaco-menu, .monaco-menu-container, [role="menu"], [role="menubar"]');
                if (isBanned) return false;

                const rect = el.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) return false;
                
                const x = Math.round(rect.left + (rect.width / 2));
                const y = Math.round(rect.top + (rect.height / 2));
                
                const payload = '__AUTOPILOT_CLICK__:' + x + ':' + y;
                if (typeof window.__AUTOPILOT_BRIDGE__ === 'function') {
                    window.__AUTOPILOT_BRIDGE__(payload);
                } else {
                    console.log(payload);
                }
                return true;
            })()
        `;

        const results = await ctx.cdpHandler.executeInAllSessions?.(script, true);
        return Array.isArray(results) ? results.some((r: any) => !!r) : true;
    }
}

export class VSCodeCommandClick implements IInteractionMethod {
    id = 'vscode-cmd';
    name = 'VS Code Command';
    description = 'Executes a registered VS Code command by ID';
    category = 'click' as const;
    enabled = true;
    priority = 0;
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


// ============ Submit Methods ============

export class VSCodeSubmitCommands implements IInteractionMethod {
    id = 'vscode-submit';
    name = 'VS Code Submit Commands';
    description = 'Tries known VS Code submit command IDs sequentially';
    category = 'submit' as const;
    enabled = true;
    priority = 2; // Lower priority than ScriptForceSubmit
    timingMs = 50;
    requiresCDP = false;

    static readonly SUBMIT_COMMANDS: string[] = [
        // NOTE: ALL accept commands REMOVED — trigger Customize Layout on Antigravity fork
    ];

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands) return false;
        for (const cmd of VSCodeSubmitCommands.SUBMIT_COMMANDS) {
            try { await ctx.vscodeCommands.executeCommand(cmd); } catch { /* ignore */ }
        }
        return true;
    }
}


export class ScriptForceSubmit implements IInteractionMethod {
    id = 'script-submit';
    name = 'Script Force Submit';
    description = 'Calls window.__autopilotState.forceSubmit() via injected bridge';
    category = 'submit' as const;
    enabled = true;
    priority = 0; // Highest priority (runs first)
    timingMs = 100;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        const script = `
            (async function() {
                if (window.__autopilotState && window.__autopilotState.forceSubmit) {
                    return await window.__autopilotState.forceSubmit();
                }
                return false;
            })()
        `;
        const results = await ctx.cdpHandler.executeInAllSessions?.(script, true);
        return Array.isArray(results) ? results.some((r: any) => !!r) : false;
    }
}


// ============ Registry ============

export class InteractionMethodRegistry {
    private methods: Map<string, IInteractionMethod> = new Map();
    private config: RegistryConfig;

    constructor(registryConfig?: Partial<RegistryConfig>) {
        this.config = {
            textInput: ['cdp-keys', 'cdp-insert-text', 'clipboard-paste', 'dom-inject', 'bridge-type'],
            click: ['dom-scan-click', 'native-accept', 'vscode-cmd'],
            submit: ['vscode-submit', 'script-submit'],
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
        this.register(new CDPInsertText());
        this.register(new ClipboardPaste());
        this.register(new DOMValueInjection());
        this.register(new BridgeType());
        this.register(new VSCodeTypeCommand());
        // Click
        this.register(new DOMScanClick());
        this.register(new BridgeCoordinateClick());
        this.register(new VSCodeCommandClick());
        // Submit
        this.register(new VSCodeSubmitCommands());
        this.register(new ScriptForceSubmit());
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
            .filter(m => m.enabled && m.category === category && enabledIds.includes(m.id))
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

        logToOutput(`[Interaction] Category=${category} | methods=${methods.map(m => m.id).join(', ') || 'none'} | parallel=${this.config.parallelExecution}`);

        if (this.config.parallelExecution && category === 'click') {
            // Fire all methods simultaneously
            const settled = await Promise.allSettled(
                methods.map(async m => {
                    const start = Date.now();
                    logToOutput(`[Interaction] START ${category}:${m.id}`);
                    try {
                        const ok = await m.execute(ctx);
                        await delay(m.timingMs);
                        logToOutput(`[Interaction] END ${category}:${m.id} | ok=${ok} | duration=${Date.now() - start}ms | postDelay=${m.timingMs}ms`);
                        return { methodId: m.id, success: ok, durationMs: Date.now() - start };
                    } catch (e: any) {
                        logToOutput(`[Interaction] FAIL ${category}:${m.id} | duration=${Date.now() - start}ms | error=${String(e?.message || e || 'unknown')}`);
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
            // Sequential execution
            for (const m of methods) {
                if (ctx.visualDiffThreshold && m.id === 'visual-verify-click') continue; // specialized use only

                // For text, one success is rigidly all we need. 
                // For click/submit, the user might want redundancy, but 1 is usually safer.
                const targetSuccesses = category === 'text' ? 1 : this.config.retryCount;

                const successCount = results.filter(r => r.success).length;
                if (successCount >= targetSuccesses) {
                    logToOutput(`[Interaction] Reached target successes (${targetSuccesses}) for ${category}, stopping sequence.`);
                    break;
                }

                const start = Date.now();
                try {
                    logToOutput(`[Interaction] START ${category}:${m.id}`);
                    const ok = await m.execute(ctx);
                    results.push({ methodId: m.id, success: ok, durationMs: Date.now() - start });
                    logToOutput(`[Interaction] END ${category}:${m.id} | ok=${ok} | duration=${Date.now() - start}ms | postDelay=${m.timingMs}ms`);
                    if (m.timingMs > 0) await delay(m.timingMs);
                } catch (e: any) {
                    logToOutput(`[Interaction] FAIL ${category}:${m.id} | duration=${Date.now() - start}ms | error=${String(e?.message || e || 'unknown')}`);
                    results.push({ methodId: m.id, success: false, durationMs: Date.now() - start, error: e.message });
                }
            }
        }

        logToOutput(`[Interaction] Category complete=${category} | attempts=${results.length} | successes=${results.filter(r => r.success).length}`);

        return results;
    }

    /**
     * Executes a single specific method by ID.
     */
    async executeMethod(methodId: string, ctx: InteractionContext): Promise<InteractionResult> {
        const method = this.getMethod(methodId);
        if (!method) {
            logToOutput(`[Interaction] Method not found: ${methodId}`);
            return { methodId, success: false, durationMs: 0, error: 'Method not found' };
        }

        const start = Date.now();
        try {
            logToOutput(`[Interaction] START single:${methodId}`);
            const success = await method.execute(ctx);
            logToOutput(`[Interaction] END single:${methodId} | ok=${success} | duration=${Date.now() - start}ms | postDelay=${method.timingMs}ms`);
            return { methodId, success, durationMs: Date.now() - start };
        } catch (e: any) {
            logToOutput(`[Interaction] FAIL single:${methodId} | duration=${Date.now() - start}ms | error=${String(e?.message || e || 'unknown')}`);
            return { methodId, success: false, durationMs: Date.now() - start, error: e.message };
        }
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
        const enabledIds = method.category === 'text' ? this.config.textInput
            : method.category === 'click' ? this.config.click
                : this.config.submit;
        return enabledIds.includes(method.id);
    }

    /**
     * Returns a static descriptor list for UI/docs generation.
     */
    static getMethodDescriptors(): MethodDescriptor[] {
        const registry = new InteractionMethodRegistry();
        return registry.getAllMethods().map(m => ({
            id: m.id,
            name: m.name,
            description: m.description,
            category: m.category,
            requiresCDP: m.requiresCDP
        }));
    }
}

// ============ Helpers ============

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeJsSingleQuoted(input: string): string {
    return input
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

function visualDiffExceeded(before: string[], after: string[], threshold: number): boolean {
    if (before.length === 0 || after.length === 0) return false;
    const count = Math.min(before.length, after.length);
    for (let i = 0; i < count; i++) {
        const a = before[i] || '';
        const b = after[i] || '';
        if (a === b) continue;
        const maxLen = Math.max(a.length, b.length, 1);
        const ratio = Math.abs(a.length - b.length) / maxLen;
        if (ratio >= threshold || a !== b) return true;
    }
    return false;
}

// Default singleton
export const interactionRegistry = new InteractionMethodRegistry();
