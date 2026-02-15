
/**
 * Yoke AntiGravity - Agent Orchestrator
 * Multi-agent collaboration system for specialized task handling
 * @module core/agent-orchestrator
 */

import { createLogger } from '../utils/logger';
import { taskAnalyzer } from './task-analyzer';
// Constants
import { TaskType, TaskTypeValue } from '../utils/constants';
import { cdpClient } from '../providers/cdp-client';

const log = createLogger('AgentOrchestrator');

// ============ Types ============
export interface AgentDefinition {
    id: string;
    name: string;
    role: 'researcher' | 'implementer' | 'reviewer' | 'tester' | 'planner';
    capabilities: string[];
    preferredModel: string;
    systemPrompt: string;
    maxConcurrentTasks: number;
}

export interface AgentTask {
    id: string;
    agentId: string;
    type: TaskTypeValue;
    description: string;
    context: string;
    status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
    result?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    parentTaskId?: string;
    subtasks?: string[];
}

export interface OrchestratorConfig {
    maxConcurrentAgents: number;
    taskTimeout: number;
    enableParallelExecution: boolean;
    autoDecomposeTasks: boolean;
}

export interface SwarmResult {
    totalTasks: number;
    completed: number;
    failed: number;
    results: Array<{ taskId: string; agentId: string; status: string; result?: string; durationMs: number }>;
    durationMs: number;
}

// ============ Agent Definitions ============
const DEFAULT_AGENTS: AgentDefinition[] = [
    {
        id: 'researcher',
        name: 'Research Agent',
        role: 'researcher',
        capabilities: ['codebase-analysis', 'documentation-search', 'dependency-analysis', 'pattern-detection'],
        preferredModel: 'claude-opus-4.5-thinking',
        systemPrompt: `You are a research agent specialized in analyzing codebases and documentation.
Your job is to gather information, understand existing patterns, and provide context for implementation.
Always cite specific files and line numbers when referencing code.
Focus on understanding before suggesting changes.`,
        maxConcurrentTasks: 2
    },
    {
        id: 'implementer',
        name: 'Implementation Agent',
        role: 'implementer',
        capabilities: ['code-generation', 'refactoring', 'bug-fixing', 'feature-implementation'],
        preferredModel: 'gemini-3-pro-high',
        systemPrompt: `You are an implementation agent focused on writing clean, efficient code.
Follow existing coding patterns and conventions in the codebase.
Write comprehensive code with proper error handling.
Always explain your implementation decisions.`,
        maxConcurrentTasks: 1
    },
    {
        id: 'reviewer',
        name: 'Review Agent',
        role: 'reviewer',
        capabilities: ['code-review', 'security-analysis', 'performance-analysis', 'best-practices'],
        preferredModel: 'claude-sonnet-4.5-thinking',
        systemPrompt: `You are a code review agent focused on quality and security.
Review code for potential issues, security vulnerabilities, and performance problems.
Suggest improvements based on best practices.
Be specific and actionable in your feedback.`,
        maxConcurrentTasks: 3
    },
    {
        id: 'tester',
        name: 'Testing Agent',
        role: 'tester',
        capabilities: ['test-generation', 'test-execution', 'coverage-analysis', 'edge-case-detection'],
        preferredModel: 'gemini-3-flash',
        systemPrompt: `You are a testing agent focused on ensuring code quality through tests.
Generate comprehensive unit tests covering edge cases.
Prioritize test coverage for critical paths.
Ensure tests are maintainable and well-documented.`,
        maxConcurrentTasks: 2
    },
    {
        id: 'planner',
        name: 'Planning Agent',
        role: 'planner',
        capabilities: ['task-decomposition', 'priority-assignment', 'dependency-ordering', 'resource-allocation'],
        preferredModel: 'claude-opus-4.5-thinking',
        systemPrompt: `You are a planning agent. Decompose the following task into a JSON array of subtasks.
Example format: ["Analyze database schema", "Create API endpoint", "Update frontend service"]
Return ONLY the JSON array.`,
        maxConcurrentTasks: 1
    }
];

// ============ Agent Orchestrator Class ============
export class AgentOrchestrator {
    private agents: Map<string, AgentDefinition> = new Map();
    private tasks: Map<string, AgentTask> = new Map();
    private taskQueue: AgentTask[] = [];
    private runningTasks: Map<string, AgentTask> = new Map();
    private config: OrchestratorConfig = {
        maxConcurrentAgents: 3,
        taskTimeout: 300000, // 5 minutes
        enableParallelExecution: true,
        autoDecomposeTasks: true
    };

    constructor() {
        this.initializeAgents();
    }

    private initializeAgents(): void {
        for (const agent of DEFAULT_AGENTS) {
            this.agents.set(agent.id, agent);
        }
        log.info(`Initialized ${this.agents.size} agents`);
    }

    // ============ Task Management ============
    async submitTask(description: string, context: string = ''): Promise<string> {
        // Simple heuristic for now
        const taskType = TaskType.GENERAL;
        const taskId = this.generateTaskId();

        const task: AgentTask = {
            id: taskId,
            agentId: this.selectAgentForTask(taskType),
            type: taskType,
            description,
            context,
            status: 'pending',
            createdAt: Date.now()
        };

        // Auto-decompose complex tasks
        if (this.config.autoDecomposeTasks && this.isComplexTask(description)) {
            const subtasks = await this.decomposeTask(task);
            task.subtasks = subtasks.map(st => st.id);
        }

        this.tasks.set(taskId, task);
        this.taskQueue.push(task);

        log.info(`Task submitted: ${taskId} [${taskType}]`);

        // Start processing if possible
        this.processQueue();

        return taskId;
    }

    private async decomposeTask(task: AgentTask): Promise<AgentTask[]> {
        const planner = this.agents.get('planner');
        if (!planner) return [];

        log.info(`Decomposing task: ${task.id}`);

        const scanTask: AgentTask = {
            ...task,
            agentId: 'planner',
            type: TaskType.REASONING // Force reasoning for planning
        };

        const response = await this.executeTask(scanTask, planner);

        // Default fallback if parsing fails
        const subtasks: AgentTask[] = [];

        try {
            // Attempt to parse JSON array from response
            // Look for [...] pattern
            const jsonMatch = response.match(/\[.*\]/s);
            if (jsonMatch) {
                const rawList = JSON.parse(jsonMatch[0]);
                if (Array.isArray(rawList)) {
                    rawList.forEach((item: any, index: number) => {
                        if (typeof item === 'string' || (item.title && item.description)) {
                            subtasks.push({
                                id: `${task.id}_sub_${index}`,
                                agentId: this.selectAgentForTask(TaskType.GENERAL),
                                type: TaskType.GENERAL,
                                description: typeof item === 'string' ? item : `${item.title}: ${item.description}`,
                                context: `Subtask of ${task.description}`,
                                status: 'pending',
                                createdAt: Date.now(),
                                parentTaskId: task.id
                            });
                        }
                    });
                }
            }
        } catch (e) {
            log.error('Failed to parse planner response: ' + e);
        }

        // Fallback: If no subtasks found, just return request as single task if it was huge, 
        // but here we just return empty to signal manual handling or simple execution.
        if (subtasks.length > 0) {
            log.info(`Decomposed into ${subtasks.length} subtasks`);
        }

        return subtasks;
    }

    private isComplexTask(description: string): boolean {
        const complexIndicators = [
            /implement.*feature/i,
            /refactor.*entire/i,
            /create.*system/i,
            /build.*from\s+scratch/i,
            /multiple.*components/i
        ];

        return complexIndicators.some(pattern => pattern.test(description));
    }

    // ============ Agent Selection ============
    private selectAgentForTask(taskType: TaskTypeValue): string {
        switch (taskType) {
            case TaskType.REASONING:
                return 'researcher';
            case TaskType.FRONTEND:
                return 'implementer';
            case TaskType.QUICK:
                return 'tester';
            default:
                return 'implementer';
        }
    }

    // ============ Queue Processing ============
    private async processQueue(): Promise<void> {
        while (this.taskQueue.length > 0 && this.canStartNewTask()) {
            const task = this.taskQueue.shift();
            if (task) {
                await this.startTask(task);
            }
        }
    }

    private canStartNewTask(): boolean {
        return this.runningTasks.size < this.config.maxConcurrentAgents;
    }

    private async startTask(task: AgentTask): Promise<void> {
        const agent = this.agents.get(task.agentId);
        if (!agent) {
            task.status = 'failed';
            task.result = 'Agent not found';
            return;
        }

        task.status = 'running';
        task.startedAt = Date.now();
        this.runningTasks.set(task.id, task);

        log.info(`Starting task ${task.id} with agent ${agent.name}`);

        try {
            // Set up timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Task timeout')), this.config.taskTimeout);
            });

            // Execute task
            const executionPromise = this.executeTask(task, agent);

            const result = await Promise.race([executionPromise, timeoutPromise]);

            task.status = 'completed';
            task.result = result;
            task.completedAt = Date.now();

            log.info(`Task ${task.id} completed`);
        } catch (error) {
            task.status = 'failed';
            task.result = (error as Error).message;
            task.completedAt = Date.now();

            log.error(`Task ${task.id} failed: ${(error as Error).message}`);
        } finally {
            this.runningTasks.delete(task.id);
            this.processQueue();
        }
    }

    private async executeTask(task: AgentTask, agent: AgentDefinition): Promise<string> {
        const prompt = this.buildAgentPrompt(task, agent);

        if (!cdpClient.isConnected()) {
            // Try to connect if not already
            await cdpClient.connect();
        }

        if (!cdpClient.isConnected()) {
            throw new Error('Browser not connected. Cannot execute agent task.');
        }

        log.info(`Agent ${agent.name} executing...`);
        await cdpClient.injectPrompt(prompt);

        // Wait for response with a generous timeout (e.g. 2 mins for thinking)
        const response = await cdpClient.waitForResponse(120000);
        return response;
    }

    private buildAgentPrompt(task: AgentTask, agent: AgentDefinition): string {
        return `
${agent.systemPrompt}

---

## Current Task

**Type**: ${task.type}
**Description**: ${task.description}

${task.context ? `## Context\n\n${task.context}` : ''}

## Instructions

Execute this task according to your role as ${agent.name}.
Provide a clear, actionable response.
`.trim();
    }

    // ============ Task Coordination ============
    async coordinateAgents(mainTask: string): Promise<void> {
        log.info('Starting multi-agent coordination');

        // 1. Planning phase
        const plannerTask = await this.submitTask(
            `Plan and decompose this task: ${mainTask}`,
            'This is a coordination task. Break it down into subtasks for other agents.'
        );

        await this.waitForTask(plannerTask);

        // 2. Research phase
        const researchTask = await this.submitTask(
            `Research codebase for: ${mainTask}`,
            'Gather context and existing patterns before implementation.'
        );

        // 3. Implementation phase
        await this.waitForTask(researchTask);
        const implementTask = await this.submitTask(
            `Implement: ${mainTask}`,
            'Use research findings to implement the feature.'
        );

        // 4. Review phase
        await this.waitForTask(implementTask);
        await this.submitTask(
            `Review implementation of: ${mainTask}`,
            'Review for quality, security, and best practices.'
        );

        // 5. Testing phase
        await this.submitTask(
            `Generate tests for: ${mainTask}`,
            'Create comprehensive tests for the implementation.'
        );
    }

    private async waitForTask(taskId: string): Promise<AgentTask | null> {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const task = this.tasks.get(taskId);
                if (!task || task.status === 'completed' || task.status === 'failed') {
                    clearInterval(checkInterval);
                    resolve(task || null);
                }
            }, 1000);
        });
    }

    // ============ Swarm Mode ============
    async swarmExecute(taskDescriptions: string[], context: string = ''): Promise<SwarmResult> {
        const swarmStart = Date.now();
        log.info(`[Swarm] Launching ${taskDescriptions.length} tasks (max concurrency: ${this.config.maxConcurrentAgents})`);

        const taskIds: string[] = [];
        for (const desc of taskDescriptions) {
            const id = await this.submitTask(desc, context);
            taskIds.push(id);
        }

        // Wait for all tasks to settle
        const settled = await Promise.allSettled(
            taskIds.map(id => this.waitForTask(id))
        );

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

        const swarmResult: SwarmResult = {
            totalTasks: taskDescriptions.length,
            completed: results.filter(r => r.status === 'completed').length,
            failed: results.filter(r => r.status === 'failed').length,
            results,
            durationMs: Date.now() - swarmStart
        };

        log.info(`[Swarm] Finished: ${swarmResult.completed}/${swarmResult.totalTasks} succeeded in ${swarmResult.durationMs}ms`);
        return swarmResult;
    }

    getSwarmStatus(): { queueLength: number; running: number; maxConcurrent: number } {
        return {
            queueLength: this.taskQueue.length,
            running: this.runningTasks.size,
            maxConcurrent: this.config.maxConcurrentAgents
        };
    }

    // ============ Utilities ============
    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
}

// Singleton export
export const agentOrchestrator = new AgentOrchestrator();
