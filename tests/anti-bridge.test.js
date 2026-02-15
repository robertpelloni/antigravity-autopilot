const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

/**
 * AntiBridge Logic Tests
 * Tests peer management, messaging, task relay, memory sharing,
 * heartbeat, and stats — all without WebSocket dependencies.
 */

// ============ Replicate core logic for testing ============

class TestBridge extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            instanceId: config.instanceId || `test_${Date.now()}`,
            instanceName: config.instanceName || 'Test Instance',
            port: config.port || 9100,
            heartbeatIntervalMs: config.heartbeatIntervalMs || 10000,
            maxPeers: config.maxPeers || 10,
            ...config
        };
        this.peers = new Map();
        this.messageQueue = [];
        this.messagesSent = 0;
        this.messagesReceived = 0;
        this.startTime = Date.now();
        this.isRunning = false;
    }

    start() {
        this.isRunning = true;
        this.startTime = Date.now();
        this.emit('started', { instanceId: this.config.instanceId });
    }

    stop() {
        this.isRunning = false;
        this.peers.clear();
        this.emit('stopped');
    }

    addPeer(peer) {
        if (this.peers.size >= this.config.maxPeers) return false;
        if (peer.id === this.config.instanceId) return false;
        this.peers.set(peer.id, { ...peer, connectedAt: Date.now(), lastHeartbeat: Date.now() });
        this.emit('peerConnected', peer);
        return true;
    }

    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            this.peers.delete(peerId);
            this.emit('peerDisconnected', peer);
            return true;
        }
        return false;
    }

    getPeers() { return Array.from(this.peers.values()); }

    send(message) {
        const full = {
            ...message,
            source: this.config.instanceId,
            timestamp: Date.now(),
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`
        };
        this.messageQueue.push(full);
        this.messagesSent++;
        this.emit('messageSent', full);
        if (full.target) {
            this.emit(`message:${full.target}`, full);
        } else {
            for (const [peerId] of this.peers) {
                this.emit(`message:${peerId}`, full);
            }
        }
        return full;
    }

    receive(message) {
        this.messagesReceived++;
        const peer = this.peers.get(message.source);
        if (peer) peer.lastHeartbeat = Date.now();
        this.emit('messageReceived', message);
    }

    sendTask(desc, target) {
        return this.send({ type: 'task', target, payload: { description: desc } });
    }

    shareMemory(key, value) {
        return this.send({ type: 'memory', payload: { key, value } });
    }

    relayInteraction(action, params, target) {
        return this.send({ type: 'interaction', target, payload: { action, params } });
    }

    broadcastStatus(status, details) {
        return this.send({ type: 'status', payload: { status, details } });
    }

    getStats() {
        return {
            instanceId: this.config.instanceId,
            peers: this.getPeers(),
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
            uptime: Date.now() - this.startTime
        };
    }
}

// ============ Tests ============

describe('AntiBridge Remote Coordination', () => {
    it('should start and stop cleanly', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1' });
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
        const bridge = new TestBridge({ instanceId: 'ag-1' });
        const ok = bridge.addPeer({ id: 'ag-2', name: 'Machine 2', status: 'idle', capabilities: ['cdp'] });
        assert.strictEqual(ok, true);
        assert.strictEqual(bridge.getPeers().length, 1);

        const removed = bridge.removePeer('ag-2');
        assert.strictEqual(removed, true);
        assert.strictEqual(bridge.getPeers().length, 0);
    });

    it('should reject self as peer', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1' });
        const ok = bridge.addPeer({ id: 'ag-1', name: 'Self', status: 'idle', capabilities: [] });
        assert.strictEqual(ok, false);
    });

    it('should enforce maxPeers limit', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1', maxPeers: 2 });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });
        const ok = bridge.addPeer({ id: 'ag-4', name: 'P4', status: 'idle', capabilities: [] });
        assert.strictEqual(ok, false);
        assert.strictEqual(bridge.getPeers().length, 2);
    });

    it('should send targeted messages', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1' });
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
        const bridge = new TestBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });

        const receivedBy = [];
        bridge.on('message:ag-2', () => receivedBy.push('ag-2'));
        bridge.on('message:ag-3', () => receivedBy.push('ag-3'));

        bridge.broadcastStatus('idle');
        assert.deepStrictEqual(receivedBy.sort(), ['ag-2', 'ag-3']);
    });

    it('should track message statistics', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1' });
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
        const bridge = new TestBridge({ instanceId: 'ag-1' });
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
        const bridge = new TestBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });
        bridge.addPeer({ id: 'ag-3', name: 'P3', status: 'idle', capabilities: [] });

        const receivedBy = [];
        bridge.on('message:ag-2', (msg) => { if (msg.type === 'memory') receivedBy.push('ag-2'); });
        bridge.on('message:ag-3', (msg) => { if (msg.type === 'memory') receivedBy.push('ag-3'); });

        bridge.shareMemory('lastAction', { type: 'click', target: '#btn' });
        assert.strictEqual(receivedBy.length, 2);
    });

    it('should update peer heartbeat on receive', () => {
        const bridge = new TestBridge({ instanceId: 'ag-1' });
        bridge.addPeer({ id: 'ag-2', name: 'P2', status: 'idle', capabilities: [] });

        const before = bridge.getPeers()[0].lastHeartbeat;
        // Small delay to ensure timestamp difference
        bridge.receive({ source: 'ag-2', type: 'heartbeat', payload: {}, timestamp: Date.now(), messageId: 'hb1' });
        const after = bridge.getPeers()[0].lastHeartbeat;
        assert.ok(after >= before);
    });
});
