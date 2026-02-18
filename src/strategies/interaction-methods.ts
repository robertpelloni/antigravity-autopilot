/**
 * Interaction Method Registry
 * Every method for text input, clicking, and submission is registered here.
 * Users configure which methods are active and their priority/timing.
 *
 * @module strategies/interaction-methods
 */

import * as vscode from 'vscode';
import { SoundEffects } from '../utils/sound-effects';

// ============ Interfaces ============
// ... (start of file)



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
    enabled = true;
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
            (function() {
                const payload = '__ANTIGRAVITY_TYPE__:${escapedText}';
                if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                    window.__ANTIGRAVITY_BRIDGE__(payload);
                    return true;
                }
                console.log(payload);
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
        const escapedSelector = escapeJsSingleQuoted(ctx.selector);
        const script = `
            (function() {
                const el = document.querySelector('${escapedSelector}');
                if (el) { el.click(); return true; }
                return false;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(script);
        return true;
    }
}

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

                const fallbackSelectors = [
                    'button',
                    '[role="button"]',
                    '.monaco-button',
                    '[class*="button"]'
                ];

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

                for (const el of candidates) {
                    let text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim().toLowerCase();
                    
                    // Icon-only button handling (Run / Expand)
                    if (!text) {
                        const classList = (el.className || '').toLowerCase();
                        if (classList.includes('codicon-play') || classList.includes('codicon-run') || classList.includes('codicon-debug-start')) {
                            text = 'run';
                        } else if (classList.includes('codicon-chevron-right') || classList.includes('monaco-tl-twistie') || classList.includes('codicon-tree-item-expanded') === false) { 
                            // chevron-right usually means collapsed/expandable
                            text = 'expand';
                        }
                    }

                    if (!text || text.length > 120) continue;
                    if (!visible(el)) continue;
                    if (reject.some(p => text.includes(p))) continue;
                    if (!accept.some(p => text.includes(p))) continue;
                    el.click();
                    return true;
                }

                return false;
            })()
        `;

        const results = await ctx.cdpHandler.executeInAllSessions?.(script, true);
        return Array.isArray(results) ? results.some((r: any) => !!r) : true;
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
        await ctx.cdpHandler.dispatchMouseEventToAll({
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
        });
        await delay(30);
        await ctx.cdpHandler.dispatchMouseEventToAll({
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        });
        return true;
    }
}

export class BridgeCoordinateClick implements IInteractionMethod {
    id = 'bridge-click';
    name = 'Bridge Coordinate Click';
    description = 'Finds target element and sends __ANTIGRAVITY_CLICK__ through bridge';
    category = 'click' as const;
    enabled = true;
    priority = 3;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.selector) return false;
        const escapedSelector = escapeJsSingleQuoted(ctx.selector);
        const script = `
            (function() {
                const el = document.querySelector('${escapedSelector}');
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) return false;
                const x = Math.round(rect.left + (rect.width / 2));
                const y = Math.round(rect.top + (rect.height / 2));
                const payload = '__ANTIGRAVITY_CLICK__:' + x + ':' + y;
                if (typeof window.__ANTIGRAVITY_BRIDGE__ === 'function') {
                    window.__ANTIGRAVITY_BRIDGE__(payload);
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

export class NativeAcceptCommands implements IInteractionMethod {
    id = 'native-accept';
    name = 'Native Accept Commands';
    description = 'Attempts native/extension command-based acceptance for editor, terminal, and chat';
    category = 'click' as const;
    enabled = true;
    priority = 4;
    timingMs = 60;
    requiresCDP = false;

    private static readonly COMMANDS = [
        'antigravity.agent.acceptAgentStep',
        'antigravity.terminal.accept',
        'workbench.action.chat.submit',
        'workbench.action.chat.send',
        'interactive.acceptChanges'
    ];

    async execute(ctx: InteractionContext): Promise<boolean> {
        const commandsApi = ctx.vscodeCommands;
        if (!commandsApi) return false;
        let atLeastOneSuccess = false;

        for (const cmd of NativeAcceptCommands.COMMANDS) {
            try {
                await commandsApi.executeCommand(cmd);
                atLeastOneSuccess = true;
            } catch {
                // try next
            }
        }

        return atLeastOneSuccess;
    }
}

export class ProcessPeekClick implements IInteractionMethod {
    id = 'process-peek';
    name = 'Process Peek + Command Click';
    description = 'Discovers available commands at runtime and executes best accept/submit candidates';
    category = 'click' as const;
    enabled = true;
    priority = 5;
    timingMs = 80;
    requiresCDP = false;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.vscodeCommands) return false;
        try {
            const available: string[] = await ctx.vscodeCommands.getCommands(true);
            const candidates = available.filter(cmd =>
                cmd.includes('accept') ||
                cmd.includes('submit') ||
                cmd.includes('chat.send') ||
                cmd.includes('chat.submit') ||
                cmd.includes('terminal.accept')
            );

            for (const command of candidates.slice(0, 6)) {
                try {
                    await ctx.vscodeCommands.executeCommand(command);
                    return true;
                } catch {
                    // keep trying
                }
            }

            return false;
        } catch {
            return false;
        }
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
        const escapedSelector = escapeJsSingleQuoted(ctx.selector);
        const script = `
            (function() {
                const el = document.querySelector('${escapedSelector}');
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

export class VisualVerifiedClick implements IInteractionMethod {
    id = 'visual-verify-click';
    name = 'Visual Verification Click';
    description = 'Captures screenshots before/after click and verifies a visual diff';
    category = 'click' as const;
    enabled = true;
    priority = 7;
    timingMs = 120;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler || !ctx.selector) return false;

        if (typeof ctx.cdpHandler.captureScreenshots !== 'function') {
            return false;
        }

        const before: string[] = await ctx.cdpHandler.captureScreenshots();

        const escapedSelector = escapeJsSingleQuoted(ctx.selector);
        const clickScript = `
            (function() {
                const el = document.querySelector('${escapedSelector}');
                if (!el) return false;
                el.click();
                return true;
            })()
        `;
        await ctx.cdpHandler.executeScriptInAllSessions(clickScript);
        await delay(75);

        const after: string[] = await ctx.cdpHandler.captureScreenshots();
        const threshold = Math.max(0, Math.min(1, ctx.visualDiffThreshold ?? 0.001));
        return visualDiffExceeded(before, after, threshold);
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
        SoundEffects.play('alt-enter');
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

export class CtrlEnterShortcut implements IInteractionMethod {
    id = 'ctrl-enter';
    name = 'Ctrl+Enter Shortcut';
    description = 'Dispatches Ctrl+Enter key combination for submit variants';
    category = 'submit' as const;
    enabled = true;
    priority = 4;
    timingMs = 50;
    requiresCDP = true;

    async execute(ctx: InteractionContext): Promise<boolean> {
        if (!ctx.cdpHandler) return false;
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            modifiers: 2,
            text: '\r', unmodifiedText: '\r'
        });
        await delay(50);
        await ctx.cdpHandler.dispatchKeyEventToAll({
            type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', key: 'Enter',
            windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
            modifiers: 2,
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
            textInput: ['cdp-keys', 'cdp-insert-text', 'clipboard-paste', 'dom-inject', 'bridge-type'],
            click: ['dom-scan-click', 'dom-click', 'bridge-click', 'cdp-mouse', 'native-accept', 'vscode-cmd', 'script-force', 'process-peek'],
            submit: ['vscode-submit', 'cdp-enter', 'script-submit', 'ctrl-enter', 'alt-enter'],
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
        this.register(new DOMSelectorClick());
        this.register(new BridgeCoordinateClick());
        this.register(new CDPMouseEvent());
        this.register(new NativeAcceptCommands());
        this.register(new VSCodeCommandClick());
        this.register(new ScriptForceClick());
        this.register(new ProcessPeekClick());
        this.register(new VisualVerifiedClick());
        this.register(new CoordinateClick());
        // Submit
        this.register(new VSCodeSubmitCommands());
        this.register(new CDPEnterKey());
        this.register(new ScriptForceSubmit());
        this.register(new CtrlEnterShortcut());
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
