const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * TestLoopDetector Logic Tests
 * Tests detection of test-only vs feature-work loops and exit conditions.
 */

let mockMaxConsecutiveTestLoops = 3;

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
                    createOutputChannel: () => ({ appendLine: () => undefined })
                },
                workspace: {
                    getConfiguration: () => ({
                        get: (key, fallback) => {
                            if (key === 'maxConsecutiveTestLoops') {
                                return mockMaxConsecutiveTestLoops;
                            }
                            return fallback;
                        },
                        update: async () => undefined
                    })
                },
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

const testLoopDetectorModule = loadTsModule(path.resolve(__dirname, '../src/core/test-loop-detector.ts'));
const TestLoopDetector = testLoopDetectorModule.TestLoopDetector;

// ============ Tests ============

describe('TestLoopDetector', () => {
    it('should detect test-only responses', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('All tests passed. 45 tests passing.');
        assert.strictEqual(result.isTestOnly, true);
        assert.ok(result.confidence > 0);
    });

    it('should detect feature work responses', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('Created new file utils.ts and implemented the handler');
        assert.strictEqual(result.isTestOnly, false);
    });

    it('should not flag mixed responses as test-only', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('Implemented new feature. Running tests now. All tests passed.');
        assert.strictEqual(result.isTestOnly, false);
    });

    it('should track consecutive test loops', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Running test suite');
        assert.strictEqual(d.getStatus().consecutive, 2);
    });

    it('should reset consecutive on feature work', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Created new file service.ts');
        assert.strictEqual(d.getStatus().consecutive, 0);
    });

    it('should trigger exit after max consecutive test loops', () => {
        mockMaxConsecutiveTestLoops = 2;
        const d = new TestLoopDetector();
        d.analyzeResponse('npm test');
        const result = d.analyzeResponse('All tests passed');
        assert.strictEqual(result.shouldExit, true);
        assert.ok(String(result.reason || '').includes('consecutive test-only loops'));
    });

    it('should track test percentage', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Implementing feature');
        assert.strictEqual(d.getTestPercentage(), 50);
    });

    it('should reset state', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.reset();
        assert.strictEqual(d.getStatus().consecutive, 0);
        assert.strictEqual(d.getStatus().total, 0);
    });

    it('should handle empty responses', () => {
        mockMaxConsecutiveTestLoops = 3;
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('');
        assert.strictEqual(result.isTestOnly, false);
        assert.strictEqual(result.shouldExit, false);
    });
});
