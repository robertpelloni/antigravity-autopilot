import { spawn, ChildProcess } from 'child_process';
import { GitFileStatus, GitBranchInfo, GitStatusResult } from './types';
import { getWorkspaceRoot, sanitizeGitOutput, isGitRepository, GitSecurityError } from './security';
import { GIT_TIMEOUT } from '../../core/constants/timeouts';
import { wrapCommandForWSL } from '../../utils/wsl-helper';

export async function getGitStatus(): Promise<GitStatusResult> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        throw new GitSecurityError('No workspace available');
    }

    if (!isGitRepository(workspaceRoot)) {
        throw new GitSecurityError('Not a git repository');
    }

    // Only get uncommitted files - no branch info needed for simplified interface
    const files = await getStatusFiles(workspaceRoot);

    return {
        branch: null, // Simplified - don't return branch info
        files,
        isClean: files.length === 0
    };
}

async function getBranchInfo(workspaceRoot: string): Promise<GitBranchInfo> {
    const [branchData, commitData] = await Promise.all([
        executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot),
        executeGitCommand(['log', '-1', '--pretty=format:%H|%s|%an|%ai'], workspaceRoot)
    ]);

    const branch = branchData.trim();
    const [hash, message, author, date] = commitData.split('|');

    // Get ahead/behind count
    let ahead = 0;
    let behind = 0;
    
    try {
        const upstreamData = await executeGitCommand(['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], workspaceRoot);
        const [behindStr, aheadStr] = upstreamData.trim().split('\t');
        ahead = parseInt(aheadStr) || 0;
        behind = parseInt(behindStr) || 0;
    } catch (error) {
        // Upstream might not exist, ignore error
    }

    return {
        branch,
        ahead,
        behind,
        lastCommit: {
            hash: hash.substring(0, 7),
            message: message || 'Initial commit',
            author: author || 'Unknown',
            date: date || new Date().toISOString()
        }
    };
}

async function getStatusFiles(workspaceRoot: string): Promise<GitFileStatus[]> {
    const statusOutput = await executeGitCommand(['status', '--porcelain=v1', '-z'], workspaceRoot);
    
    if (!statusOutput.trim()) {
        return [];
    }

    const files: GitFileStatus[] = [];
    const entries = statusOutput.split('\0').filter(entry => entry.length > 0);
    const fs = await import('fs');
    const path = await import('path');

    for (const entry of entries) {
        if (entry.length < 3) continue;

        const indexStatus = entry[0];
        const workingStatus = entry[1];
        const filePath = entry.substring(3);

        // Handle renamed files (format: "R  old -> new")
        let actualPath = filePath;
        let oldPath: string | undefined;
        
        if (indexStatus === 'R' && filePath.includes(' -> ')) {
            const parts = filePath.split(' -> ');
            oldPath = parts[0];
            actualPath = parts[1];
        }

        // Skip folders - only show files
        try {
            const fullPath = path.resolve(workspaceRoot, actualPath);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                continue; // Skip directories
            }
        } catch (error) {
            // If we can't check, assume it's a file and include it
        }

        const status = getFileStatus(indexStatus, workingStatus);
        const staged = indexStatus !== ' ' && indexStatus !== '?';
        const unstaged = workingStatus !== ' ';

        files.push({
            path: actualPath,
            status,
            staged,
            unstaged,
            oldPath
        });
    }

    // Get diff stats for each file
    await addDiffStats(files, workspaceRoot);

    return files;
}

function getFileStatus(indexStatus: string, workingStatus: string): GitFileStatus['status'] {
    // Prioritize index status, then working status
    const status = indexStatus !== ' ' ? indexStatus : workingStatus;
    
    switch (status) {
        case 'M': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'C': return 'copied';
        case '?': return 'untracked';
        default: return 'modified';
    }
}

async function addDiffStats(files: GitFileStatus[], workspaceRoot: string): Promise<void> {
    const promises = files.map(async (file) => {
        try {
            let diffArgs: string[];
            
            if (file.status === 'untracked') {
                // For untracked files, count lines in the file
                const output = await executeGitCommand(['show', `:${file.path}`], workspaceRoot).catch(() => '');
                file.additions = output.split('\n').length - 1;
                file.deletions = 0;
                return;
            }

            if (file.staged && file.unstaged) {
                // File has both staged and unstaged changes, show working vs HEAD
                diffArgs = ['diff', '--numstat', 'HEAD', '--', file.path];
            } else if (file.staged) {
                // Staged changes only
                diffArgs = ['diff', '--numstat', '--cached', '--', file.path];
            } else {
                // Unstaged changes only
                diffArgs = ['diff', '--numstat', '--', file.path];
            }

            const output = await executeGitCommand(diffArgs, workspaceRoot);
            const line = output.trim().split('\n')[0];
            
            if (line && line !== '-\t-') {
                const [addStr, delStr] = line.split('\t');
                file.additions = parseInt(addStr) || 0;
                file.deletions = parseInt(delStr) || 0;
            }
        } catch (error) {
            // If diff fails, set defaults
            file.additions = 0;
            file.deletions = 0;
        }
    });

    await Promise.all(promises);
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