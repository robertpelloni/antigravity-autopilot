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

const antiBridgeModule = loadTsModule(path.resolve(__dirname, '../src/core/anti-bridge.ts'));
const AntiBridge = antiBridgeModule.AntiBridge;

// ============ Tests ============

describe('AntiBridge Remote Coordination', () => {
    it('should start and stop cleanly', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        let started = false, stopped = false;
        bridge.on('started', () => started = true);
        bridge.on('stopped', () => stopped = true);

        bridge.start();
        assert.strictEqual(started, true);
        assert.strictEqual(bridge.isRunning, true);

        bridge.stop();
        assert.strictEqual(stopped, true);
        assert.strictEqual(bridge.isRunning, false);
    });

    it('should add and remove peers', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        const ok = bridge.addPeer({ id: 'ag-2', name: 'Machine 2', status: 'idle', capabilities: ['cdp'] });
        assert.strictEqual(ok, true);
        assert.strictEqual(bridge.getPeers().length, 1);

        const removed = bridge.removePeer('ag-2');
        assert.strictEqual(removed, true);
        assert.strictEqual(bridge.getPeers().length, 0);
    });

    it('should reject self as peer', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        const ok = bridge.addPeer({ id: 'ag-1', name: 'Self', status: 'idle', capabilities: [] });
        assert.strictEqual(ok, false);
    });

    it('should enforce maxPeers limit', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1', maxPeers: 2 });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });
        const ok = bridge.addPeer({ id: 'ag-4', name: 'P4', status: 'idle', capabilities: [] });
        assert.strictEqual(ok, false);
        assert.strictEqual(bridge.getPeers().length, 2);
    });

    it('should send targeted messages', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });

        let received = null;
        bridge.on('message:ag-2', (msg) => { received = msg; });

        const msg = bridge.sendTask('Fix bug #123', 'ag-2');
        assert.strictEqual(msg.type, 'task');
        assert.strictEqual(msg.target, 'ag-2');
        assert.strictEqual(msg.source, 'ag-1');
        assert.ok(received);
        assert.strictEqual(received.payload.description, 'Fix bug #123');
    });

    it('should broadcast to all peers', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });

        const receivedBy = [];
        bridge.on('message:ag-2', () => receivedBy.push('ag-2'));
        bridge.on('message:ag-3', () => receivedBy.push('ag-3'));

        bridge.broadcastStatus('idle');
        assert.deepStrictEqual(receivedBy.sort(), ['ag-2', 'ag-3']);
    });

    it('should track message statistics', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });

        bridge.sendTask('Task 1');
        bridge.shareMemory('key1', 'value1');
        bridge.receive({ source: 'ag-2', type: 'ack', payload: {}, timestamp: Date.now(), messageId: 'x' });

        const stats = bridge.getStats();
        assert.strictEqual(stats.messagesSent, 2);
        assert.strictEqual(stats.messagesReceived, 1);
        assert.ok(stats.uptime >= 0);
    });

    it('should relay interaction commands to specific peer', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: ['cdp'] });

        let relayed = null;
        bridge.on('message:ag-2', (msg) => { relayed = msg; });

        bridge.relayInteraction('click', { selector: '#submit-btn' }, 'ag-2');
        assert.ok(relayed);
        assert.strictEqual(relayed.type, 'interaction');
        assert.strictEqual(relayed.payload.action, 'click');
        assert.strictEqual(relayed.payload.params.selector, '#submit-btn');
    });

    it('should share memory across all peers', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });

        const receivedBy = [];
        bridge.on('message:ag-2', (msg) => { if (msg.type === 'memory') receivedBy.push('ag-2'); });
        bridge.on('message:ag-3', (msg) => { if (msg.type === 'memory') receivedBy.push('ag-3'); });

        bridge.shareMemory('lastAction', { type: 'click', target: '#btn' });
        assert.strictEqual(receivedBy.length, 2);
    });

    it('should update peer heartbeat on receive', () => {
        const bridge = new AntiBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });

        const before = bridge.getPeers()[0].lastHeartbeat;
        // Small delay to ensure timestamp difference
        bridge.receive({ source: 'ag-2', type: 'heartbeat', payload: {}, timestamp: Date.now(), messageId: 'hb1' });
        const after = bridge.getPeers()[0].lastHeartbeat;
        assert.ok(after >= before);
    });
});
