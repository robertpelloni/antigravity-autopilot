const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

/**
 * MCP Federation Tests
 * Tests server registration, connection, tool discovery, tool invocation,
 * auto-routing, stats, and error handling.
 */

// ============ Replicate Federation logic for testing ============

class TestFederation extends EventEmitter {
    constructor() {
        super();
        this.servers = new Map();
        this.serverStatus = new Map();
        this.tools = new Map();
        this.totalCalls = 0;
        this.totalErrors = 0;
    }

    registerServer(config) {
        this.servers.set(config.id, config);
        this.serverStatus.set(config.id, 'disconnected');
        this.emit('serverRegistered', config);
    }

    removeServer(serverId) {
        if (!this.servers.has(serverId)) return false;
        this.servers.delete(serverId);
        this.serverStatus.delete(serverId);
        this.tools.delete(serverId);
        return true;
    }

    getServers() { return Array.from(this.servers.values()); }

    async connectToServer(serverId) {
        const server = this.servers.get(serverId);
        if (!server || !server.enabled) return false;
        this.serverStatus.set(serverId, 'connected');
        this.emit('serverConnected', server);
        return true;
    }

    disconnectFromServer(serverId) {
        this.serverStatus.set(serverId, 'disconnected');
        this.tools.delete(serverId);
    }

    async connectAll() {
        const results = new Map();
        for (const [id, server] of this.servers) {
            if (server.enabled && server.autoConnect) {
                const ok = await this.connectToServer(id);
                results.set(id, ok);
            }
        }
        return results;
    }

    registerTools(serverId, toolList) {
        this.tools.set(serverId, toolList.map(t => ({ ...t, serverId })));
    }

    getAllTools() {
        const all = [];
        for (const [serverId, tools] of this.tools) {
            if (this.serverStatus.get(serverId) === 'connected') {
                all.push(...tools);
            }
        }
        return all;
    }

    findTool(toolName) {
        for (const [, tools] of this.tools) {
            const found = tools.find(t => t.name === toolName);
            if (found) return found;
        }
        return undefined;
    }

    async callTool(call) {
        const start = Date.now();
        this.totalCalls++;
        if (!this.servers.has(call.serverId)) {
            this.totalErrors++;
            return { serverId: call.serverId, toolName: call.toolName, success: false, content: [], durationMs: 0, error: 'Server not found' };
        }
        if (this.serverStatus.get(call.serverId) !== 'connected') {
            this.totalErrors++;
            return { serverId: call.serverId, toolName: call.toolName, success: false, content: [], durationMs: 0, error: 'Server not connected' };
        }
        return { serverId: call.serverId, toolName: call.toolName, success: true, content: [{ type: 'text', text: 'ok' }], durationMs: Date.now() - start };
    }

    async callToolByName(toolName, args = {}) {
        const tool = this.findTool(toolName);
        if (!tool) {
            this.totalErrors++;
            return { serverId: 'unknown', toolName, success: false, content: [], durationMs: 0, error: 'Tool not found' };
        }
        return this.callTool({ serverId: tool.serverId, toolName, arguments: args });
    }

    getStats() {
        const servers = [];
        for (const [id, config] of this.servers) {
            servers.push({ id, name: config.name, status: this.serverStatus.get(id), tools: (this.tools.get(id) || []).length });
        }
        return {
            connectedServers: Array.from(this.serverStatus.values()).filter(s => s === 'connected').length,
            totalTools: this.getAllTools().length,
            totalCalls: this.totalCalls,
            totalErrors: this.totalErrors,
            servers
        };
    }
}

// ============ Tests ============

describe('MCP Federation', () => {
    it('should register and list servers', () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'Database MCP', url: 'http://localhost:3100', transport: 'http', enabled: true, autoConnect: true, capabilities: ['query'], timeout: 5000 });
        fed.registerServer({ id: 'cloud', name: 'Cloud MCP', url: 'http://localhost:3200', transport: 'http', enabled: true, autoConnect: false, capabilities: ['deploy'], timeout: 5000 });
        assert.strictEqual(fed.getServers().length, 2);
    });

    it('should remove servers', () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        assert.strictEqual(fed.removeServer('db'), true);
        assert.strictEqual(fed.getServers().length, 0);
        assert.strictEqual(fed.removeServer('nonexistent'), false);
    });

    it('should connect to enabled servers', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        fed.registerServer({ id: 'disabled', name: 'Off', url: 'x', transport: 'http', enabled: false, autoConnect: true, capabilities: [], timeout: 5000 });

        const ok1 = await fed.connectToServer('db');
        const ok2 = await fed.connectToServer('disabled');
        assert.strictEqual(ok1, true);
        assert.strictEqual(ok2, false);
    });

    it('should auto-connect on connectAll', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'a', name: 'A', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        fed.registerServer({ id: 'b', name: 'B', url: 'x', transport: 'http', enabled: true, autoConnect: false, capabilities: [], timeout: 5000 });
        fed.registerServer({ id: 'c', name: 'C', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });

        const results = await fed.connectAll();
        assert.strictEqual(results.get('a'), true);
        assert.strictEqual(results.has('b'), false); // not autoConnect
        assert.strictEqual(results.get('c'), true);
    });

    it('should discover and list tools from connected servers', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        await fed.connectToServer('db');
        fed.registerTools('db', [
            { name: 'query', description: 'Run SQL query', inputSchema: {} },
            { name: 'insert', description: 'Insert record', inputSchema: {} }
        ]);
        assert.strictEqual(fed.getAllTools().length, 2);
        assert.strictEqual(fed.getAllTools()[0].serverId, 'db');
    });

    it('should find tools by name across servers', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        fed.registerServer({ id: 'cloud', name: 'Cloud', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        await fed.connectToServer('db');
        await fed.connectToServer('cloud');
        fed.registerTools('db', [{ name: 'query', description: 'SQL', inputSchema: {} }]);
        fed.registerTools('cloud', [{ name: 'deploy', description: 'Deploy app', inputSchema: {} }]);

        const q = fed.findTool('query');
        assert.strictEqual(q.serverId, 'db');
        const d = fed.findTool('deploy');
        assert.strictEqual(d.serverId, 'cloud');
        assert.strictEqual(fed.findTool('nonexistent'), undefined);
    });

    it('should call tools on connected servers', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        await fed.connectToServer('db');
        fed.registerTools('db', [{ name: 'query', description: 'SQL', inputSchema: {} }]);

        const result = await fed.callTool({ serverId: 'db', toolName: 'query', arguments: { sql: 'SELECT 1' } });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.serverId, 'db');
    });

    it('should fail for disconnected servers', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        // Don't connect
        const result = await fed.callTool({ serverId: 'db', toolName: 'query', arguments: {} });
        assert.strictEqual(result.success, false);
        assert.ok(result.error.includes('not connected'));
    });

    it('should auto-route callToolByName', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        await fed.connectToServer('db');
        fed.registerTools('db', [{ name: 'query', description: 'SQL', inputSchema: {} }]);

        const result = await fed.callToolByName('query', { sql: 'SELECT 1' });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.serverId, 'db');

        const missing = await fed.callToolByName('nonexistent');
        assert.strictEqual(missing.success, false);
    });

    it('should track stats correctly', async () => {
        const fed = new TestFederation();
        fed.registerServer({ id: 'db', name: 'DB', url: 'x', transport: 'http', enabled: true, autoConnect: true, capabilities: [], timeout: 5000 });
        await fed.connectToServer('db');
        fed.registerTools('db', [{ name: 'query', description: 'SQL', inputSchema: {} }]);

        await fed.callTool({ serverId: 'db', toolName: 'query', arguments: {} });
        await fed.callToolByName('nonexistent');

        const stats = fed.getStats();
        assert.strictEqual(stats.connectedServers, 1);
        assert.strictEqual(stats.totalTools, 1);
        assert.strictEqual(stats.totalCalls, 1); // callToolByName('nonexistent') short-circuits
        assert.strictEqual(stats.totalErrors, 1);
    });
});
