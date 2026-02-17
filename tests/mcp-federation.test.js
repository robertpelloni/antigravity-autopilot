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

function createServer(id, overrides = {}) {
    return {
        id,
        name: id.toUpperCase(),
        url: `http://localhost/${id}`,
        transport: 'http',
        enabled: true,
        autoConnect: true,
        capabilities: [],
        timeout: 5000,
        ...overrides
    };
}

const federationModule = loadTsModule(path.resolve(__dirname, '../src/modules/mcp/federation.ts'));
const MCPFederation = federationModule.MCPFederation;

describe('MCPFederation (real module)', () => {
    it('should register, list, and remove servers', () => {
        const fed = new MCPFederation();
        fed.registerServer(createServer('db'));
        fed.registerServer(createServer('cloud'));
        assert.strictEqual(fed.getServers().length, 2);

        assert.strictEqual(fed.removeServer('db'), true);
        assert.strictEqual(fed.getServers().length, 1);
        assert.strictEqual(fed.removeServer('missing'), false);
    });

    it('should connect to enabled servers and skip disabled servers', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async () => ({ result: { tools: [] } });

        fed.registerServer(createServer('db', { enabled: true }));
        fed.registerServer(createServer('disabled', { enabled: false }));

        const okEnabled = await fed.connectToServer('db');
        const okDisabled = await fed.connectToServer('disabled');

        assert.strictEqual(okEnabled, true);
        assert.strictEqual(okDisabled, false);
    });

    it('should auto-connect only enabled autoConnect servers in connectAll', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async () => ({ result: { tools: [] } });

        fed.registerServer(createServer('a', { autoConnect: true }));
        fed.registerServer(createServer('b', { autoConnect: false }));
        fed.registerServer(createServer('c', { autoConnect: true }));

        const results = await fed.connectAll();

        assert.strictEqual(results.get('a'), true);
        assert.strictEqual(results.has('b'), false);
        assert.strictEqual(results.get('c'), true);
    });

    it('should discover and list tools from connected servers', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async (_server, payload) => {
            if (payload.method === 'tools/list') {
                return {
                    result: {
                        tools: [
                            { name: 'query', description: 'Run query', inputSchema: {} },
                            { name: 'insert', description: 'Insert record', inputSchema: {} }
                        ]
                    }
                };
            }
            return { result: {} };
        };

        fed.registerServer(createServer('db'));
        await fed.connectToServer('db');

        const tools = fed.getAllTools();
        assert.strictEqual(tools.length, 2);
        assert.strictEqual(tools[0].serverId, 'db');
    });

    it('should find tools by name across servers', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async (server, payload) => {
            if (payload.method !== 'tools/list') {
                return { result: {} };
            }

            if (server.id === 'db') {
                return { result: { tools: [{ name: 'query', description: 'SQL', inputSchema: {} }] } };
            }

            return { result: { tools: [{ name: 'deploy', description: 'Deploy app', inputSchema: {} }] } };
        };

        fed.registerServer(createServer('db'));
        fed.registerServer(createServer('cloud'));
        await fed.connectToServer('db');
        await fed.connectToServer('cloud');

        const query = fed.findTool('query');
        const deploy = fed.findTool('deploy');
        const missing = fed.findTool('missing');

        assert.strictEqual(query.serverId, 'db');
        assert.strictEqual(deploy.serverId, 'cloud');
        assert.strictEqual(missing, undefined);
    });

    it('should call tools successfully on connected servers', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async (_server, payload) => {
            if (payload.method === 'tools/list') {
                return { result: { tools: [{ name: 'query', description: 'SQL', inputSchema: {} }] } };
            }

            if (payload.method === 'tools/call') {
                return { result: { content: [{ type: 'text', text: 'ok' }] } };
            }

            return { result: {} };
        };

        fed.registerServer(createServer('db'));
        await fed.connectToServer('db');

        const result = await fed.callTool({ serverId: 'db', toolName: 'query', arguments: { sql: 'SELECT 1' } });
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.serverId, 'db');
        assert.strictEqual(result.content[0].text, 'ok');
    });

    it('should fail for disconnected or unknown servers', async () => {
        const fed = new MCPFederation();
        fed.registerServer(createServer('db'));

        const disconnected = await fed.callTool({ serverId: 'db', toolName: 'query', arguments: {} });
        assert.strictEqual(disconnected.success, false);
        assert.ok(disconnected.error.includes('not connected'));

        const unknown = await fed.callTool({ serverId: 'missing', toolName: 'query', arguments: {} });
        assert.strictEqual(unknown.success, false);
        assert.ok(unknown.error.includes('not found'));
    });

    it('should auto-route callToolByName and report missing tools', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async (_server, payload) => {
            if (payload.method === 'tools/list') {
                return { result: { tools: [{ name: 'query', description: 'SQL', inputSchema: {} }] } };
            }

            if (payload.method === 'tools/call') {
                return { result: { content: [{ type: 'text', text: 'ok' }] } };
            }

            return { result: {} };
        };

        fed.registerServer(createServer('db'));
        await fed.connectToServer('db');

        const routed = await fed.callToolByName('query', { sql: 'SELECT 1' });
        assert.strictEqual(routed.success, true);
        assert.strictEqual(routed.serverId, 'db');

        const missing = await fed.callToolByName('not-there');
        assert.strictEqual(missing.success, false);
        assert.strictEqual(missing.serverId, 'unknown');
    });

    it('should track stats for calls, errors, tools, and connected servers', async () => {
        const fed = new MCPFederation();
        fed.sendHttpRpc = async (_server, payload) => {
            if (payload.method === 'tools/list') {
                return { result: { tools: [{ name: 'query', description: 'SQL', inputSchema: {} }] } };
            }

            if (payload.method === 'tools/call') {
                return { result: { content: [{ type: 'text', text: 'ok' }] } };
            }

            return { result: {} };
        };

        fed.registerServer(createServer('db'));
        await fed.connectToServer('db');
        await fed.callTool({ serverId: 'db', toolName: 'query', arguments: {} });
        await fed.callToolByName('not-found');

        const stats = fed.getStats();
        assert.strictEqual(stats.connectedServers, 1);
        assert.strictEqual(stats.totalTools, 1);
        assert.strictEqual(stats.totalCalls, 1);
        assert.strictEqual(stats.totalErrors, 1);
    });
});
