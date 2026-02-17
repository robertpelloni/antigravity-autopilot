const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const TaskType = { REASONING: 'reasoning', FRONTEND: 'frontend', QUICK: 'quick', GENERAL: 'general' };

function createLoggerMock() {
    const noop = () => { };
    return { debug: noop, info: noop, warn: noop, error: noop };
}

function createCdpMock() {
    return {
        isConnected: () => true,
        connect: async () => undefined,
        injectPrompt: async () => undefined,
        waitForResponse: async () => '["Task A", "Task B"]'
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

const orchestratorModule = loadTsModule(
    path.resolve(__dirname, '../src/core/agent-orchestrator.ts'),
    {
        '../providers/cdp-client': { cdpClient: createCdpMock() }
    }
);
const AgentOrchestrator = orchestratorModule.AgentOrchestrator;

// ============ Tests ============

describe('AgentOrchestrator', () => {
    it('should initialize with 5 default agents', () => {
        const o = new AgentOrchestrator();
        assert.strictEqual(o.agents.size, 5);
        assert.ok(o.agents.has('researcher'));
        assert.ok(o.agents.has('implementer'));
        assert.ok(o.agents.has('reviewer'));
        assert.ok(o.agents.has('tester'));
        assert.ok(o.agents.has('planner'));
    });

    it('should select researcher for reasoning tasks', () => {
        const o = new AgentOrchestrator();
        assert.strictEqual(o.selectAgentForTask(TaskType.REASONING), 'researcher');
    });

    it('should select implementer for frontend and tester for quick tasks', () => {
        const o = new AgentOrchestrator();
        assert.strictEqual(o.selectAgentForTask(TaskType.FRONTEND), 'implementer');
        assert.strictEqual(o.selectAgentForTask(TaskType.QUICK), 'tester');
    });

    it('should detect complex tasks', () => {
        const o = new AgentOrchestrator();
        assert.strictEqual(o.isComplexTask('Build from scratch a full auth system'), true);
        assert.strictEqual(o.isComplexTask('Fix typo'), false);
    });

    it('should not rely on length-only for complexity', () => {
        const o = new AgentOrchestrator();
        const longDesc = 'a'.repeat(201);
        assert.strictEqual(o.isComplexTask(longDesc), false);
    });

    it('should submit tasks and return task IDs', async () => {
        const o = new AgentOrchestrator();
        const id = await o.submitTask('Test task');
        assert.ok(id.startsWith('task_'));
        assert.strictEqual(o.tasks.size, 1);
    });

    it('should track task queue length', async () => {
        const o = new AgentOrchestrator();
        await o.submitTask('Task 1', 'ctx');
        await o.submitTask('Task 2', 'ctx');
        const status = o.getSwarmStatus();
        assert.ok(status.queueLength >= 0);
        assert.ok(status.running >= 0);
        assert.strictEqual(status.maxConcurrent, 3);
    });

    it('should respect concurrent task limit', () => {
        const o = new AgentOrchestrator();
        assert.strictEqual(o.canStartNewTask(), true);
        o.runningTasks.set('task-1', { id: 'task-1' });
        o.runningTasks.set('task-2', { id: 'task-2' });
        o.runningTasks.set('task-3', { id: 'task-3' });
        assert.strictEqual(o.canStartNewTask(), false);
    });

    it('should execute swarm tasks', async () => {
        const o = new AgentOrchestrator();
        const result = await o.swarmExecute(['Task A', 'Task B', 'Task C']);
        assert.strictEqual(result.totalTasks, 3);
        assert.strictEqual(result.completed, 3);
        assert.strictEqual(result.failed, 0);
        assert.ok(result.durationMs >= 0);
    });

    it('should aggregate mixed completed and failed swarm results', async () => {
        const o = new AgentOrchestrator();
        let idx = 0;
        const ids = ['t1', 't2'];
        const start = Date.now();

        o.submitTask = async () => ids[idx++];
        o.waitForTask = async (taskId) => {
            if (taskId === 't1') {
                return {
                    id: 't1',
                    agentId: 'researcher',
                    status: 'completed',
                    result: 'ok',
                    startedAt: start,
                    completedAt: start + 100
                };
            }

            return {
                id: 't2',
                agentId: 'implementer',
                status: 'failed',
                result: 'timeout',
                startedAt: start,
                completedAt: start + 300
            };
        };

        const result = await o.swarmExecute(['A', 'B']);
        assert.strictEqual(result.totalTasks, 2);
        assert.strictEqual(result.completed, 1);
        assert.strictEqual(result.failed, 1);
        assert.strictEqual(result.results[0].durationMs, 100);
        assert.strictEqual(result.results[1].durationMs, 300);
    });

    it('should mark rejected waitForTask outcomes as failed with unknown agent', async () => {
        const o = new AgentOrchestrator();

        o.submitTask = async () => 't1';
        o.waitForTask = async () => {
            throw new Error('CDP connection lost');
        };

        const result = await o.swarmExecute(['A']);
        assert.strictEqual(result.totalTasks, 1);
        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failed, 1);
        assert.strictEqual(result.results[0].agentId, 'unknown');
        assert.strictEqual(result.results[0].status, 'failed');
    });

    it('should handle empty swarm task list', async () => {
        const o = new AgentOrchestrator();
        const result = await o.swarmExecute([]);

        assert.strictEqual(result.totalTasks, 0);
        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failed, 0);
        assert.strictEqual(result.results.length, 0);
    });

    it('should generate unique task IDs', () => {
        const o = new AgentOrchestrator();
        const ids = new Set();
        for (let i = 0; i < 100; i++) ids.add(o.generateTaskId());
        assert.strictEqual(ids.size, 100);
    });
});
