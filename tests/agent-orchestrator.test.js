const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * AgentOrchestrator Logic Tests
 * Tests agent selection, task complexity detection, queue management,
 * and swarm execution — without VS Code or CDP dependencies.
 */

// ============ Replicate types and logic ============

const TaskType = { REASONING: 'reasoning', FRONTEND: 'frontend', QUICK: 'quick', GENERAL: 'general' };

const DEFAULT_AGENTS = [
    { id: 'researcher', role: 'researcher', capabilities: ['search', 'analyze', 'summarize'], preferredModel: 'gemini-3-pro-high', maxConcurrentTasks: 2 },
    { id: 'implementer', role: 'implementer', capabilities: ['code', 'refactor', 'test'], preferredModel: 'claude-opus-4.5-thinking', maxConcurrentTasks: 1 },
    { id: 'reviewer', role: 'reviewer', capabilities: ['review', 'security', 'quality'], preferredModel: 'claude-sonnet-4.5', maxConcurrentTasks: 2 },
    { id: 'tester', role: 'tester', capabilities: ['test', 'coverage', 'regression'], preferredModel: 'gemini-3-flash', maxConcurrentTasks: 2 },
    { id: 'planner', role: 'planner', capabilities: ['plan', 'decompose', 'prioritize'], preferredModel: 'claude-opus-4.5-thinking', maxConcurrentTasks: 1 }
];

class TestOrchestrator {
    constructor() {
        this.agents = new Map();
        this.tasks = new Map();
        this.taskQueue = [];
        this.runningTasks = new Set();
        this.config = { maxConcurrentAgents: 3, taskTimeout: 300000, enableParallelExecution: true, autoDecomposeTasks: true };
        for (const agent of DEFAULT_AGENTS) this.agents.set(agent.id, agent);
    }

    selectAgentForTask(taskType) {
        const roleMap = { [TaskType.REASONING]: 'researcher', [TaskType.FRONTEND]: 'implementer', [TaskType.QUICK]: 'implementer', [TaskType.GENERAL]: 'implementer' };
        const targetRole = roleMap[taskType] || 'implementer';
        for (const [id, agent] of this.agents) { if (agent.role === targetRole) return id; }
        return 'implementer';
    }

    isComplexTask(description) {
        const complexIndicators = ['build', 'create', 'implement', 'design', 'architect', 'refactor', 'migrate', 'integrate', 'full', 'complete', 'entire', 'system', 'and then', 'after that', 'followed by'];
        const lower = description.toLowerCase();
        const matchCount = complexIndicators.filter(ind => lower.includes(ind)).length;
        return matchCount >= 2 || description.length > 200;
    }

    canStartNewTask() {
        return this.runningTasks.size < this.config.maxConcurrentAgents;
    }

    generateTaskId() {
        return `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    }

    async submitTask(description) {
        const taskId = this.generateTaskId();
        const task = { id: taskId, description, status: 'pending', createdAt: Date.now() };
        this.tasks.set(taskId, task);
        this.taskQueue.push(task);
        return taskId;
    }

    async swarmExecute(taskDescriptions) {
        const startTime = Date.now();
        const results = await Promise.allSettled(taskDescriptions.map(async (desc) => {
            const agentId = this.selectAgentForTask(TaskType.GENERAL);
            return { taskId: this.generateTaskId(), agentId, status: 'completed', result: `Done: ${desc}`, durationMs: Date.now() - startTime };
        }));

        const processed = results.map((r, i) => {
            if (r.status === 'fulfilled') return r.value;
            return { taskId: `failed-${i}`, agentId: 'unknown', status: 'failed', result: r.reason?.message || 'Unknown error', durationMs: 0 };
        });

        return { totalTasks: taskDescriptions.length, completed: processed.filter(r => r.status === 'completed').length, failed: processed.filter(r => r.status === 'failed').length, results: processed, durationMs: Date.now() - startTime };
    }

    getSwarmStatus() {
        return { queueLength: this.taskQueue.length, running: this.runningTasks.size, maxConcurrent: this.config.maxConcurrentAgents };
    }
}

// ============ Tests ============

describe('AgentOrchestrator', () => {
    it('should initialize with 5 default agents', () => {
        const o = new TestOrchestrator();
        assert.strictEqual(o.agents.size, 5);
        assert.ok(o.agents.has('researcher'));
        assert.ok(o.agents.has('implementer'));
        assert.ok(o.agents.has('reviewer'));
        assert.ok(o.agents.has('tester'));
        assert.ok(o.agents.has('planner'));
    });

    it('should select researcher for reasoning tasks', () => {
        const o = new TestOrchestrator();
        assert.strictEqual(o.selectAgentForTask(TaskType.REASONING), 'researcher');
    });

    it('should select implementer for frontend and quick tasks', () => {
        const o = new TestOrchestrator();
        assert.strictEqual(o.selectAgentForTask(TaskType.FRONTEND), 'implementer');
        assert.strictEqual(o.selectAgentForTask(TaskType.QUICK), 'implementer');
    });

    it('should detect complex tasks', () => {
        const o = new TestOrchestrator();
        assert.strictEqual(o.isComplexTask('Build and implement a full authentication system'), true);
        assert.strictEqual(o.isComplexTask('Fix typo'), false);
    });

    it('should detect long descriptions as complex', () => {
        const o = new TestOrchestrator();
        const longDesc = 'a'.repeat(201);
        assert.strictEqual(o.isComplexTask(longDesc), true);
    });

    it('should submit tasks and return task IDs', async () => {
        const o = new TestOrchestrator();
        const id = await o.submitTask('Test task');
        assert.ok(id.startsWith('task-'));
        assert.strictEqual(o.tasks.size, 1);
    });

    it('should track task queue length', async () => {
        const o = new TestOrchestrator();
        await o.submitTask('Task 1');
        await o.submitTask('Task 2');
        const status = o.getSwarmStatus();
        assert.strictEqual(status.queueLength, 2);
        assert.strictEqual(status.running, 0);
    });

    it('should respect concurrent task limit', () => {
        const o = new TestOrchestrator();
        assert.strictEqual(o.canStartNewTask(), true);
        o.runningTasks.add('task-1');
        o.runningTasks.add('task-2');
        o.runningTasks.add('task-3');
        assert.strictEqual(o.canStartNewTask(), false);
    });

    it('should execute swarm tasks', async () => {
        const o = new TestOrchestrator();
        const result = await o.swarmExecute(['Task A', 'Task B', 'Task C']);
        assert.strictEqual(result.totalTasks, 3);
        assert.strictEqual(result.completed, 3);
        assert.strictEqual(result.failed, 0);
        assert.ok(result.durationMs >= 0);
    });

    it('should generate unique task IDs', () => {
        const o = new TestOrchestrator();
        const ids = new Set();
        for (let i = 0; i < 100; i++) ids.add(o.generateTaskId());
        assert.strictEqual(ids.size, 100);
    });
});
