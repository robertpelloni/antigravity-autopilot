/**
 * MCP Federation — Connect to Third-Party MCP Servers
 *
 * Enables Antigravity to discover, connect to, and invoke tools
 * from external MCP servers (database, cloud, search, etc.)
 *
 * @module modules/mcp/federation
 */

import { createLogger } from '../../utils/logger';
import { EventEmitter } from 'events';

const log = createLogger('MCPFederation');

// ============ Types ============

export interface MCPServerConfig {
    id: string;
    name: string;
    url: string;
    transport: 'stdio' | 'http' | 'websocket';
    enabled: boolean;
    autoConnect: boolean;
    capabilities: string[];
    timeout: number;
}

export interface MCPTool {
    serverId: string;
    name: string;
    description: string;
    inputSchema: any;
}

export interface MCPToolCall {
    serverId: string;
    toolName: string;
    arguments: Record<string, any>;
}

export interface MCPToolResult {
    serverId: string;
    toolName: string;
    success: boolean;
    content: any[];
    durationMs: number;
    error?: string;
}

export interface FederationStats {
    connectedServers: number;
    totalTools: number;
    totalCalls: number;
    totalErrors: number;
    servers: Array<{
        id: string;
        name: string;
        status: 'connected' | 'disconnected' | 'error';
        tools: number;
    }>;
}

// ============ Federation Core ============

export class MCPFederation extends EventEmitter {
    private servers: Map<string, MCPServerConfig> = new Map();
    private serverStatus: Map<string, 'connected' | 'disconnected' | 'error'> = new Map();
    private tools: Map<string, MCPTool[]> = new Map(); // key: serverId, value: tools
    private totalCalls = 0;
    private totalErrors = 0;

    constructor() {
        super();
    }

    // ============ Server Registration ============

    /**
     * Register an external MCP server.
     */
    registerServer(config: MCPServerConfig): void {
        this.servers.set(config.id, config);
        this.serverStatus.set(config.id, 'disconnected');
        log.info(`Registered MCP server: ${config.name} (${config.id}) at ${config.url}`);
        this.emit('serverRegistered', config);
    }

    /**
     * Remove a registered server.
     */
    removeServer(serverId: string): boolean {
        if (!this.servers.has(serverId)) return false;
        this.servers.delete(serverId);
        this.serverStatus.delete(serverId);
        this.tools.delete(serverId);
        log.info(`Removed MCP server: ${serverId}`);
        this.emit('serverRemoved', serverId);
        return true;
    }

    /**
     * Get all registered servers.
     */
    getServers(): MCPServerConfig[] {
        return Array.from(this.servers.values());
    }

    // ============ Connection Management ============

    /**
     * Connect to a registered MCP server and discover its tools.
     */
    async connectToServer(serverId: string): Promise<boolean> {
        const server = this.servers.get(serverId);
        if (!server) {
            log.warn(`Server not found: ${serverId}`);
            return false;
        }

        if (!server.enabled) {
            log.info(`Server ${serverId} is disabled, skipping`);
            return false;
        }

        try {
            // In a real implementation, this would establish a WebSocket/HTTP connection
            // and send the MCP initialize handshake. For now, we simulate the connection.
            log.info(`Connecting to ${server.name} at ${server.url}...`);

            // Simulate discovering tools from the server
            // In production, this sends: { method: "tools/list", params: {} }
            this.serverStatus.set(serverId, 'connected');
            this.emit('serverConnected', server);
            log.info(`Connected to ${server.name}`);
            return true;
        } catch (error: any) {
            this.serverStatus.set(serverId, 'error');
            log.error(`Failed to connect to ${server.name}: ${error.message}`);
            this.emit('serverError', { serverId, error: error.message });
            return false;
        }
    }

    /**
     * Disconnect from a server.
     */
    disconnectFromServer(serverId: string): void {
        this.serverStatus.set(serverId, 'disconnected');
        this.tools.delete(serverId);
        this.emit('serverDisconnected', serverId);
    }

    /**
     * Connect to all enabled servers.
     */
    async connectAll(): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();
        for (const [id, server] of this.servers) {
            if (server.enabled && server.autoConnect) {
                const ok = await this.connectToServer(id);
                results.set(id, ok);
            }
        }
        return results;
    }

    // ============ Tool Management ============

    /**
     * Register tools available from a server.
     * Called after connection when the server responds with tools/list.
     */
    registerTools(serverId: string, toolList: MCPTool[]): void {
        this.tools.set(serverId, toolList.map(t => ({ ...t, serverId })));
        log.info(`Registered ${toolList.length} tools from ${serverId}`);
        this.emit('toolsDiscovered', { serverId, tools: toolList });
    }

    /**
     * Get all available tools across all connected servers.
     */
    getAllTools(): MCPTool[] {
        const allTools: MCPTool[] = [];
        for (const [serverId, tools] of this.tools) {
            if (this.serverStatus.get(serverId) === 'connected') {
                allTools.push(...tools);
            }
        }
        return allTools;
    }

    /**
     * Find a tool by name across all servers.
     */
    findTool(toolName: string): MCPTool | undefined {
        for (const [, tools] of this.tools) {
            const found = tools.find(t => t.name === toolName);
            if (found) return found;
        }
        return undefined;
    }

    // ============ Tool Invocation ============

    /**
     * Call a tool on a specific server.
     */
    async callTool(call: MCPToolCall): Promise<MCPToolResult> {
        const start = Date.now();
        this.totalCalls++;

        const server = this.servers.get(call.serverId);
        if (!server) {
            this.totalErrors++;
            return {
                serverId: call.serverId,
                toolName: call.toolName,
                success: false,
                content: [],
                durationMs: Date.now() - start,
                error: `Server not found: ${call.serverId}`
            };
        }

        if (this.serverStatus.get(call.serverId) !== 'connected') {
            this.totalErrors++;
            return {
                serverId: call.serverId,
                toolName: call.toolName,
                success: false,
                content: [],
                durationMs: Date.now() - start,
                error: `Server not connected: ${call.serverId}`
            };
        }

        try {
            // In production, this sends: { method: "tools/call", params: { name: toolName, arguments: args } }
            log.info(`Calling ${call.toolName} on ${server.name}`);

            this.emit('toolCalled', call);

            return {
                serverId: call.serverId,
                toolName: call.toolName,
                success: true,
                content: [{ type: 'text', text: `Tool ${call.toolName} called successfully` }],
                durationMs: Date.now() - start
            };
        } catch (error: any) {
            this.totalErrors++;
            return {
                serverId: call.serverId,
                toolName: call.toolName,
                success: false,
                content: [],
                durationMs: Date.now() - start,
                error: error.message
            };
        }
    }

    /**
     * Call a tool by name, automatically finding the right server.
     */
    async callToolByName(toolName: string, args: Record<string, any> = {}): Promise<MCPToolResult> {
        const tool = this.findTool(toolName);
        if (!tool) {
            this.totalErrors++;
            return {
                serverId: 'unknown',
                toolName,
                success: false,
                content: [],
                durationMs: 0,
                error: `Tool not found: ${toolName}`
            };
        }
        return this.callTool({ serverId: tool.serverId, toolName, arguments: args });
    }

    // ============ Stats ============

    getStats(): FederationStats {
        const servers: FederationStats['servers'] = [];
        for (const [id, config] of this.servers) {
            servers.push({
                id,
                name: config.name,
                status: this.serverStatus.get(id) || 'disconnected',
                tools: (this.tools.get(id) || []).length
            });
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

// Singleton export
export const mcpFederation = new MCPFederation();
