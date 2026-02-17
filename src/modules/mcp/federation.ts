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
import WebSocket from 'ws';

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
    headers?: Record<string, string>;
    auth?: {
        type: 'bearer' | 'basic' | 'token' | 'api-key';
        token: string;
        headerName?: string;
    };
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
    private wsConnections: Map<string, WebSocket> = new Map();
    private requestSeq = 1;
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
            log.info(`Connecting to ${server.name} at ${server.url}...`);

            if (server.transport === 'http') {
                const listResult = await this.sendHttpRpc(server, {
                    jsonrpc: '2.0',
                    id: this.nextRequestId(),
                    method: 'tools/list',
                    params: {}
                });
                const discovered = this.normalizeTools(serverId, listResult?.result?.tools);
                this.registerTools(serverId, discovered);
            } else if (server.transport === 'websocket') {
                await this.connectWebSocket(server);
                const listResult = await this.sendWebSocketRpc(serverId, {
                    jsonrpc: '2.0',
                    id: this.nextRequestId(),
                    method: 'tools/list',
                    params: {}
                }, server.timeout);
                const discovered = this.normalizeTools(serverId, listResult?.result?.tools);
                this.registerTools(serverId, discovered);
            } else {
                throw new Error('stdio transport is not supported by this in-process federation runtime');
            }

            this.serverStatus.set(serverId, 'connected');
            this.emit('serverConnected', server);
            log.info(`Connected to ${server.name} (${this.tools.get(serverId)?.length || 0} tools)`);
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
        const ws = this.wsConnections.get(serverId);
        if (ws) {
            try {
                ws.close();
            } catch {
                // ignore close errors
            }
            this.wsConnections.delete(serverId);
        }
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
            log.info(`Calling ${call.toolName} on ${server.name}`);

            this.emit('toolCalled', call);

            const rpcPayload = {
                jsonrpc: '2.0',
                id: this.nextRequestId(),
                method: 'tools/call',
                params: {
                    name: call.toolName,
                    arguments: call.arguments || {}
                }
            };

            const response = server.transport === 'http'
                ? await this.sendHttpRpc(server, rpcPayload)
                : await this.sendWebSocketRpc(call.serverId, rpcPayload, server.timeout);

            if (response?.error) {
                this.totalErrors++;
                return {
                    serverId: call.serverId,
                    toolName: call.toolName,
                    success: false,
                    content: [],
                    durationMs: Date.now() - start,
                    error: response.error.message || 'Tool call failed'
                };
            }

            return {
                serverId: call.serverId,
                toolName: call.toolName,
                success: true,
                content: Array.isArray(response?.result?.content)
                    ? response.result.content
                    : [{ type: 'text', text: JSON.stringify(response?.result ?? null) }],
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

    private nextRequestId(): number {
        const id = this.requestSeq;
        this.requestSeq += 1;
        return id;
    }

    private normalizeTools(serverId: string, toolList: any): MCPTool[] {
        if (!Array.isArray(toolList)) {
            return [];
        }

        return toolList
            .map((tool: any) => ({
                serverId,
                name: String(tool?.name || ''),
                description: String(tool?.description || ''),
                inputSchema: tool?.inputSchema || {}
            }))
            .filter((tool: MCPTool) => tool.name.length > 0);
    }

    private buildServerHeaders(server: MCPServerConfig): Record<string, string> {
        const headers: Record<string, string> = {
            ...(server.headers || {})
        };

        if (server.auth?.token) {
            const authType = server.auth.type;
            if (authType === 'bearer') {
                headers.Authorization = `Bearer ${server.auth.token}`;
            } else if (authType === 'basic') {
                headers.Authorization = `Basic ${server.auth.token}`;
            } else if (authType === 'token') {
                headers.Authorization = `token ${server.auth.token}`;
            } else {
                headers[server.auth.headerName || 'X-API-Key'] = server.auth.token;
            }
        }

        return headers;
    }

    private async sendHttpRpc(server: MCPServerConfig, payload: any): Promise<any> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), Math.max(1000, server.timeout || 10000));
        const serverHeaders = this.buildServerHeaders(server);

        try {
            const response = await fetch(server.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...serverHeaders
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    private async connectWebSocket(server: MCPServerConfig): Promise<void> {
        if (this.wsConnections.has(server.id)) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(server.url, {
                headers: this.buildServerHeaders(server)
            });
            const timeout = setTimeout(() => {
                try {
                    ws.terminate();
                } catch {
                    // ignore
                }
                reject(new Error('WebSocket connection timeout'));
            }, Math.max(1000, server.timeout || 10000));

            ws.once('open', () => {
                clearTimeout(timeout);
                this.wsConnections.set(server.id, ws);

                ws.on('close', () => {
                    this.wsConnections.delete(server.id);
                    this.serverStatus.set(server.id, 'disconnected');
                });

                ws.on('error', (err) => {
                    log.warn(`WebSocket error for ${server.id}: ${String((err as Error).message || err)}`);
                });

                resolve();
            });

            ws.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });
    }

    private async sendWebSocketRpc(serverId: string, payload: any, timeoutMs: number): Promise<any> {
        const ws = this.wsConnections.get(serverId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            throw new Error(`WebSocket not connected for server ${serverId}`);
        }

        return new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('WebSocket RPC timeout'));
            }, Math.max(1000, timeoutMs || 10000));

            const onMessage = (raw: WebSocket.RawData) => {
                try {
                    const text = typeof raw === 'string' ? raw : raw.toString();
                    const message = JSON.parse(text);
                    if (message?.id !== payload.id) {
                        return;
                    }
                    cleanup();
                    resolve(message);
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };

            const cleanup = () => {
                clearTimeout(timeout);
                ws.off('message', onMessage);
            };

            ws.on('message', onMessage);
            ws.send(JSON.stringify(payload), (error) => {
                if (error) {
                    cleanup();
                    reject(error);
                }
            });
        });
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
