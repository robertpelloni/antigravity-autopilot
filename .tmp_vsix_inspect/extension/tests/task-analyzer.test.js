const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');

function createLoggerMock() {
    const noop = () => { };
    return {
        debug: noop,
        info: noop,
        warn: noop,
        error: noop
    };
}

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
        if (request === '../utils/logger' || request.endsWith('/utils/logger')) {
            return { createLogger: () => createLoggerMock() };
        }

        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [
                `${base}.ts`,
                path.join(base, 'index.ts')
            ];

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

const taskAnalyzerPath = path.join(ROOT, 'src', 'core', 'task-analyzer.ts');
const taskAnalyzerModule = loadTsModule(taskAnalyzerPath);
const taskAnalyzer = taskAnalyzerModule.taskAnalyzer;

describe('TaskAnalyzer', () => {
    it('should classify debugging tasks as REASONING', () => {
        assert.strictEqual(taskAnalyzer.analyze('Debug the memory leak issue'), 'reasoning');
        assert.strictEqual(taskAnalyzer.analyze('Fix the race condition bug'), 'reasoning');
    });

    it('should classify UI tasks as FRONTEND', () => {
        assert.strictEqual(taskAnalyzer.analyze('Update the CSS styles for the dashboard'), 'frontend');
        assert.strictEqual(taskAnalyzer.analyze('Create a new React component for the modal'), 'frontend');
    });

    it('should classify simple tasks as QUICK', () => {
        assert.strictEqual(taskAnalyzer.analyze('Rename the variable and fix the typo'), 'quick');
        assert.strictEqual(taskAnalyzer.analyze('Remove unused imports'), 'quick');
    });

    it('should default to GENERAL for unrecognizable tasks', () => {
        assert.strictEqual(taskAnalyzer.analyze('Do something interesting'), 'general');
    });

    it('should default to GENERAL for empty input', () => {
        assert.strictEqual(taskAnalyzer.analyze(''), 'general');
        assert.strictEqual(taskAnalyzer.analyze(null), 'general');
    });

    it('should extract current task from fix plan', () => {
        const plan = '- [x] Done task\n- [ ] Current task\n- [ ] Future task';
        assert.strictEqual(taskAnalyzer.extractCurrentTask(plan), 'Current task');
    });

    it('should skip crossed-out tasks', () => {
        const plan = '- [ ] ~~Skipped~~ task\n- [ ] Valid task';
        assert.strictEqual(taskAnalyzer.extractCurrentTask(plan), 'Valid task');
    });

    it('should mark task complete', () => {
        const content = '- [ ] Fix the bug\n- [ ] Other task';
        const updated = taskAnalyzer.markTaskComplete(content, 'Fix the bug');
        assert.ok(updated.includes('[x] Fix the bug'));
    });

    it('should return null when no tasks remain', () => {
        assert.strictEqual(taskAnalyzer.extractCurrentTask('- [x] All done'), null);
    });
});
