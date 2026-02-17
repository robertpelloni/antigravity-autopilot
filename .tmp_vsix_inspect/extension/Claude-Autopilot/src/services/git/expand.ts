import { spawn } from 'child_process';
import { GitDiffLine } from './types';
import { getWorkspaceRoot, resolveAndValidatePath, sanitizeGitOutput, isGitRepository, GitSecurityError } from './security';
import { GIT_TIMEOUT } from '../../core/constants/timeouts';
import { wrapCommandForWSL } from '../../utils/wsl-helper';

export async function expandContext(
    filePath: string, 
    startLine: number, 
    numLines: number = 10,
    compareMode: 'working' | 'staged' | 'head' | 'main' = 'working'
): Promise<GitDiffLine[]> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new GitSecurityError('No workspace available');
    }

    if (!isGitRepository(workspaceRoot)) {
        throw new GitSecurityError('Not a git repository');
    }

    const resolvedPath = resolveAndValidatePath(workspaceRoot, filePath);
    const relativePath = filePath.replace(/^\/+/, '');
    
    try {
        // Get the file content at the specified line range
        let gitRef = 'HEAD';
        switch (compareMode) {
            case 'working':
                // For working directory, we need to get the current file content
                const fs = await import('fs');
                const path = await import('path');
                const fullPath = path.resolve(workspaceRoot, relativePath);
                
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const lines = content.split('\n');
                    const endLine = Math.min(startLine + numLines - 1, lines.length - 1);
                    
                    const contextLines: GitDiffLine[] = [];
                    for (let i = startLine; i <= endLine; i++) {
                        if (i < lines.length) {
                            contextLines.push({
                                type: 'context',
                                oldLineNumber: i + 1,
                                newLineNumber: i + 1,
                                content: lines[i]
                            });
                        }
                    }
                    return contextLines;
                }
                break;
                
            case 'staged':
                gitRef = ':0'; // Staged version
                break;
                
            case 'head':
                gitRef = 'HEAD';
                break;
                
            case 'main':
                // Try main first, then master
                try {
                    await executeGitCommand(['rev-parse', '--verify', 'main'], workspaceRoot);
                    gitRef = 'main';
                } catch {
                    gitRef = 'master';
                }
                break;
        }
        
        // Get file content from git
        const showArgs = ['show', `${gitRef}:${relativePath}`];
        const content = await executeGitCommand(showArgs, workspaceRoot);
        const lines = content.split('\n');
        
        const endLine = Math.min(startLine + numLines - 1, lines.length - 1);
        const contextLines: GitDiffLine[] = [];
        
        for (let i = startLine; i <= endLine; i++) {
            if (i < lines.length) {
                contextLines.push({
                    type: 'context',
                    oldLineNumber: i + 1,
                    newLineNumber: i + 1,
                    content: lines[i]
                });
            }
        }
        
        return contextLines;
        
    } catch (error) {
        console.error('Error expanding context:', error);
        // Return empty expansion if we can't get the content
        return [];
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