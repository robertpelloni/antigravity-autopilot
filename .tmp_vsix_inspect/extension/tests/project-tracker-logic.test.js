const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

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
                    return loadTsModule(candidate, mocks, cache);
                }
            }
        }

        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

test('ProjectTracker real-module logic', async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-project-tracker-'));
    const taskFile = path.join(tempRoot, 'task.md');

    fs.writeFileSync(taskFile, [
        '# Tasks',
        '- [x] Done task',
        '- [ ] Current task',
        '- [ ] Future task'
    ].join('\n'));

    const vscodeMock = {
        workspace: {
            workspaceFolders: [{ uri: { fsPath: tempRoot } }]
        }
    };

    const projectTrackerPath = path.resolve(__dirname, '../src/core/project-tracker.ts');
    const mod = loadTsModule(projectTrackerPath, { vscode: vscodeMock });
    const tracker = new mod.ProjectTracker();

    await t.test('should extract first incomplete task from real module', () => {
        const task = tracker.getNextTask();
        assert.strictEqual(task, 'Current task');
    });

    await t.test('should mark task complete using real module', () => {
        const ok = tracker.completeTask('Current task');
        assert.strictEqual(ok, true);
        const updated = fs.readFileSync(taskFile, 'utf-8');
        assert.ok(updated.includes('- [x] Current task'));
    });
});
