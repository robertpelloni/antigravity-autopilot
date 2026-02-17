const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * CircuitBreaker Logic Tests
 * Tests state transitions (CLOSED → OPEN → HALF_OPEN → CLOSED),
 * failure counting, threshold tripping, and recovery.
 */

function loadTsModule(filePath, cache = new Map()) {
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
        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, cache);
                }
            }
        }

        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

const circuitBreakerModule = loadTsModule(path.resolve(__dirname, '../src/core/circuit-breaker.ts'));
const CircuitBreaker = circuitBreakerModule.CircuitBreaker;
const CircuitState = circuitBreakerModule.CircuitState;

// ============ Tests ============

describe('CircuitBreaker', () => {
    it('should start in CLOSED state', () => {
        const cb = new CircuitBreaker();
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    });

    it('should execute actions when CLOSED', async () => {
        const cb = new CircuitBreaker();
        const result = await cb.execute(() => Promise.resolve('hello'));
        assert.strictEqual(result, 'hello');
    });

    it('should count failures and trip at threshold', async () => {
        const cb = new CircuitBreaker();
        for (let i = 0; i < 5; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);
    });

    it('should block actions when OPEN', async () => {
        const cb = new CircuitBreaker();
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);

        const result = await cb.execute(() => Promise.resolve('should not run'));
        assert.strictEqual(result, null);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
        const cb = new CircuitBreaker();
        for (let i = 0; i < 5; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);

        // Force lastFailureTime into the past so timeout has elapsed
        cb.lastFailureTime = Date.now() - 35000;
        const result = await cb.execute(() => Promise.resolve('recovered'));
        assert.strictEqual(result, 'recovered');
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    });

    it('should reset to CLOSED on success in HALF_OPEN', async () => {
        const cb = new CircuitBreaker();
        for (let i = 0; i < 5; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }

        cb.lastFailureTime = Date.now() - 35000; // Force timeout elapsed
        const result = await cb.execute(() => Promise.resolve('ok'));
        assert.strictEqual(result, 'ok');
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
        assert.strictEqual(cb.failureCount, 0);
    });

    it('should not trip before reaching threshold', async () => {
        const cb = new CircuitBreaker();
        for (let i = 0; i < 4; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
        assert.strictEqual(cb.failureCount, 4);
    });
});
