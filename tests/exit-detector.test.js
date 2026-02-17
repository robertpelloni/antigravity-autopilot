const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * Exit Detector Logic Tests
 * Tests the exit detection and consecutive failure tracking logic
 * without requiring VS Code dependencies.
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
        if (request === 'vscode') {
            return {
                window: {
                    createOutputChannel: () => ({
                        appendLine: () => undefined
                    })
                }
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

const exitDetectorModule = loadTsModule(path.resolve(__dirname, '../src/core/exit-detector.ts'));
const ExitDetector = exitDetectorModule.ExitDetector;

describe('ExitDetector Logic', () => {
    it('should detect completion phrases', () => {
        const det = new ExitDetector();
        const completed = det.checkResponse('All tasks completed successfully');
        const achieved = det.checkResponse('The goal achieved!');
        assert.strictEqual(completed.shouldExit, true);
        assert.strictEqual(achieved.shouldExit, true);
        assert.ok(completed.confidence >= 0.5);
        assert.ok(Array.isArray(completed.reasons));
    });

    it('should not trigger on normal responses', () => {
        const det = new ExitDetector();
        assert.strictEqual(det.checkResponse('Working on task 3...').shouldExit, false);
        assert.strictEqual(det.checkResponse('Implemented the feature').shouldExit, false);
    });

    it('should avoid premature completion when active work is still mentioned', () => {
        const det = new ExitDetector();
        const result = det.checkResponse('All tasks completed, continuing with next task and running tests.');
        assert.strictEqual(result.shouldExit, false);
        assert.ok(result.confidence < 0.5);
    });

    it('should track consecutive failures', () => {
        const det = new ExitDetector();
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(det.reportFailure().shouldExit, false);
        }
        // 5th failure should trigger exit
        assert.strictEqual(det.reportFailure().shouldExit, true);
    });

    it('should reset failure count on success', () => {
        const det = new ExitDetector();
        det.reportFailure();
        det.reportFailure();
        det.reportSuccess();
        assert.strictEqual(det.failureCount, 0);
        // Should need 5 more failures to trigger
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(det.reportFailure().shouldExit, false);
        }
        assert.strictEqual(det.reportFailure().shouldExit, true);
    });

    it('should reset via reset()', () => {
        const det = new ExitDetector();
        det.reportFailure();
        det.reportFailure();
        det.reportFailure();
        det.reset();
        assert.strictEqual(det.failureCount, 0);
    });
});
