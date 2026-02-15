/**
 * AntiBridge — Remote Bridge for Multi-Machine Coordination
 *
 * A lightweight WebSocket-based bridge that allows multiple Antigravity
 * instances to connect, share tasks, relay interaction commands, and
 * synchronize memory across machines.
 *
 * @module core/anti-bridge
 */

import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const log = createLogger('AntiBridge');

// ============ Types ============

export interface BridgeMessage {
    type: 'task' | 'memory' | 'interaction' | 'status' | 'heartbeat' | 'ack';
    source: string;          // Instance ID
    target?: string;         // Target instance ID (broadcast if omitted)
    payload: any;
    timestamp: number;
    messageId: string;
}

export interface BridgePeer {
    id: string;
    name: string;
    connectedAt: number;
    lastHeartbeat: number;
    status: 'connected' | 'busy' | 'idle' | 'disconnected';
    capabilities: string[];  // What this peer can do (e.g., 'cdp', 'voice', 'code')
}

export interface BridgeConfig {
    instanceId: string;
    instanceName: string;
    port: number;
    heartbeatIntervalMs: number;
    reconnectIntervalMs: number;
    maxPeers: number;
}

export interface BridgeStats {
    instanceId: string;
    isServer: boolean;
    peers: BridgePeer[];
    messagesSent: number;
    messagesReceived: number;
    uptime: number;
}

// ============ Bridge Core ============

export class AntiBridge extends EventEmitter {
    private config: BridgeConfig;
    private peers: Map<string, BridgePeer> = new Map();
    private messageQueue: BridgeMessage[] = [];
    private messagesSent = 0;
    private messagesReceived = 0;
    private startTime = Date.now();
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor(bridgeConfig?: Partial<BridgeConfig>) {
        super();
        this.config = {
            instanceId: `ag_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            instanceName: 'Antigravity Instance',
            port: 9100,
            heartbeatIntervalMs: 10000,
            reconnectIntervalMs: 5000,
            maxPeers: 10,
            ...bridgeConfig
        };
    }

    // ============ Lifecycle ============

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startTime = Date.now();

        // Start heartbeat
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
            this.pruneDisconnectedPeers();
        }, this.config.heartbeatIntervalMs);

        log.info(`AntiBridge started: ${this.config.instanceId} on port ${this.config.port}`);
        this.emit('started', { instanceId: this.config.instanceId });
    }

    stop(): void {
        this.isRunning = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        this.peers.clear();
        log.info('AntiBridge stopped');
        this.emit('stopped');
    }

    // ============ Peer Management ============

    addPeer(peer: BridgePeer): boolean {
        if (this.peers.size >= this.config.maxPeers) {
            log.warn(`Max peers reached (${this.config.maxPeers})`);
            return false;
        }
        if (peer.id === this.config.instanceId) {
            return false; // Don't add self
        }
        this.peers.set(peer.id, { ...peer, connectedAt: Date.now(), lastHeartbeat: Date.now() });
        this.emit('peerConnected', peer);
        log.info(`Peer connected: ${peer.name} (${peer.id})`);
        return true;
    }

    removePeer(peerId: string): boolean {
        const peer = this.peers.get(peerId);
        if (peer) {
            this.peers.delete(peerId);
            this.emit('peerDisconnected', peer);
            log.info(`Peer disconnected: ${peer.name} (${peerId})`);
            return true;
        }
        return false;
    }

    getPeer(peerId: string): BridgePeer | undefined {
        return this.peers.get(peerId);
    }

    getPeers(): BridgePeer[] {
        return Array.from(this.peers.values());
    }

    // ============ Messaging ============

    /**
     * Send a message to a specific peer or broadcast to all.
     */
    send(message: Omit<BridgeMessage, 'source' | 'timestamp' | 'messageId'>): BridgeMessage {
        const fullMessage: BridgeMessage = {
            ...message,
            source: this.config.instanceId,
            timestamp: Date.now(),
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`
        };

        this.messageQueue.push(fullMessage);
        this.messagesSent++;
        this.emit('messageSent', fullMessage);

        // If targeted, deliver only to that peer. Otherwise broadcast.
        if (fullMessage.target) {
            this.emit(`message:${fullMessage.target}`, fullMessage);
        } else {
            for (const [peerId] of this.peers) {
                this.emit(`message:${peerId}`, fullMessage);
            }
        }

        return fullMessage;
    }

    /**
     * Handle an incoming message from a peer.
     */
    receive(message: BridgeMessage): void {
        this.messagesReceived++;

        // Update peer heartbeat
        const peer = this.peers.get(message.source);
        if (peer) {
            peer.lastHeartbeat = Date.now();
        }

        this.emit('messageReceived', message);

        switch (message.type) {
            case 'task':
                this.emit('taskReceived', message.payload);
                break;
            case 'memory':
                this.emit('memorySync', message.payload);
                break;
            case 'interaction':
                this.emit('interactionRelay', message.payload);
                break;
            case 'status':
                this.emit('statusUpdate', { peerId: message.source, ...message.payload });
                break;
            case 'heartbeat':
                // Already handled above
                break;
            case 'ack':
                this.emit('ack', message);
                break;
        }
    }

    // ============ Convenience Methods ============

    /**
     * Send a task to a specific peer or broadcast.
     */
    sendTask(taskDescription: string, target?: string): BridgeMessage {
        return this.send({
            type: 'task',
            target,
            payload: { description: taskDescription, assignedAt: Date.now() }
        });
    }

    /**
     * Share a memory entry with all peers.
     */
    shareMemory(key: string, value: any): BridgeMessage {
        return this.send({
            type: 'memory',
            payload: { key, value, sharedAt: Date.now() }
        });
    }

    /**
     * Relay an interaction command to a specific peer.
     */
    relayInteraction(action: string, params: any, target: string): BridgeMessage {
        return this.send({
            type: 'interaction',
            target,
            payload: { action, params }
        });
    }

    /**
     * Broadcast current status to all peers.
     */
    broadcastStatus(status: string, details?: any): BridgeMessage {
        return this.send({
            type: 'status',
            payload: { status, details }
        });
    }

    // ============ Internals ============

    private sendHeartbeat(): void {
        if (!this.isRunning) return;
        this.send({
            type: 'heartbeat',
            payload: {
                status: 'alive',
                peers: this.peers.size,
                uptime: Date.now() - this.startTime
            }
        });
    }

    private pruneDisconnectedPeers(): void {
        const timeout = this.config.heartbeatIntervalMs * 3;
        const now = Date.now();

        for (const [peerId, peer] of this.peers) {
            if (now - peer.lastHeartbeat > timeout) {
                peer.status = 'disconnected';
                this.removePeer(peerId);
            }
        }
    }

    // ============ Stats ============

    getStats(): BridgeStats {
        return {
            instanceId: this.config.instanceId,
            isServer: true,
            peers: this.getPeers(),
            messagesSent: this.messagesSent,
            messagesReceived: this.messagesReceived,
            uptime: Date.now() - this.startTime
        };
    }

    getConfig(): BridgeConfig {
        return { ...this.config };
    }
}

// Singleton export
export const antiBridge = new AntiBridge();
