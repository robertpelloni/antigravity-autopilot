
/**
 * Yoke AntiGravity - Project Manager Integration
 * Jira and GitHub Issues integration for task management
 * @module providers/project-manager
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('ProjectManager');

// ============ Types ============
export interface ProjectTask {
    id: string;
    key?: string; // Jira key or GitHub issue number
    title: string;
    description?: string;
    status: 'todo' | 'in_progress' | 'done' | 'blocked';
    priority?: 'critical' | 'high' | 'medium' | 'low';
    assignee?: string;
    labels?: string[];
    source: 'jira' | 'github' | 'local';
    url?: string;
    createdAt: number;
    updatedAt: number;
}

export interface PullRequest {
    title: string;
    body: string;
    branch: string;
    baseBranch: string;
    labels?: string[];
    linkedIssues?: string[];
}

export interface ProjectConfig {
    jira?: {
        baseUrl: string;
        projectKey: string;
        email: string;
        apiToken: string;
    };
    github?: {
        owner: string;
        repo: string;
        token: string;
    };
}

export interface SyncSnapshot {
    source: 'github' | 'jira';
    fetchedAt: number;
    pagesFetched: number;
    totalItems: number;
    rateLimited: boolean;
    nextPageAvailable: boolean;
    retryAfterSec?: number;
    conflictsDetected: number;
    conflictResolution: 'remote-wins' | 'local-wins' | 'manual';
    error?: string;
}

// ============ Project Manager Class ============
export class ProjectManager {
    private config: ProjectConfig | null = null;
    private workspaceRoot: string | null = null;
    private plannerPath: string | null = null;
    private lastSyncSnapshot: SyncSnapshot | null = null;
    private readonly plannerPriority = ['task.md', 'TODO.md', '@fix_plan.md', 'ROADMAP.md'];

    constructor() {
        this.initializeWorkspace();
    }

    private initializeWorkspace(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.[0]) {
            this.workspaceRoot = folders[0].uri.fsPath;
            this.plannerPath = this.resolvePlannerPath();
        }
        this.loadConfig();
    }

    private resolvePlannerPath(preferWritable = false): string | null {
        if (!this.workspaceRoot) {
            return null;
        }

        for (const file of this.plannerPriority) {
            const candidate = path.join(this.workspaceRoot, file);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        if (preferWritable) {
            return path.join(this.workspaceRoot, 'task.md');
        }

        return null;
    }

    private loadConfig(): void {
        if (!this.workspaceRoot) return;

        const configPath = path.join(this.workspaceRoot, '.yoke', 'project-manager.json');
        if (fs.existsSync(configPath)) {
            try {
                this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                log.info('Project manager config loaded');
            } catch (error) {
                log.warn('Failed to load project config: ' + (error as Error).message);
            }
        }
    }

    private persistSyncSnapshot(snapshot: SyncSnapshot): void {
        this.lastSyncSnapshot = snapshot;
        if (!this.workspaceRoot) return;

        try {
            const yokeDir = path.join(this.workspaceRoot, '.yoke');
            if (!fs.existsSync(yokeDir)) {
                fs.mkdirSync(yokeDir, { recursive: true });
            }

            const snapshotPath = path.join(yokeDir, 'project-manager-sync.json');
            fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
        } catch (error: any) {
            log.warn(`Failed to persist sync snapshot: ${String(error?.message || error || 'unknown error')}`);
        }
    }

    getLastSyncSnapshot(): SyncSnapshot | null {
        return this.lastSyncSnapshot;
    }

    // ============ Fix Plan Sync ============
    async syncFromFixPlan(): Promise<ProjectTask[]> {
        this.plannerPath = this.resolvePlannerPath();
        if (!this.plannerPath || !fs.existsSync(this.plannerPath)) {
            return [];
        }

        const content = fs.readFileSync(this.plannerPath, 'utf-8');
        const tasks: ProjectTask[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            // Parse markdown task format: - [ ] Task description
            const match = line.match(/^[-*]\s*\[([x\s])\]\s*(.+)$/i);
            if (match) {
                const status = match[1].toLowerCase() === 'x' ? 'done' : 'todo';
                const title = match[2].trim();

                tasks.push({
                    id: this.generateId(title),
                    title,
                    status,
                    source: 'local',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }
        }

        log.info(`Synced ${tasks.length} tasks from ${path.basename(this.plannerPath)}`);
        return tasks;
    }

    async updateFixPlan(tasks: ProjectTask[]): Promise<void> {
        this.plannerPath = this.resolvePlannerPath(true);
        if (!this.plannerPath) return;

        const lines: string[] = ['# Fix Plan\n'];

        const todoTasks = tasks.filter(t => t.status !== 'done');
        const doneTasks = tasks.filter(t => t.status === 'done');

        if (todoTasks.length > 0) {
            lines.push('## To Do\n');
            for (const task of todoTasks) {
                const checkbox = task.status === 'in_progress' ? '[/]' : '[ ]';
                const priority = task.priority ? ` [${task.priority}]` : '';
                lines.push(`- ${checkbox} ${task.title}${priority}`);
            }
            lines.push('');
        }

        if (doneTasks.length > 0) {
            lines.push('## Completed\n');
            for (const task of doneTasks) {
                lines.push(`- [x] ${task.title}`);
            }
        }

        fs.writeFileSync(this.plannerPath, lines.join('\n'));
        log.info(`Updated ${path.basename(this.plannerPath)}`);
    }

    // ============ GitHub Integration ============
    async fetchGitHubIssues(): Promise<ProjectTask[]> {
        if (!this.config?.github) {
            return [];
        }

        const { owner, repo, token } = this.config.github;
        try {
            const baseUrl = `https://api.github.com/repos/${owner}/${repo}/issues`;
            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Antigravity-Autopilot'
            };

            const allIssues: any[] = [];
            let nextUrl: string | null = `${baseUrl}?state=all&per_page=100&page=1`;
            let pagesFetched = 0;
            const maxPages = 10;
            let retryAfterSec: number | undefined;
            let rateLimited = false;

            while (nextUrl && pagesFetched < maxPages) {
                const response: any = await fetch(nextUrl, { headers });

                if (!response.ok) {
                    const remaining = response.headers.get('x-ratelimit-remaining');
                    const retryAfter = response.headers.get('retry-after');
                    const resetAt = response.headers.get('x-ratelimit-reset');

                    if (response.status === 403 && remaining === '0') {
                        rateLimited = true;
                        retryAfterSec = retryAfter ? Number(retryAfter) : undefined;
                        if (!retryAfterSec && resetAt) {
                            const resetEpoch = Number(resetAt) * 1000;
                            retryAfterSec = Math.max(1, Math.ceil((resetEpoch - Date.now()) / 1000));
                        }

                        const snapshot: SyncSnapshot = {
                            source: 'github',
                            fetchedAt: Date.now(),
                            pagesFetched,
                            totalItems: allIssues.length,
                            rateLimited: true,
                            nextPageAvailable: true,
                            retryAfterSec,
                            conflictsDetected: 0,
                            conflictResolution: 'remote-wins',
                            error: `GitHub rate limit reached (403)`
                        };
                        this.persistSyncSnapshot(snapshot);
                        log.warn(`GitHub rate limit reached while syncing issues. Retry after ${retryAfterSec ?? 'unknown'}s.`);
                        return [];
                    }

                    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
                }

                const issues = await response.json() as any[];
                const filtered = issues.filter(issue => !issue.pull_request);
                allIssues.push(...filtered);
                pagesFetched += 1;

                const linkHeader: any = response.headers.get('link') || '';
                const nextMatch: any = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
                nextUrl = nextMatch?.[1] || null;
            }

            const snapshot: SyncSnapshot = {
                source: 'github',
                fetchedAt: Date.now(),
                pagesFetched,
                totalItems: allIssues.length,
                rateLimited,
                nextPageAvailable: !!nextUrl,
                retryAfterSec,
                conflictsDetected: 0,
                conflictResolution: 'remote-wins'
            };
            this.persistSyncSnapshot(snapshot);

            return allIssues.map(issue => ({
                id: issue.id.toString(),
                key: `#${issue.number}`,
                title: issue.title,
                description: issue.body,
                status: issue.state === 'closed' ? 'done' : 'todo',
                source: 'github',
                url: issue.html_url,
                createdAt: new Date(issue.created_at).getTime(),
                updatedAt: new Date(issue.updated_at).getTime(),
                assignee: issue.assignee?.login
            }));
        } catch (error) {
            log.error(`Failed to fetch GitHub issues: ${(error as Error).message}`);
            const snapshot: SyncSnapshot = {
                source: 'github',
                fetchedAt: Date.now(),
                pagesFetched: 0,
                totalItems: 0,
                rateLimited: false,
                nextPageAvailable: false,
                conflictsDetected: 0,
                conflictResolution: 'remote-wins',
                error: (error as Error).message
            };
            this.persistSyncSnapshot(snapshot);
            return [];
        }
    }

    // ============ Jira Integration ============
    async fetchJiraIssues(): Promise<ProjectTask[]> {
        if (!this.config?.jira) {
            return [];
        }

        const { baseUrl, projectKey, email, apiToken } = this.config.jira;
        try {
            const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
            const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
            const headers = {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            };

            const allIssues: any[] = [];
            let startAt = 0;
            const maxResults = 50;
            const maxPages = 10;
            let pagesFetched = 0;
            let retryAfterSec: number | undefined;
            let rateLimited = false;
            let totalExpected = 0;

            while (pagesFetched < maxPages) {
                const body = {
                    jql: `project = ${projectKey} ORDER BY updated DESC`,
                    startAt,
                    maxResults,
                    fields: [
                        'summary',
                        'description',
                        'status',
                        'priority',
                        'assignee',
                        'labels',
                        'created',
                        'updated'
                    ]
                };

                const response: any = await fetch(`${normalizedBase}/rest/api/3/search`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const retryAfter = response.headers.get('retry-after');
                    const remaining = response.headers.get('x-ratelimit-remaining');

                    if (response.status === 429 || (response.status === 403 && remaining === '0')) {
                        rateLimited = true;
                        retryAfterSec = retryAfter ? Number(retryAfter) : undefined;
                        const snapshot: SyncSnapshot = {
                            source: 'jira',
                            fetchedAt: Date.now(),
                            pagesFetched,
                            totalItems: allIssues.length,
                            rateLimited: true,
                            nextPageAvailable: true,
                            retryAfterSec,
                            conflictsDetected: 0,
                            conflictResolution: 'remote-wins',
                            error: `Jira rate limit reached (${response.status})`
                        };
                        this.persistSyncSnapshot(snapshot);
                        log.warn(`Jira rate limit reached while syncing issues. Retry after ${retryAfterSec ?? 'unknown'}s.`);
                        return [];
                    }

                    throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
                }

                const payload = await response.json() as any;
                const issues = Array.isArray(payload?.issues) ? payload.issues : [];
                allIssues.push(...issues);
                pagesFetched += 1;
                totalExpected = Number(payload?.total || totalExpected || allIssues.length);

                const received = Number(payload?.maxResults || maxResults);
                const nextStart = Number(payload?.startAt || startAt) + received;
                if (allIssues.length >= totalExpected || issues.length === 0) {
                    break;
                }

                startAt = nextStart;
            }

            const snapshot: SyncSnapshot = {
                source: 'jira',
                fetchedAt: Date.now(),
                pagesFetched,
                totalItems: allIssues.length,
                rateLimited,
                nextPageAvailable: totalExpected > allIssues.length,
                retryAfterSec,
                conflictsDetected: 0,
                conflictResolution: 'remote-wins'
            };
            this.persistSyncSnapshot(snapshot);

            return allIssues.map(issue => {
                const fields = issue?.fields || {};
                const statusName = String(fields?.status?.name || '').toLowerCase();
                const mappedStatus: ProjectTask['status'] =
                    statusName.includes('done') || statusName.includes('closed') ? 'done'
                        : statusName.includes('progress') || statusName.includes('doing') ? 'in_progress'
                            : statusName.includes('block') ? 'blocked'
                                : 'todo';

                const priorityName = String(fields?.priority?.name || '').toLowerCase();
                const mappedPriority: ProjectTask['priority'] | undefined =
                    priorityName.includes('highest') || priorityName.includes('critical') ? 'critical'
                        : priorityName.includes('high') ? 'high'
                            : priorityName.includes('medium') ? 'medium'
                                : priorityName.includes('low') || priorityName.includes('lowest') ? 'low'
                                    : undefined;

                return {
                    id: String(issue?.id || ''),
                    key: String(issue?.key || ''),
                    title: String(fields?.summary || ''),
                    description: typeof fields?.description === 'string' ? fields.description : undefined,
                    status: mappedStatus,
                    priority: mappedPriority,
                    assignee: fields?.assignee?.displayName || fields?.assignee?.emailAddress,
                    labels: Array.isArray(fields?.labels) ? fields.labels : undefined,
                    source: 'jira' as const,
                    url: `${normalizedBase}/browse/${issue?.key}`,
                    createdAt: new Date(fields?.created || Date.now()).getTime(),
                    updatedAt: new Date(fields?.updated || Date.now()).getTime()
                };
            });
        } catch (error) {
            log.error(`Failed to fetch Jira issues: ${(error as Error).message}`);
            const snapshot: SyncSnapshot = {
                source: 'jira',
                fetchedAt: Date.now(),
                pagesFetched: 0,
                totalItems: 0,
                rateLimited: false,
                nextPageAvailable: false,
                conflictsDetected: 0,
                conflictResolution: 'remote-wins',
                error: (error as Error).message
            };
            this.persistSyncSnapshot(snapshot);
            return [];
        }
    }

    // ============ Utilities ============
    private generateId(title: string): string {
        const slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .substring(0, 20);
        return `${slug}-${Date.now().toString(36)}`;
    }
}

// Singleton export
export const projectManager = new ProjectManager();
