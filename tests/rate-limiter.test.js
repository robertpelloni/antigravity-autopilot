const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * RateLimiter Logic Tests
 * Tests call counting, hour-based reset, remaining calls,
 * and rate limit detection — without VS Code dependencies.
 */

let mockMaxCallsPerHour = 100;

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
        if (request === 'vscode') {
            return {
                window: {
                    createOutputChannel: () => ({ appendLine: () => undefined }),
                    showWarningMessage: async () => 'Exit Now',
                    withProgress: async (_options, task) => task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => undefined })
                },
                workspace: {
                    getConfiguration: () => ({
                        get: (key, fallback) => {
                            if (key === 'maxCallsPerHour') {
                                return mockMaxCallsPerHour;
                            }
                            return fallback;
                        },
                        update: async () => undefined
                    })
                },
                ProgressLocation: { Notification: 15 },
                ConfigurationTarget: { Global: 1 }
            };
        }

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

const rateLimiterModule = loadTsModule(path.resolve(__dirname, '../src/core/rate-limiter.ts'));
const RateLimiter = rateLimiterModule.RateLimiter;

// ============ Tests ============

describe('RateLimiter', () => {
    it('should allow calls under the limit', () => {
        mockMaxCallsPerHour = 10;
        const rl = new RateLimiter();
        assert.strictEqual(rl.canMakeCall(), true);
        for (let i = 0; i < 5; i++) rl.recordCall();
        assert.strictEqual(rl.canMakeCall(), true);
    });

    it('should block calls at the limit', () => {
        mockMaxCallsPerHour = 3;
        const rl = new RateLimiter();
        rl.recordCall();
        rl.recordCall();
        rl.recordCall();
        assert.strictEqual(rl.canMakeCall(), false);
    });

    it('should track remaining calls', () => {
        mockMaxCallsPerHour = 10;
        const rl = new RateLimiter();
        assert.strictEqual(rl.getRemainingCalls(), 10);
        rl.recordCall();
        rl.recordCall();
        assert.strictEqual(rl.getRemainingCalls(), 8);
    });

    it('should reset after hour boundary', () => {
        mockMaxCallsPerHour = 10;
        const rl = new RateLimiter();
        rl.recordCall();
        rl.recordCall();
        // Simulate hour passing
        rl.state.hourStartTime = Date.now() - (61 * 60 * 1000);
        assert.strictEqual(rl.getRemainingCalls(), 10);
    });

    it('should calculate time until reset', () => {
        mockMaxCallsPerHour = 10;
        const rl = new RateLimiter();
        const remaining = rl.getTimeUntilReset();
        assert.ok(remaining > 0);
        assert.ok(remaining <= 60 * 60 * 1000);
    });

    it('should fully reset via reset()', () => {
        mockMaxCallsPerHour = 5;
        const rl = new RateLimiter();
        rl.recordCall();
        rl.recordCall();
        rl.recordCall();
        rl.reset();
        assert.strictEqual(rl.getRemainingCalls(), 5);
        assert.strictEqual(rl.canMakeCall(), true);
    });

    it('should not go negative on remaining calls', () => {
        mockMaxCallsPerHour = 2;
        const rl = new RateLimiter();
        rl.recordCall();
        rl.recordCall();
        rl.recordCall(); // over limit
        assert.strictEqual(rl.getRemainingCalls(), 0);
    });
});
