import { spawn } from 'child_process';
import { getWorkspaceRoot, resolveAndValidatePath, sanitizeGitOutput, isGitRepository, GitSecurityError } from './security';
import { createErrorResult } from '../../utils/error-handler';
import { GIT_TIMEOUT } from '../../core/constants/timeouts';
import { wrapCommandForWSL } from '../../utils/wsl-helper';

export interface GitOperationResult {
    success: boolean;
    message: string;
    error?: string;
}

export async function stageFile(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        await executeGitCommand(['add', '--', relativePath], workspaceRoot);
        
        return {
            success: true,
            message: `File staged: ${relativePath}`
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to stage file' }),
            message: 'Failed to stage file'
        };
    }
}

export async function unstageFile(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        await executeGitCommand(['reset', 'HEAD', '--', relativePath], workspaceRoot);
        
        return {
            success: true,
            message: `File unstaged: ${relativePath}`
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to unstage file' }),
            message: 'Failed to unstage file'
        };
    }
}

export async function discardChanges(filePath: string): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
        const relativePath = filePath.replace(/^\/+/, '');
        
        // Check if file exists in HEAD (committed version)
        try {
            await executeGitCommand(['cat-file', '-e', `HEAD:${relativePath}`], workspaceRoot);
            // File exists in HEAD, restore it
            await executeGitCommand(['checkout', 'HEAD', '--', relativePath], workspaceRoot);
        } catch {
            // File doesn't exist in HEAD, it's untracked - remove it
            const fs = await import('fs');
            const path = await import('path');
            const fullPath = path.resolve(workspaceRoot, relativePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }
        
        return {
            success: true,
            message: `Changes discarded: ${relativePath}`
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to discard changes' }),
            message: 'Failed to discard changes'
        };
    }
}

export async function stageAllFiles(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        await executeGitCommand(['add', '-A'], workspaceRoot);
        
        return {
            success: true,
            message: 'All files staged'
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to stage all files' }),
            message: 'Failed to stage all files'
        };
    }
}

export async function unstageAllFiles(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        await executeGitCommand(['reset', 'HEAD', '.'], workspaceRoot);
        
        return {
            success: true,
            message: 'All files unstaged'
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to unstage all files' }),
            message: 'Failed to unstage all files'
        };
    }
}

export async function discardAllChanges(): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    try {
        // Discard all unstaged changes
        await executeGitCommand(['checkout', '--', '.'], workspaceRoot);
        
        // Clean untracked files
        await executeGitCommand(['clean', '-fd'], workspaceRoot);
        
        return {
            success: true,
            message: 'All changes discarded'
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to discard all changes' }),
            message: 'Failed to discard all changes'
        };
    }
}

export async function stageFiles(filePaths: string[]): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    if (filePaths.length === 0) {
        return { success: false, message: 'No files specified' };
    }

    try {
        // Validate all paths first
        const relativePaths = filePaths.map(filePath => {
            resolveAndValidatePath(workspaceRoot, filePath); // Throws if invalid
            return filePath.replace(/^\/+/, '');
        });
        
        await executeGitCommand(['add', '--', ...relativePaths], workspaceRoot);
        
        return {
            success: true,
            message: `${filePaths.length} files staged`
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to stage files' }),
            message: 'Failed to stage files'
        };
    }
}

export async function unstageFiles(filePaths: string[]): Promise<GitOperationResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        return { success: false, message: 'No workspace available' };
    }

    if (!isGitRepository(workspaceRoot)) {
        return { success: false, message: 'Not a git repository' };
    }

    if (filePaths.length === 0) {
        return { success: false, message: 'No files specified' };
    }

    try {
        // Validate all paths first
        const relativePaths = filePaths.map(filePath => {
            resolveAndValidatePath(workspaceRoot, filePath); // Throws if invalid
            return filePath.replace(/^\/+/, '');
        });
        
        await executeGitCommand(['reset', 'HEAD', '--', ...relativePaths], workspaceRoot);
        
        return {
            success: true,
            message: `${filePaths.length} files unstaged`
        };
    } catch (error) {
        return {
            ...createErrorResult(error, { operation: 'Failed to unstage files' }),
            message: 'Failed to unstage files'
        };
    }
}

async function executeGitCommand(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const { command, args: wrappedArgs } = wrapCommandForWSL('git', args);
        const process = spawn(command, wrappedArgs, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            process.kill();
            reject(new Error('Git command timeout'));
        }, GIT_TIMEOUT);

        process.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code === 0) {
                resolve(sanitizeGitOutput(stdout));
            } else {
                reject(new Error(`Git command failed: ${sanitizeGitOutput(stderr)}`));
            }
        });

        process.on('error', (error) => {
            clearTimeout(timeout);
            reject(new Error(`Git command error: ${error.message}`));
        });
    });
}