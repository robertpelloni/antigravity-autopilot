const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * MCP Server Request Handler Tests
 * Tests JSON-RPC request routing and response formatting
 * without requiring VS Code or actual server dependencies.
 */

// Simulate the ProjectTracker for testing
class MockProjectTracker {
    constructor() {
        this.tasks = ['Implement auth module', 'Write API tests'];
        this.completed = [];
    }
    getNextTask() {
        return this.tasks.find(t => !this.completed.includes(t)) || null;
    }
    completeTask(desc) {
        if (this.tasks.includes(desc)) {
            this.completed.push(desc);
            return true;
        }
        return false;
    }
}

// Replicate handleRequest logic
async function handleRequest(request, tracker) {
    try {
        if (request.method === 'tools/call') {
            const { name, arguments: args } = request.params;

            if (name === 'get_next_task') {
                const task = tracker.getNextTask();
                return {
                    jsonrpc: '2.0',
                    result: { content: [{ type: 'text', text: task || 'No tasks pending' }] },
                    id: request.id
                };
            }

            if (name === 'complete_task') {
                const success = tracker.completeTask(args.task_description);
                return {
                    jsonrpc: '2.0',
                    result: { content: [{ type: 'text', text: success ? 'Task marked as complete' : 'Task not found' }] },
                    id: request.id
                };
            }
        }

        return { jsonrpc: '2.0', result: 'ok', id: request.id };
    } catch (error) {
        return { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: request.id };
    }
}

describe('MCP Server Request Handler', () => {
    it('should return next task via get_next_task tool', async () => {
        const tracker = new MockProjectTracker();
        const response = await handleRequest({
            method: 'tools/call',
            params: { name: 'get_next_task', arguments: {} },
            id: 1
        }, tracker);

        assert.strictEqual(response.jsonrpc, '2.0');
        assert.strictEqual(response.id, 1);
        assert.strictEqual(response.result.content[0].text, 'Implement auth module');
    });

    it('should complete a task via complete_task tool', async () => {
        const tracker = new MockProjectTracker();
        const response = await handleRequest({
            method: 'tools/call',
            params: { name: 'complete_task', arguments: { task_description: 'Implement auth module' } },
            id: 2
        }, tracker);

        assert.strictEqual(response.result.content[0].text, 'Task marked as complete');
        // Next task should now be the second one
        assert.strictEqual(tracker.getNextTask(), 'Write API tests');
    });

    it('should return "Task not found" for unknown task', async () => {
        const tracker = new MockProjectTracker();
        const response = await handleRequest({
            method: 'tools/call',
            params: { name: 'complete_task', arguments: { task_description: 'Nonexistent task' } },
            id: 3
        }, tracker);

        assert.strictEqual(response.result.content[0].text, 'Task not found');
    });

    it('should return "No tasks pending" when all done', async () => {
        const tracker = new MockProjectTracker();
        tracker.completed = ['Implement auth module', 'Write API tests'];
        const response = await handleRequest({
            method: 'tools/call',
            params: { name: 'get_next_task', arguments: {} },
            id: 4
        }, tracker);

        assert.strictEqual(response.result.content[0].text, 'No tasks pending');
    });

    it('should handle unknown methods gracefully', async () => {
        const tracker = new MockProjectTracker();
        const response = await handleRequest({
            method: 'unknown/method',
            params: {},
            id: 5
        }, tracker);

        assert.strictEqual(response.result, 'ok');
        assert.strictEqual(response.id, 5);
    });
});
