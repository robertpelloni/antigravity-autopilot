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

    it('should execute methods sequentially and stop at retryCount successes', async () => {
        const reg = new InteractionMethodRegistry({ textInput: ['a', 'b', 'c', 'd'], retryCount: 2, timings: { a: 0, b: 0, c: 0, d: 0 } });
        reg.register(createTestMethod('a', 'text', 1, true, 0));
        reg.register(createTestMethod('b', 'text', 2, true, 0));
        reg.register(createTestMethod('c', 'text', 3, true, 0));
        reg.register(createTestMethod('d', 'text', 4, true, 0));

        const results = await reg.executeCategory('text', {});
        assert.strictEqual(results.length, 2);
        assert.deepStrictEqual(results.map((r) => r.methodId), ['a', 'b']);
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

    it('should execute all methods in parallel mode regardless of retryCount', async () => {
        const reg = new InteractionMethodRegistry({ submit: ['s1', 's2', 's3'], retryCount: 1, parallelExecution: true, timings: { s1: 0, s2: 0, s3: 0 } });
        reg.register(createTestMethod('s1', 'submit', 1, true, 0));
        reg.register(createTestMethod('s2', 'submit', 2, true, 0));
        reg.register(createTestMethod('s3', 'submit', 3, true, 0));

        const results = await reg.executeCategory('submit', {});
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

    it('should support expanded method ID combinations from settings', () => {
        const reg = new InteractionMethodRegistry({
            textInput: ['cdp-keys', 'cdp-insert-text', 'bridge-type'],
            click: ['dom-scan-click', 'bridge-click', 'native-accept', 'process-peek', 'visual-verify-click'],
            submit: ['vscode-submit', 'cdp-enter', 'ctrl-enter', 'alt-enter']
        });

        assert.strictEqual(reg.getMethodsByCategory('text').length, 3);
        assert.strictEqual(reg.getMethodsByCategory('click').length, 5);
        assert.strictEqual(reg.getMethodsByCategory('submit').length, 4);
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
});
