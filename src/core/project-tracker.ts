/**
 * Antigravity Autopilot - Project Tracker
 * Manages project state and task progression by reading standard markdown task lists
 * @module core/project-tracker
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { taskAnalyzer } from './task-analyzer';

const log = createLogger('ProjectTracker');

export class ProjectTracker {
    private workspaceRoot: string | null = null;

    constructor() {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            this.workspaceRoot = folders[0].uri.fsPath;
        }
    }

    /**
     * Gets the next incomplete task from project files
     * Priority: task.md -> ROADMAP.md -> @fix_plan.md
     */
    getNextTask(): string | null {
        if (!this.workspaceRoot) return null;

        // Prioritize task.md as the main source of truth
        // But check .gemini/antigravity/brain/*/task.md if standard one missing? 
        // For now, assume root task.md or @fix_plan.md as per existing patterns
        const files = ['task.md', 'ROADMAP.md', '@fix_plan.md'];

        for (const file of files) {
            const filePath = path.join(this.workspaceRoot, file);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const task = taskAnalyzer.extractCurrentTask(content);
                    if (task) {
                        log.info(`Found next task in ${file}: ${task}`);
                        return task;
                    }
                } catch (error) {
                    log.warn(`Failed to read ${file}: ${(error as Error).message}`);
                }
            }
        }

        return null;
    }

    /**
     * Marks a task as complete in the source file
     */
    completeTask(taskDescription: string): boolean {
        if (!this.workspaceRoot) return false;

        const files = ['task.md', 'ROADMAP.md', '@fix_plan.md'];

        for (const file of files) {
            const filePath = path.join(this.workspaceRoot, file);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    // Check if file contains the task
                    if (content.includes(taskDescription)) {
                        const newContent = taskAnalyzer.markTaskComplete(content, taskDescription);
                        if (newContent !== content) {
                            fs.writeFileSync(filePath, newContent, 'utf-8');
                            log.info(`Marked task complete in ${file}`);
                            return true;
                        }
                    }
                } catch (error) {
                    log.error(`Failed to update ${file}: ${(error as Error).message}`);
                }
            }
        }

        log.warn(`Task not found in any project file: ${taskDescription}`);
        return false;
    }
}

export const projectTracker = new ProjectTracker();
