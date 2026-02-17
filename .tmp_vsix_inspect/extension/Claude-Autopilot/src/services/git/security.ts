import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit for diffs
const DANGEROUS_PATTERNS = [
    /\.\./,           // Directory traversal
    /[<>:"|?*]/,      // Invalid file characters (Windows)
    /[\x00-\x1f]/,    // Control characters
    /^\.git\//,       // Direct .git access
    /\/\.git\//       // .git in path
];

export class GitSecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GitSecurityError';
    }
}

export function getWorkspaceRoot(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder ? workspaceFolder.uri.fsPath : null;
}

export function validateFilePath(filePath: string): boolean {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(filePath)) {
            return false;
        }
    }

    return true;
}

export function resolveAndValidatePath(workspaceRoot: string, filePath: string): string {
    if (!validateFilePath(filePath)) {
        throw new GitSecurityError(`Invalid file path: ${filePath}`);
    }

    // Remove leading slash and normalize
    const cleanPath = filePath.replace(/^\/+/, '').replace(/\\/g, '/');
    const resolvedPath = path.resolve(workspaceRoot, cleanPath);
    
    // Ensure path is within workspace
    const normalizedWorkspace = path.resolve(workspaceRoot);
    const normalizedPath = path.resolve(resolvedPath);
    
    if (!normalizedPath.startsWith(normalizedWorkspace)) {
        throw new GitSecurityError(`Path outside workspace: ${filePath}`);
    }

    return resolvedPath;
}

export function validateFileSize(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);
        return stats.size <= MAX_FILE_SIZE;
    } catch (error) {
        return false;
    }
}

export function sanitizeGitOutput(output: string): string {
    // Remove ANSI escape codes
    const cleaned = output.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Limit output size to prevent memory issues
    const maxLength = 100000; // 100KB
    if (cleaned.length > maxLength) {
        return cleaned.substring(0, maxLength) + '\n... (output truncated)';
    }
    
    return cleaned;
}

export function isGitRepository(workspaceRoot: string): boolean {
    try {
        const gitDir = path.join(workspaceRoot, '.git');
        return fs.existsSync(gitDir);
    } catch (error) {
        return false;
    }
}