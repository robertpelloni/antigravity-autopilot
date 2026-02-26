const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function loadTsModule(filePath, mocks = {}, cache = new Map()) {
    const absolutePath = path.resolve(filePath);
    if (cache.has(absolutePath)) {
        return cache.get(absolutePath).exports;
    }

    const source = fs.readFileSync(absolutePath, 'utf-8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        },
        fileName: absolutePath
    }).outputText;

    const mod = new Module(absolutePath, module);
    cache.set(absolutePath, mod);
    mod.filename = absolutePath;
    mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
        if (request in mocks) {
            return mocks[request];
        }

        if (request === 'vscode') {
            return {
                env: {
                    clipboard: {
                        writeText: async () => undefined
                    }
                },
                commands: {
                    executeCommand: async () => undefined,
                    getCommands: async () => []
                }
            };
        }

        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, mocks, cache);
                }
            }
        }

        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

function createTestMethod(id, category, priority, shouldSucceed = true, timingMs = 0) {
    return {
        id,
        name: `Test ${id}`,
        description: `Test method ${id}`,
        category,
        enabled: true,
        priority,
        timingMs,
        requiresCDP: false,
        async execute() {
            if (!shouldSucceed) {
                throw new Error(`${id} failed`);
            }
            return true;
        }
    };
}

const interactionModule = loadTsModule(path.resolve(__dirname, '../src/strategies/interaction-methods.ts'));
const InteractionMethodRegistry = interactionModule.InteractionMethodRegistry;

describe('Interaction Method Registry (real module)', () => {
    it('should register and retrieve methods by ID', () => {
        const reg = new InteractionMethodRegistry({ textInput: ['a'] });
        reg.register(createTestMethod('a', 'text', 1));

        assert.strictEqual(reg.getMethod('a').id, 'a');
    });

    it('should return methods sorted by priority', () => {
        const reg = new InteractionMethodRegistry({ click: ['low', 'mid', 'high'] });
        reg.register(createTestMethod('high', 'click', 3));
        reg.register(createTestMethod('low', 'click', 1));
        reg.register(createTestMethod('mid', 'click', 2));

        const sorted = reg.getMethodsByCategory('click').filter((m) => ['low', 'mid', 'high'].includes(m.id));
        assert.deepStrictEqual(sorted.map((m) => m.id), ['low', 'mid', 'high']);
    });

    it('should filter by enabled config', () => {
        const reg = new InteractionMethodRegistry({ submit: ['a', 'c'] });
        reg.register(createTestMethod('a', 'submit', 1));
        reg.register(createTestMethod('b', 'submit', 2));
        reg.register(createTestMethod('c', 'submit', 3));

        const methods = reg.getMethodsByCategory('submit').filter((m) => ['a', 'b', 'c'].includes(m.id));
        assert.strictEqual(methods.length, 2);
        assert.ok(!methods.find((m) => m.id === 'b'));
    });

    it('should apply timing overrides from config', () => {
        const reg = new InteractionMethodRegistry({ textInput: ['x'], timings: { x: 999 } });
        reg.register(createTestMethod('x', 'text', 1));
        assert.strictEqual(reg.getMethod('x').timingMs, 999);
    });

    it('should execute text methods sequentially and stop at first success', async () => {
        const reg = new InteractionMethodRegistry({ textInput: ['a', 'b', 'c', 'd'], retryCount: 2, timings: { a: 0, b: 0, c: 0, d: 0 } });
        reg.register(createTestMethod('a', 'text', 1, true, 0));
        reg.register(createTestMethod('b', 'text', 2, true, 0));
        reg.register(createTestMethod('c', 'text', 3, true, 0));
        reg.register(createTestMethod('d', 'text', 4, true, 0));

        const results = await reg.executeCategory('text', {});
        assert.strictEqual(results.length, 1);
        assert.deepStrictEqual(results.map((r) => r.methodId), ['a']);
    });

    it('should handle failing methods and continue to next', async () => {
        const reg = new InteractionMethodRegistry({ click: ['fail1', 'ok1', 'ok2'], retryCount: 2, timings: { fail1: 0, ok1: 0, ok2: 0 } });
        reg.register(createTestMethod('fail1', 'click', 1, false, 0));
        reg.register(createTestMethod('ok1', 'click', 2, true, 0));
        reg.register(createTestMethod('ok2', 'click', 3, true, 0));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 3);
        assert.strictEqual(results[0].success, false);
        assert.ok(results[0].error);
        assert.strictEqual(results[1].success, true);
        assert.strictEqual(results[2].success, true);
    });

    it('should execute all click methods in parallel mode regardless of retryCount', async () => {
        const reg = new InteractionMethodRegistry({ click: ['s1', 's2', 's3'], retryCount: 1, parallelExecution: true, timings: { s1: 0, s2: 0, s3: 0 } });
        reg.register(createTestMethod('s1', 'click', 1, true, 0));
        reg.register(createTestMethod('s2', 'click', 2, true, 0));
        reg.register(createTestMethod('s3', 'click', 3, true, 0));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 3);
        assert.ok(results.every((r) => r.success));
    });

    it('should generate summary including enabled state for configured IDs', () => {
        const reg = new InteractionMethodRegistry({ textInput: ['m1'], click: ['m2'], submit: [] });
        reg.register(createTestMethod('m1', 'text', 1));
        reg.register(createTestMethod('m2', 'click', 2));
        reg.register(createTestMethod('m3', 'submit', 3));

        const summary = reg.getSummary();
        const m1 = summary.find((s) => s.id === 'm1');
        const m2 = summary.find((s) => s.id === 'm2');
        const m3 = summary.find((s) => s.id === 'm3');

        assert.strictEqual(m1.enabled, true);
        assert.strictEqual(m2.enabled, true);
        assert.strictEqual(m3.enabled, false);
    });

    it('should return empty results for category with no enabled methods', async () => {
        const reg = new InteractionMethodRegistry({ textInput: [] });
        reg.register(createTestMethod('x', 'text', 1));

        const results = await reg.executeCategory('text', {});
        assert.strictEqual(results.length, 0);
    });

    it('should handle concurrent failures gracefully in parallel mode', async () => {
        const reg = new InteractionMethodRegistry({ click: ['f1', 'f2'], parallelExecution: true, timings: { f1: 0, f2: 0 } });
        reg.register(createTestMethod('f1', 'click', 1, false, 0));
        reg.register(createTestMethod('f2', 'click', 2, false, 0));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 2);
        assert.ok(results.every((r) => !r.success));
    });

    it('should support expanded method ID combinations from settings (registered methods only)', () => {
        const reg = new InteractionMethodRegistry({
            textInput: ['cdp-keys', 'cdp-insert-text', 'bridge-type'],
            click: ['dom-scan-click', 'vscode-cmd'],
            submit: ['vscode-submit', 'script-submit']
        });

        assert.strictEqual(reg.getMethodsByCategory('text').length, 3);
        assert.strictEqual(reg.getMethodsByCategory('click').length, 2);
        assert.strictEqual(reg.getMethodsByCategory('submit').length, 2);
    });

    it('should execute mixed click methods until retry success target is reached', async () => {
        const reg = new InteractionMethodRegistry({
            click: ['dom-scan-click', 'bridge-click', 'native-accept', 'process-peek'],
            retryCount: 2,
            timings: {
                'dom-scan-click': 0,
                'bridge-click': 0,
                'native-accept': 0,
                'process-peek': 0
            }
        });

        reg.register(createTestMethod('dom-scan-click', 'click', 1, false, 0));
        reg.register(createTestMethod('bridge-click', 'click', 2, true, 0));
        reg.register(createTestMethod('native-accept', 'click', 3, true, 0));
        reg.register(createTestMethod('process-peek', 'click', 4, true, 0));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 3);
        assert.deepStrictEqual(results.map((r) => r.methodId), ['dom-scan-click', 'bridge-click', 'native-accept']);
        assert.strictEqual(results.filter((r) => r.success).length, 2);
    });

    it('DOMScanClick executes correct CDP script for visual evaluation and banlists without wildcards', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();

        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script, returnByValue) => {
                executedScript = script;
                return [true];
            }
        };

        const result = await domScan.execute({
            cdpHandler: mockCdpHandler,
            acceptPatterns: ['accept me'],
            rejectPatterns: ['reject me'],
            selector: '.test-class'
        });

        assert.strictEqual(result, true);
        assert.ok(executedScript.includes('const accept = ["accept me"]'), 'Should pass accept patterns');
        assert.ok(executedScript.includes('const reject = ["reject me"]'), 'Should pass reject patterns');
        assert.ok(executedScript.includes('.codicon-settings-gear'), 'Should include robust banlist selector');
        assert.ok(executedScript.includes('window === window.top'), 'Should include workbench global iframe guard');
        assert.ok(!executedScript.includes('[class*="*"]'), 'Should not contain generic asterisk wildcards that could match anything');
    });

    // =========================================================================
    // DOMScanClick Ban-List Completeness
    // =========================================================================

    it('DOMScanClick script must include ALL required banned icon classes', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        const requiredBannedIcons = [
            '.codicon-settings-gear', '.codicon-gear', '.codicon-layout',
            '.codicon-attach', '.codicon-paperclip', '.codicon-add',
            '.codicon-plus', '.codicon-history', '.codicon-trash',
            '.codicon-clear-all'
        ];
        for (const icon of requiredBannedIcons) {
            assert.ok(executedScript.includes(icon), `Missing banned icon: ${icon}`);
        }
    });

    it('DOMScanClick script must include ALL required banned ancestor classes', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        const requiredAncestorBans = [
            'quick-input-widget', 'suggest-widget', 'settings-editor',
            'extensions-viewlet', 'part.activitybar', 'part.statusbar',
            'part.titlebar', 'monaco-menu', 'menubar',
            'dialog-container', 'notifications-toasts'
        ];
        for (const cls of requiredAncestorBans) {
            assert.ok(executedScript.includes(cls), `Missing banned ancestor class: ${cls}`);
        }
    });

    it('DOMScanClick script must include ALL required banned attribute phrases', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        const requiredBannedPhrases = [
            'customize layout', 'layout control', 'add context',
            'attach context', 'attach a file', 'new chat',
            'clear chat', 'clear session', 'view as', 'open in'
        ];
        for (const phrase of requiredBannedPhrases) {
            assert.ok(executedScript.includes(phrase), `Missing banned phrase: "${phrase}"`);
        }
    });

    it('DOMScanClick script must ban tab/tablist role ancestors', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes("'tab'") || executedScript.includes('"tab"'), 'Should ban role=tab');
        assert.ok(executedScript.includes("'tablist'") || executedScript.includes('"tablist"'), 'Should ban role=tablist');
    });

    // =========================================================================
    // Wildcard / Regex Injection via Accept/Reject Patterns
    // =========================================================================

    it('DOMScanClick should safely serialize malicious accept patterns via JSON.stringify escaping', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [false]; }
        };

        // Attempt JS injection via accept patterns
        await domScan.execute({
            cdpHandler: mockCdpHandler,
            acceptPatterns: ['"];alert(1);//', "']; process.exit();//", '${process.env.HOME}'],
            selector: '.x'
        });

        // JSON.stringify wraps patterns — inner double quotes are escaped as \",
        // so they remain harmless string content, never executable code.
        // Verify the patterns are wrapped in a JSON array (starts after 'const accept = ')
        const acceptArrayMatch = executedScript.match(/const accept = (\[.*?\])\.map/);
        assert.ok(acceptArrayMatch, 'Accept array must be present in script');
        // Verify the JSON parses cleanly (proves proper escaping)
        const parsed = JSON.parse(acceptArrayMatch[1]);
        assert.strictEqual(parsed.length, 3, 'All 3 malicious patterns must be present as safe string values');
        assert.ok(parsed[0].includes('alert(1)'), 'Pattern content preserved but safely escaped');
    });

    it('DOMScanClick should safely serialize malicious selector strings via JSON.stringify', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [false]; }
        };

        await domScan.execute({
            cdpHandler: mockCdpHandler,
            selector: '"; document.cookie; //',
            acceptPatterns: ['accept']
        });

        // JSON.stringify wraps the selector — inner double quotes are escaped as \",
        // so the script context never breaks into executable territory.
        // Verify the inner quote is escaped (backslash-quote), proving JSON.stringify safety.
        assert.ok(executedScript.includes('const selectorCsv = '), 'Selector assignment must exist');
        // The critical safety property: the " inside the selector is escaped as \"
        // meaning it cannot break out of the string context.
        assert.ok(executedScript.includes('\\"'), 'Inner quotes must be escaped by JSON.stringify');
        // The selector content is present but safely contained
        assert.ok(executedScript.includes('document.cookie'), 'Content preserved inside JSON string');
    });

    it('DOMScanClick script must not contain generic wildcard selectors like *, button, [role=button]', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };

        // When no user selector is provided, fallbackSelectors should be empty
        await domScan.execute({ cdpHandler: mockCdpHandler, acceptPatterns: ['accept'] });

        // The injected script should NOT contain broad wildcard selectors in fallbackSelectors
        assert.ok(!executedScript.includes("'*'") && !executedScript.includes('"*"'),
            'Should not contain universal * selector');
        assert.ok(!executedScript.includes('[role="button"]') && !executedScript.includes("[role='button']"),
            'Should not contain broad [role=button] fallback');
    });

    // =========================================================================
    // Icon-Only Button Classification
    // =========================================================================

    it('DOMScanClick script must classify codicon-play, codicon-run, codicon-debug-start as "run"', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('codicon-play'), 'Must detect codicon-play for Run');
        assert.ok(executedScript.includes('codicon-run'), 'Must detect codicon-run for Run');
        assert.ok(executedScript.includes('codicon-debug-start'), 'Must detect codicon-debug-start for Run');
    });

    it('DOMScanClick script must classify codicon-chevron-right, monaco-tl-twistie as "expand"', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('codicon-chevron-right'), 'Must detect codicon-chevron-right for Expand');
        assert.ok(executedScript.includes('monaco-tl-twistie'), 'Must detect monaco-tl-twistie for Expand');
    });

    it('DOMScanClick script must classify codicon-check, codicon-check-all as "accept"', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('codicon-check'), 'Must detect codicon-check for Accept');
        assert.ok(executedScript.includes('codicon-check-all'), 'Must detect codicon-check-all for Accept');
    });

    // =========================================================================
    // Reject-Pattern Precedence
    // =========================================================================

    it('DOMScanClick script must check reject patterns BEFORE accept patterns', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        const rejectCheckPos = executedScript.indexOf('reject.some');
        const acceptCheckPos = executedScript.indexOf('accept.some');
        assert.ok(rejectCheckPos > -1, 'Should have reject.some check');
        assert.ok(acceptCheckPos > -1, 'Should have accept.some check');
        assert.ok(rejectCheckPos < acceptCheckPos, 'Reject check must come BEFORE accept check to enforce priority');
    });

    // =========================================================================
    // Default Accept/Reject Patterns Safety
    // =========================================================================

    it('DEFAULT_ACCEPT_PATTERNS must not contain dangerous generic terms like "install", "uninstall", "delete"', () => {
        const defaults = interactionModule.DEFAULT_ACCEPT_PATTERNS ||
            ['accept', 'accept all', 'run', 'run command', 'retry', 'apply', 'execute',
                'confirm', 'allow once', 'allow', 'proceed', 'continue', 'yes', 'ok',
                'save', 'approve', 'overwrite', 'expand'];
        const dangerous = ['install', 'uninstall', 'delete', 'remove', 'format', 'rm -rf', 'drop'];
        for (const term of dangerous) {
            assert.ok(!defaults.includes(term), `DEFAULT_ACCEPT_PATTERNS must NOT include "${term}"`);
        }
    });

    it('DEFAULT_REJECT_PATTERNS must include common destructive-cancel terms', () => {
        const defaults = interactionModule.DEFAULT_REJECT_PATTERNS ||
            ['skip', 'reject', 'cancel', 'close', 'refine', 'deny', 'no', 'dismiss',
                'abort', 'ask every time', 'always run', 'always allow', 'stop', 'pause', 'disconnect'];
        const mustHave = ['cancel', 'reject', 'deny', 'abort', 'dismiss'];
        for (const term of mustHave) {
            assert.ok(defaults.includes(term), `DEFAULT_REJECT_PATTERNS must include "${term}"`);
        }
    });

    // =========================================================================
    // BridgeCoordinateClick Ban-List
    // =========================================================================

    it('BridgeCoordinateClick script must include workbench chrome ban-list', async () => {
        const BridgeCoordinateClick = interactionModule.BridgeCoordinateClick;
        const bridge = new BridgeCoordinateClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await bridge.execute({ cdpHandler: mockCdpHandler, selector: '.test-btn' });

        const requiredBans = [
            'quick-input-widget', 'settings-editor', 'extensions-viewlet',
            'part.activitybar', 'part.statusbar', 'part.titlebar',
            'monaco-menu', 'menubar'
        ];
        for (const ban of requiredBans) {
            assert.ok(executedScript.includes(ban), `BridgeCoordinateClick missing ban: ${ban}`);
        }
    });

    it('BridgeCoordinateClick must be disabled by default', () => {
        const BridgeCoordinateClick = interactionModule.BridgeCoordinateClick;
        const bridge = new BridgeCoordinateClick();
        assert.strictEqual(bridge.enabled, false, 'BridgeCoordinateClick must default to disabled for safety');
    });

    // =========================================================================
    // Default Config Safety
    // =========================================================================

    it('Default registry config must use dom-scan-click as the solitary click method', () => {
        const reg = new InteractionMethodRegistry();
        const clickMethods = reg.getMethodsByCategory('click');
        const clickIds = clickMethods.map(m => m.id);
        assert.ok(clickIds.includes('dom-scan-click'), 'dom-scan-click must be in default click methods');
        // bridge-click and vscode-cmd should not be enabled by default anymore for safety
        // (bridge-click is disabled at the class level; vscode-cmd may be in config but enabled=true on class)
        // The key assertion: broad unsafe methods should not dominate
        assert.ok(!clickIds.includes('bridge-click'), 'bridge-click must NOT be in default enabled click methods');
    });

    it('DOMScanClick fallbackSelectors must be empty (no broad DOM scanning without explicit selector)', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        // No selector provided — should result in empty selector parts and no fallback
        await domScan.execute({ cdpHandler: mockCdpHandler, acceptPatterns: ['run'] });

        assert.ok(executedScript.includes('const fallbackSelectors = []'), 'fallbackSelectors must be empty array');
    });

    it('DOMScanClick script must enforce max text length filter (120 chars)', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('text.length > 120'), 'Should filter elements with text > 120 chars to avoid matching full page content');
    });

    it('DOMScanClick must dispatch mousedown+mouseup+click (not just el.click()) for framework compat', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('mousedown'), 'Must dispatch mousedown event');
        assert.ok(executedScript.includes('mouseup'), 'Must dispatch mouseup event');
        assert.ok(executedScript.includes("'click'"), 'Must dispatch click event');
    });

    it('DOMScanClick must include visibility check (display, visibility, pointerEvents, disabled, rect)', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        assert.ok(executedScript.includes('display'), 'Must check display !== none');
        assert.ok(executedScript.includes('visibility'), 'Must check visibility !== hidden');
        assert.ok(executedScript.includes('pointerEvents'), 'Must check pointerEvents !== none');
        assert.ok(executedScript.includes('.disabled'), 'Must check el.disabled');
        assert.ok(executedScript.includes('getBoundingClientRect'), 'Must check bounding rect for size');
    });

    it('DOMScanClick returns false when no cdpHandler is provided', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        const result = await domScan.execute({});
        assert.strictEqual(result, false, 'Must return false without cdpHandler');
    });

    it('DOMScanClick uses DEFAULT_ACCEPT_PATTERNS when none specified', async () => {
        const DOMScanClick = interactionModule.DOMScanClick;
        const domScan = new DOMScanClick();
        let executedScript = '';
        const mockCdpHandler = {
            executeInAllSessions: async (script) => { executedScript = script; return [true]; }
        };
        // No acceptPatterns passed
        await domScan.execute({ cdpHandler: mockCdpHandler, selector: '.x' });

        // Should contain default patterns (accept, run, expand, etc.)
        assert.ok(executedScript.includes('"accept"'), 'Default patterns should include "accept"');
        assert.ok(executedScript.includes('"expand"'), 'Default patterns should include "expand"');
        assert.ok(executedScript.includes('"run"'), 'Default patterns should include "run"');
    });
});
