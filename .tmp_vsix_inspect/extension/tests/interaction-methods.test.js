const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Interaction Method Registry Tests
 * Tests registration, priority ordering, sequential/parallel execution,
 * timing, and fallback behavior.
 */

// ============ Replicate core logic for testing ============

class TestMethod {
    constructor(id, category, priority, shouldSucceed = true, timingMs = 10) {
        this.id = id;
        this.name = `Test ${id}`;
        this.description = `Test method ${id}`;
        this.category = category;
        this.enabled = true;
        this.priority = priority;
        this.timingMs = timingMs;
        this.requiresCDP = false;
        this.shouldSucceed = shouldSucceed;
        this.callCount = 0;
        this.callOrder = -1;
    }

    async execute(ctx) {
        this.callCount++;
        this.callOrder = TestMethod.globalCallOrder++;
        if (!this.shouldSucceed) throw new Error(`${this.id} failed`);
        return true;
    }
}
TestMethod.globalCallOrder = 0;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

class TestRegistry {
    constructor(config = {}) {
        this.methods = new Map();
        this.config = {
            textInput: config.textInput || [],
            click: config.click || [],
            submit: config.submit || [],
            timings: config.timings || {},
            retryCount: config.retryCount || 3,
            parallelExecution: config.parallelExecution || false
        };
    }

    register(method) {
        if (this.config.timings[method.id] !== undefined) {
            method.timingMs = this.config.timings[method.id];
        }
        this.methods.set(method.id, method);
    }

    getMethod(id) { return this.methods.get(id); }

    getMethodsByCategory(category) {
        const enabledIds = category === 'text' ? this.config.textInput
            : category === 'click' ? this.config.click
                : this.config.submit;

        return Array.from(this.methods.values())
            .filter(m => m.category === category && enabledIds.includes(m.id))
            .sort((a, b) => a.priority - b.priority);
    }

    getAllMethods() {
        return Array.from(this.methods.values()).sort((a, b) => a.priority - b.priority);
    }

    async executeCategory(category, ctx) {
        const methods = this.getMethodsByCategory(category);
        const results = [];
        let successCount = 0;

        if (this.config.parallelExecution) {
            const settled = await Promise.allSettled(
                methods.map(async m => {
                    const start = Date.now();
                    try {
                        const ok = await m.execute(ctx);
                        return { methodId: m.id, success: ok, durationMs: Date.now() - start };
                    } catch (e) {
                        return { methodId: m.id, success: false, durationMs: Date.now() - start, error: e.message };
                    }
                })
            );
            for (const outcome of settled) {
                if (outcome.status === 'fulfilled') results.push(outcome.value);
            }
        } else {
            for (const method of methods) {
                if (successCount >= this.config.retryCount) break;
                const start = Date.now();
                try {
                    const ok = await method.execute(ctx);
                    results.push({ methodId: method.id, success: ok, durationMs: Date.now() - start });
                    if (ok) successCount++;
                } catch (e) {
                    results.push({ methodId: method.id, success: false, durationMs: Date.now() - start, error: e.message });
                }
            }
        }

        return results;
    }

    getSummary() {
        return this.getAllMethods().map(m => ({
            id: m.id, name: m.name, category: m.category,
            enabled: this.isEnabled(m), priority: m.priority,
            timingMs: m.timingMs, requiresCDP: m.requiresCDP
        }));
    }

    isEnabled(method) {
        const list = method.category === 'text' ? this.config.textInput
            : method.category === 'click' ? this.config.click
                : this.config.submit;
        return list.includes(method.id);
    }
}

// ============ Tests ============

describe('Interaction Method Registry', () => {
    it('should register and retrieve methods by ID', () => {
        const reg = new TestRegistry({ textInput: ['a'] });
        const m = new TestMethod('a', 'text', 1);
        reg.register(m);
        assert.strictEqual(reg.getMethod('a').id, 'a');
    });

    it('should return methods sorted by priority', () => {
        const reg = new TestRegistry({ click: ['low', 'mid', 'high'] });
        reg.register(new TestMethod('high', 'click', 3));
        reg.register(new TestMethod('low', 'click', 1));
        reg.register(new TestMethod('mid', 'click', 2));

        const sorted = reg.getMethodsByCategory('click');
        assert.deepStrictEqual(sorted.map(m => m.id), ['low', 'mid', 'high']);
    });

    it('should filter by enabled config', () => {
        const reg = new TestRegistry({ submit: ['a', 'c'] }); // b not enabled
        reg.register(new TestMethod('a', 'submit', 1));
        reg.register(new TestMethod('b', 'submit', 2));
        reg.register(new TestMethod('c', 'submit', 3));

        const methods = reg.getMethodsByCategory('submit');
        assert.strictEqual(methods.length, 2);
        assert.ok(!methods.find(m => m.id === 'b'));
    });

    it('should apply timing overrides from config', () => {
        const reg = new TestRegistry({ textInput: ['x'], timings: { 'x': 999 } });
        const m = new TestMethod('x', 'text', 1);
        reg.register(m);
        assert.strictEqual(reg.getMethod('x').timingMs, 999);
    });

    it('should execute methods sequentially and stop at retryCount', async () => {
        TestMethod.globalCallOrder = 0;
        const reg = new TestRegistry({ textInput: ['a', 'b', 'c', 'd'], retryCount: 2 });
        reg.register(new TestMethod('a', 'text', 1));
        reg.register(new TestMethod('b', 'text', 2));
        reg.register(new TestMethod('c', 'text', 3));
        reg.register(new TestMethod('d', 'text', 4));

        const results = await reg.executeCategory('text', {});
        // Should stop after 2 successes (retryCount = 2)
        assert.strictEqual(results.length, 2);
        assert.strictEqual(results[0].methodId, 'a');
        assert.strictEqual(results[1].methodId, 'b');
    });

    it('should handle failing methods and continue to next', async () => {
        TestMethod.globalCallOrder = 0;
        const reg = new TestRegistry({ click: ['fail1', 'ok1', 'ok2'], retryCount: 2 });
        reg.register(new TestMethod('fail1', 'click', 1, false));
        reg.register(new TestMethod('ok1', 'click', 2, true));
        reg.register(new TestMethod('ok2', 'click', 3, true));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 3);
        assert.strictEqual(results[0].success, false);
        assert.ok(results[0].error);
        assert.strictEqual(results[1].success, true);
        assert.strictEqual(results[2].success, true);
    });

    it('should execute all methods in parallel mode', async () => {
        TestMethod.globalCallOrder = 0;
        const reg = new TestRegistry({ submit: ['s1', 's2', 's3'], retryCount: 1, parallelExecution: true });
        reg.register(new TestMethod('s1', 'submit', 1));
        reg.register(new TestMethod('s2', 'submit', 2));
        reg.register(new TestMethod('s3', 'submit', 3));

        const results = await reg.executeCategory('submit', {});
        // In parallel mode, all methods are executed regardless of retryCount
        assert.strictEqual(results.length, 3);
        assert.ok(results.every(r => r.success));
    });

    it('should generate correct summary', () => {
        const reg = new TestRegistry({ textInput: ['m1'], click: ['m2'] });
        reg.register(new TestMethod('m1', 'text', 1));
        reg.register(new TestMethod('m2', 'click', 2));
        reg.register(new TestMethod('m3', 'submit', 3)); // not enabled

        const summary = reg.getSummary();
        assert.strictEqual(summary.length, 3);
        assert.strictEqual(summary.find(s => s.id === 'm1').enabled, true);
        assert.strictEqual(summary.find(s => s.id === 'm2').enabled, true);
        assert.strictEqual(summary.find(s => s.id === 'm3').enabled, false);
    });

    it('should return empty results for category with no enabled methods', async () => {
        const reg = new TestRegistry({ textInput: [] }); // nothing enabled
        reg.register(new TestMethod('x', 'text', 1));

        const results = await reg.executeCategory('text', {});
        assert.strictEqual(results.length, 0);
    });

    it('should handle concurrent failures gracefully in parallel mode', async () => {
        const reg = new TestRegistry({ click: ['f1', 'f2'], parallelExecution: true });
        reg.register(new TestMethod('f1', 'click', 1, false));
        reg.register(new TestMethod('f2', 'click', 2, false));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 2);
        assert.ok(results.every(r => !r.success));
    });

    it('should support expanded method ID combinations from settings', () => {
        const reg = new TestRegistry({
            textInput: ['cdp-keys', 'cdp-insert-text', 'bridge-type'],
            click: ['dom-scan-click', 'bridge-click', 'native-accept', 'process-peek', 'visual-verify-click'],
            submit: ['vscode-submit', 'cdp-enter', 'ctrl-enter', 'alt-enter']
        });

        reg.register(new TestMethod('cdp-keys', 'text', 1));
        reg.register(new TestMethod('cdp-insert-text', 'text', 2));
        reg.register(new TestMethod('bridge-type', 'text', 3));
        reg.register(new TestMethod('dom-scan-click', 'click', 1));
        reg.register(new TestMethod('bridge-click', 'click', 2));
        reg.register(new TestMethod('native-accept', 'click', 3));
        reg.register(new TestMethod('process-peek', 'click', 4));
        reg.register(new TestMethod('visual-verify-click', 'click', 5));
        reg.register(new TestMethod('vscode-submit', 'submit', 1));
        reg.register(new TestMethod('cdp-enter', 'submit', 2));
        reg.register(new TestMethod('ctrl-enter', 'submit', 3));
        reg.register(new TestMethod('alt-enter', 'submit', 4));

        assert.strictEqual(reg.getMethodsByCategory('text').length, 3);
        assert.strictEqual(reg.getMethodsByCategory('click').length, 5);
        assert.strictEqual(reg.getMethodsByCategory('submit').length, 4);
    });

    it('should execute mixed click methods until retry success target is reached', async () => {
        const reg = new TestRegistry({
            click: ['dom-scan-click', 'bridge-click', 'native-accept', 'process-peek'],
            retryCount: 2
        });

        reg.register(new TestMethod('dom-scan-click', 'click', 1, false));
        reg.register(new TestMethod('bridge-click', 'click', 2, true));
        reg.register(new TestMethod('native-accept', 'click', 3, true));
        reg.register(new TestMethod('process-peek', 'click', 4, true));

        const results = await reg.executeCategory('click', {});
        assert.strictEqual(results.length, 3);
        assert.deepStrictEqual(results.map(r => r.methodId), ['dom-scan-click', 'bridge-click', 'native-accept']);
        assert.strictEqual(results.filter(r => r.success).length, 2);
    });
});
