const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Swarm Mode Logic Tests
 * Tests the concurrent task execution and result aggregation logic
 * without requiring VS Code or CDP dependencies.
 */

// Simulate the result aggregation logic from swarmExecute
function aggregateSwarmResults(settled, taskIds, swarmStart) {
    const results = settled.map((outcome, idx) => {
        const task = outcome.status === 'fulfilled' ? outcome.value : null;
        return {
            taskId: taskIds[idx],
            agentId: task?.agentId || 'unknown',
            status: task?.status || 'failed',
            result: task?.result,
            durationMs: task ? (task.completedAt || Date.now()) - (task.startedAt || swarmStart) : 0
        };
    });

    return {
        totalTasks: taskIds.length,
        completed: results.filter(r => r.status === 'completed').length,
        failed: results.filter(r => r.status === 'failed').length,
        results,
        durationMs: Date.now() - swarmStart
    };
}

describe('Swarm Mode Logic', () => {
    it('should aggregate all-success results correctly', () => {
        const now = Date.now();
        const taskIds = ['t1', 't2', 't3'];
        const settled = [
            { status: 'fulfilled', value: { agentId: 'researcher', status: 'completed', result: 'OK', startedAt: now, completedAt: now + 100 } },
            { status: 'fulfilled', value: { agentId: 'implementer', status: 'completed', result: 'Done', startedAt: now, completedAt: now + 200 } },
            { status: 'fulfilled', value: { agentId: 'tester', status: 'completed', result: 'Pass', startedAt: now, completedAt: now + 50 } }
        ];

        const result = aggregateSwarmResults(settled, taskIds, now);
        assert.strictEqual(result.totalTasks, 3);
        assert.strictEqual(result.completed, 3);
        assert.strictEqual(result.failed, 0);
        assert.strictEqual(result.results[0].durationMs, 100);
        assert.strictEqual(result.results[1].durationMs, 200);
    });

    it('should handle mixed success/failure results', () => {
        const now = Date.now();
        const taskIds = ['t1', 't2'];
        const settled = [
            { status: 'fulfilled', value: { agentId: 'researcher', status: 'completed', result: 'OK', startedAt: now, completedAt: now + 100 } },
            { status: 'fulfilled', value: { agentId: 'implementer', status: 'failed', result: 'Timeout', startedAt: now, completedAt: now + 5000 } }
        ];

        const result = aggregateSwarmResults(settled, taskIds, now);
        assert.strictEqual(result.totalTasks, 2);
        assert.strictEqual(result.completed, 1);
        assert.strictEqual(result.failed, 1);
    });

    it('should handle rejected promises gracefully', () => {
        const now = Date.now();
        const taskIds = ['t1'];
        const settled = [
            { status: 'rejected', reason: new Error('CDP connection lost') }
        ];

        const result = aggregateSwarmResults(settled, taskIds, now);
        assert.strictEqual(result.totalTasks, 1);
        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failed, 1);
        assert.strictEqual(result.results[0].agentId, 'unknown');
    });

    it('should handle empty task list', () => {
        const now = Date.now();
        const result = aggregateSwarmResults([], [], now);
        assert.strictEqual(result.totalTasks, 0);
        assert.strictEqual(result.completed, 0);
        assert.strictEqual(result.failed, 0);
    });

    it('should calculate positive duration', () => {
        const now = Date.now() - 500; // started 500ms ago
        const result = aggregateSwarmResults([], [], now);
        assert.ok(result.durationMs >= 400, `Expected duration >= 400ms, got ${result.durationMs}ms`);
    });
});
