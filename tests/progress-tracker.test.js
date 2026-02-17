const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * ProgressTracker Logic Tests
 * Tests session lifecycle, loop recording, stats tracking, and summary.
 */

let mockWorkspaceRoot = process.cwd();
let mockGitDiffOutput = '';

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
                    workspaceFolders: [{ uri: { fsPath: mockWorkspaceRoot } }],
                    getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => undefined })
                }
            };
        }

        if (request === 'child_process') {
            return {
                exec: (_cmd, _options, callback) => {
                    callback(null, { stdout: mockGitDiffOutput, stderr: '' });
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

const progressTrackerModule = loadTsModule(path.resolve(__dirname, '../src/core/progress-tracker.ts'));
const ProgressTracker = progressTrackerModule.ProgressTracker;

// ============ Tests ============

describe('ProgressTracker', () => {
    it('should start a fresh session', () => {
        mockGitDiffOutput = '';
        const pt = new ProgressTracker();
        pt.startSession();
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 0);
        assert.strictEqual(stats.successfulLoops, 0);
        assert.strictEqual(stats.failedLoops, 0);
        assert.deepStrictEqual(stats.errorTaxonomy, {
            transport: 0,
            parse: 0,
            timeout: 0,
            policy: 0,
            unknown: 0
        });
    });

    it('should record successful loops', async () => {
        mockGitDiffOutput = 'src/a.ts\nsrc/b.ts\n';
        const pt = new ProgressTracker();
        const result = await pt.recordLoop({ modelUsed: 'test', hasErrors: false, responseText: 'ok' });
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 1);
        assert.strictEqual(stats.successfulLoops, 1);
        assert.strictEqual(stats.filesChanged, 2);
        assert.strictEqual(result.filesChanged, 2);
        assert.strictEqual(result.responseLength, 2);
        assert.strictEqual(result.responseHash.length, 16);
    });

    it('should record failed loops', async () => {
        mockGitDiffOutput = '';
        const pt = new ProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: true, errorType: 'timeout' });
        const stats = pt.getStats();
        assert.strictEqual(stats.failedLoops, 1);
        assert.strictEqual(stats.filesChanged, 0);
        assert.strictEqual(stats.errorTaxonomy.timeout, 1);
    });

    it('should track model switches', () => {
        const pt = new ProgressTracker();
        pt.recordModelSwitch();
        pt.recordModelSwitch();
        assert.strictEqual(pt.getStats().modelSwitches, 2);
    });

    it('should track prompts sent', () => {
        const pt = new ProgressTracker();
        pt.recordPromptSent();
        pt.recordPromptSent();
        pt.recordPromptSent();
        assert.strictEqual(pt.getStats().promptsSent, 3);
    });

    it('should generate summary string', async () => {
        mockGitDiffOutput = 'src/file.ts\n';
        const pt = new ProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: false, responseText: 'done' });
        await pt.recordLoop({ modelUsed: 'test', hasErrors: true, errorType: 'parse' });
        pt.recordModelSwitch();
        const summary = pt.getSummary();
        assert.ok(summary.includes('Total Loops: 2'));
        assert.ok(summary.includes('Model Switches: 1'));
        assert.ok(summary.includes('Success Rate: 50.0%'));
        assert.ok(summary.includes('Error Types: transport=0, parse=1, timeout=0, policy=0, unknown=0'));
    });

    it('should track duration', () => {
        const pt = new ProgressTracker();
        const duration = pt.getDurationMinutes();
        assert.ok(duration >= 0);
        assert.ok(duration < 1); // Should be less than 1 minute since we just created it
    });

    it('should reset on new session', async () => {
        mockGitDiffOutput = 'src/file.ts\n';
        const pt = new ProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: false, responseText: 'x' });
        pt.recordModelSwitch();
        pt.startSession();
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 0);
        assert.strictEqual(stats.modelSwitches, 0);
        assert.strictEqual(stats.filesChanged, 0);
    });
});
