const assert = require('node:assert');
const { describe, it } = require('node:test');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

function createLoggerMock() {
    const noop = () => { };
    return {
        debug: noop,
        info: noop,
        warn: noop,
        error: noop
    };
}

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
            esModuleInterop: true,
        },
        fileName: absolutePath,
    }).outputText;

    const mod = new Module(absolutePath, module);
    cache.set(absolutePath, mod);
    mod.filename = absolutePath;
    mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) {
            return mocks[request];
        }

        if (request === 'vscode') {
            return {
                workspace: { workspaceFolders: [] },
                window: {
                    showInformationMessage: () => Promise.resolve(undefined),
                    createOutputChannel: () => ({ appendLine: () => undefined })
                },
                commands: { executeCommand: () => Promise.resolve(undefined) }
            };
        }

        if (request === '../utils/logger' || request.endsWith('/utils/logger')) {
            return { createLogger: () => createLoggerMock() };
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

const backoffModule = loadTsModule(path.join(__dirname, '..', 'src', 'core', 'backoff.ts'));
const { calculateAdaptiveBackoff } = backoffModule;

const autonomousLoopModule = loadTsModule(
    path.join(__dirname, '..', 'src', 'core', 'autonomous-loop.ts'),
    {
        './progress-tracker': { progressTracker: { startSession: () => undefined, recordLoop: async () => undefined, recordModelSwitch: () => undefined, getSummary: () => '' } },
        './rate-limiter': { rateLimiter: { reset: () => undefined, canMakeCall: () => true, handleRateLimitReached: async () => 'continue', recordCall: () => undefined } },
        './task-analyzer': { taskAnalyzer: {} },
        './project-tracker': { projectTracker: { getNextTask: () => null, completeTask: () => true } },
        './model-selector': { modelSelector: { selectForTask: async () => ({ modelDisplayName: 'test', reasoning: 'test', modelId: 'test' }), showSwitchNotification: () => undefined } },
        './exit-detector': { exitDetector: { reset: () => undefined, checkResponse: () => ({ shouldExit: false }), reportSuccess: () => undefined, reportFailure: () => ({ shouldExit: false }) } },
        '../core/circuit-breaker': { circuitBreaker: { execute: async (fn) => fn(), getState: () => 'closed' }, CircuitState: { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' } },
        '../providers/cdp-client': { cdpClient: { isConnected: () => false, connect: async () => false, injectPrompt: async () => true, waitForResponse: async () => '', sendMessage: async () => undefined } },
        '../utils/config': { config: { get: () => undefined } },
        './test-loop-detector': { testLoopDetector: { analyzeResponse: () => ({ shouldExit: false }) } },
        './memory-manager': { memoryManager: { startSession: () => undefined, endSession: () => undefined, rememberConversation: () => undefined, getContextForPrompt: () => '' } },
    }
);

const { AutonomousLoop } = autonomousLoopModule;

describe('Adaptive Backoff Logic', () => {
    const baseInterval = 30;
    const maxMinutes = 5;

    it('should return base interval for 0 failures', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 0, maxMinutes);
        assert.strictEqual(result, 30);
    });

    it('should return base interval for negative failure count', () => {
        const result = calculateAdaptiveBackoff(baseInterval, -1, maxMinutes);
        assert.strictEqual(result, 30);
    });

    it('should double interval for 1 failure', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 1, maxMinutes);
        assert.strictEqual(result, 60);
    });

    it('should be 4x for 2 failures', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 2, maxMinutes);
        assert.strictEqual(result, 120);
    });

    it('should cap exponent at 6 failures (64x)', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 6, 100); // High max to test exponent cap
        assert.strictEqual(result, 30 * 64); // 1920
    });

    it('should not exceed maxMinutes (hard cap)', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 10, 5); // 5 mins = 300s
        assert.strictEqual(result, 300);
    });

    it('should keep AutonomousLoop.calculateBackoff behavior aligned with core backoff module', () => {
        const result = AutonomousLoop.calculateBackoff(baseInterval, 3, maxMinutes);
        assert.strictEqual(result, calculateAdaptiveBackoff(baseInterval, 3, maxMinutes));
    });
});
