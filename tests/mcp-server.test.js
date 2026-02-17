const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function createLoggerMock() {
    const noop = () => { };
    return { debug: noop, info: noop, warn: noop, error: noop };
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

        if (request === '../../utils/logger' || request.endsWith('/utils/logger')) {
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

function createProjectTrackerMock() {
    const state = {
        tasks: ['Implement auth module', 'Write API tests'],
        completed: []
    };

    return {
        getNextTask: () => state.tasks.find(t => !state.completed.includes(t)) || null,
        completeTask: (desc) => {
            if (state.tasks.includes(desc)) {
                state.completed.push(desc);
                return true;
            }
            return false;
        }
    };
}

const tracker = createProjectTrackerMock();
const serverModule = loadTsModule(
    path.resolve(__dirname, '../src/modules/mcp/server.ts'),
    {
        vscode: { window: { showInformationMessage: () => undefined } },
        '../../core/project-tracker': { projectTracker: tracker }
    }
);
const MCPServer = serverModule.MCPServer;

describe('MCP Server Request Handler', () => {
    it('should return next task via get_next_task tool', async () => {
        const server = new MCPServer();
        const response = await server.handleRequest({
            method: 'tools/call',
            params: { name: 'get_next_task', arguments: {} },
            id: 1
        });

        assert.strictEqual(response.jsonrpc, '2.0');
        assert.strictEqual(response.id, 1);
        assert.strictEqual(response.result.content[0].text, 'Implement auth module');
    });

    it('should complete a task via complete_task tool', async () => {
        const server = new MCPServer();
        const response = await server.handleRequest({
            method: 'tools/call',
            params: { name: 'complete_task', arguments: { task_description: 'Implement auth module' } },
            id: 2
        });

        assert.strictEqual(response.result.content[0].text, 'Task marked as complete');
        assert.strictEqual(tracker.getNextTask(), 'Write API tests');
    });

    it('should return "Task not found" for unknown task', async () => {
        const server = new MCPServer();
        const response = await server.handleRequest({
            method: 'tools/call',
            params: { name: 'complete_task', arguments: { task_description: 'Nonexistent task' } },
            id: 3
        });

        assert.strictEqual(response.result.content[0].text, 'Task not found');
    });

    it('should return "No tasks pending" when all done', async () => {
        const doneTracker = {
            getNextTask: () => null,
            completeTask: () => false
        };
        const doneModule = loadTsModule(
            path.resolve(__dirname, '../src/modules/mcp/server.ts'),
            {
                vscode: { window: { showInformationMessage: () => undefined } },
                '../../core/project-tracker': { projectTracker: doneTracker }
            }
        );
        const server = new doneModule.MCPServer();
        const response = await server.handleRequest({
            method: 'tools/call',
            params: { name: 'get_next_task', arguments: {} },
            id: 4
        });

        assert.strictEqual(response.result.content[0].text, 'No tasks pending');
    });

    it('should handle unknown methods gracefully', async () => {
        const server = new MCPServer();
        const response = await server.handleRequest({
            method: 'unknown/method',
            params: {},
            id: 5
        });

        assert.strictEqual(response.error.code, -32601);
        assert.strictEqual(response.id, 5);
    });
});
