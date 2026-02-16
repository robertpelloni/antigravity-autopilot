
import * as vscode from 'vscode';
import * as http from 'http';
import { createLogger } from '../../utils/logger';
import { projectTracker } from '../../core/project-tracker';

const log = createLogger('MCPServer');

interface MCPJsonRpcRequest {
    jsonrpc?: string;
    id?: string | number | null;
    method: string;
    params?: any;
}

interface MCPJsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: any;
    error?: {
        code: number;
        message: string;
    };
}

export class MCPServer {
    private isActive = false;
    private server: http.Server | null = null;
    private readonly defaultPort = 3000;
    private readonly maxBodyBytes = 1024 * 1024;

    private getPort(): number {
        const raw = process.env.ANTIGRAVITY_MCP_PORT || process.env.PORT;
        const parsed = raw ? Number(raw) : NaN;
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
            return parsed;
        }
        return this.defaultPort;
    }

    async start() {
        if (this.isActive) {
            return;
        }

        const port = this.getPort();
        this.server = http.createServer((req, res) => {
            this.routeRequest(req, res).catch((error: Error) => {
                log.error(`MCP HTTP route failure: ${error.message}`);
                this.writeJson(res, 500, {
                    ok: false,
                    error: 'Internal server error'
                });
            });
        });

        await new Promise<void>((resolve, reject) => {
            if (!this.server) {
                reject(new Error('MCP server allocation failed'));
                return;
            }

            this.server.once('error', reject);
            this.server.listen(port, () => {
                this.server?.off('error', reject);
                resolve();
            });
        });

        this.isActive = true;
        log.info(`MCP Server listening on http://localhost:${port}`);
        vscode.window.showInformationMessage(`MCP Server is active on port ${port} 🚀`);
    }

    async stop() {
        if (!this.isActive) {
            return;
        }

        if (this.server) {
            await new Promise<void>((resolve) => {
                this.server?.close(() => resolve());
            });
            this.server = null;
        }

        this.isActive = false;
        log.info('MCP Server stopped');
    }

    private async routeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = req.method || 'GET';
        const url = req.url || '/';

        if (method === 'GET' && (url === '/' || url === '/health')) {
            this.writeJson(res, 200, {
                ok: true,
                service: 'antigravity-mcp-server',
                active: this.isActive,
                tools: this.getToolMetadata().map(t => t.name),
                timestamp: Date.now()
            });
            return;
        }

        if (method !== 'POST' || url !== '/rpc') {
            this.writeJson(res, 404, { ok: false, error: 'Not found' });
            return;
        }

        const body = await this.readBody(req);
        if (!body) {
            this.writeJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error: empty body' }
            });
            return;
        }

        let request: MCPJsonRpcRequest;
        try {
            request = JSON.parse(body) as MCPJsonRpcRequest;
        } catch {
            this.writeJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error: invalid JSON' }
            });
            return;
        }

        const response = await this.handleRequest(request);
        this.writeJson(res, 200, response);
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let total = 0;

            req.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > this.maxBodyBytes) {
                    reject(new Error('Request body too large'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            });

            req.on('error', reject);
        });
    }

    private writeJson(res: http.ServerResponse, statusCode: number, payload: any): void {
        const body = JSON.stringify(payload);
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.end(body);
    }

    private getToolMetadata(): Array<{ name: string; description: string }> {
        return [
            { name: 'get_next_task', description: 'Read the next incomplete task from project tracking files.' },
            { name: 'complete_task', description: 'Mark a task as complete in project tracking files.' }
        ];
    }

    async handleRequest(request: MCPJsonRpcRequest): Promise<MCPJsonRpcResponse> {
        log.info(`Received request: ${request.method}`);

        try {
            const id = request.id ?? null;

            if (request.method === 'tools/list') {
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        tools: this.getToolMetadata().map(tool => ({
                            name: tool.name,
                            description: tool.description,
                            inputSchema: {
                                type: 'object',
                                properties: tool.name === 'complete_task'
                                    ? {
                                        task_description: { type: 'string', description: 'Task text to mark complete.' }
                                    }
                                    : {},
                                required: tool.name === 'complete_task' ? ['task_description'] : []
                            }
                        }))
                    }
                };
            }

            if (request.method === 'tools/call') {
                const { name, arguments: args } = request.params;

                if (name === 'get_next_task') {
                    const task = projectTracker.getNextTask();
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { content: [{ type: 'text', text: task || 'No tasks pending' }] },
                    };
                }

                if (name === 'complete_task') {
                    const success = projectTracker.completeTask(args.task_description);
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: { content: [{ type: 'text', text: success ? 'Task marked as complete' : 'Task not found' }] },
                    };
                }

                return {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${String(name)}`
                    }
                };
            }

            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32601,
                    message: `Method not found: ${request.method}`
                }
            };
        } catch (error) {
            log.error(`MCP Request Error: ${(error as Error).message}`);
            return {
                jsonrpc: '2.0',
                id: request.id ?? null,
                error: { code: -32603, message: 'Internal error' }
            };
        }
    }
}

export const mcpServer = new MCPServer();
