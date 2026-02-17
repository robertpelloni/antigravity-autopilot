/**
 * File explorer functionality for the mobile server
 */
import { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { MAX_FILE_SIZE } from '../../../core/constants/timeouts';

export interface FileTreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: FileTreeNode[];
    size?: number;
    modified?: string;
}

export class FileExplorer {
    getWorkspaceRoot(): string | null {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
    }

    validateAndResolvePath(workspaceRoot: string, requestPath: string): string | null {
        try {
            // Normalize and resolve the path
            const resolvedPath = path.resolve(workspaceRoot, requestPath || '.');
            
            // Ensure the resolved path is within the workspace
            if (!resolvedPath.startsWith(workspaceRoot)) {
                console.warn('Path traversal attempt detected:', requestPath);
                return null;
            }
            
            return resolvedPath;
        } catch (error) {
            console.error('Error resolving path:', error);
            return null;
        }
    }

    buildFileTree(dirPath: string, maxDepth: number = 3, currentDepth: number = 0): any[] {
        if (currentDepth >= maxDepth) {
            return [];
        }

        const items: any[] = [];
        const ignorePatterns = [
            '.git', '.vscode', 'node_modules', '.DS_Store', 'Thumbs.db',
            '.gitignore', '.vscodeignore', 'out', 'dist', 'build', '.cache',
            '__pycache__', '*.pyc', '.env', '.env.local', '.next', 'coverage'
        ];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            
            // Separate directories and files
            const directories = entries.filter(entry => entry.isDirectory());
            const files = entries.filter(entry => entry.isFile());
            
            // Sort directories first, then files
            const sortedEntries = [
                ...directories.sort((a, b) => a.name.localeCompare(b.name)),
                ...files.sort((a, b) => a.name.localeCompare(b.name))
            ];

            for (const entry of sortedEntries) {
                // Skip ignored patterns
                if (this.shouldIgnoreFile(entry.name, ignorePatterns)) {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                const stats = fs.statSync(fullPath);
                const relativePath = path.relative(this.getWorkspaceRoot() || '', fullPath);

                if (entry.isDirectory()) {
                    const item = {
                        name: entry.name,
                        type: 'directory',
                        path: '/' + relativePath.replace(/\\/g, '/'),
                        children: currentDepth < maxDepth - 1 ? this.buildFileTree(fullPath, maxDepth, currentDepth + 1) : [],
                        expanded: false,
                        size: 0,
                        modified: stats.mtime.toISOString()
                    };
                    items.push(item);
                } else {
                    const extension = path.extname(entry.name).toLowerCase();
                    const item = {
                        name: entry.name,
                        type: 'file',
                        path: '/' + relativePath.replace(/\\/g, '/'),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        extension: extension
                    };
                    items.push(item);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error);
        }

        return items;
    }

    handleFileExplorer(req: Request, res: Response) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return res.status(400).json({ error: 'No workspace folder open' });
        }

        try {
            const requestPath = req.query.path as string || '';
            const resolvedPath = this.validateAndResolvePath(workspaceRoot, requestPath);
            
            if (!resolvedPath) {
                return res.status(400).json({ error: 'Invalid path' });
            }

            const stats = fs.statSync(resolvedPath);
            
            if (stats.isDirectory()) {
                const fileTree = this.buildFileTree(resolvedPath, 2);
                res.json({ 
                    type: 'directory',
                    path: requestPath || '',
                    contents: fileTree 
                });
            } else {
                // Return file metadata
                res.json({
                    type: 'file',
                    path: requestPath,
                    name: path.basename(resolvedPath),
                    size: stats.size,
                    modified: stats.mtime.toISOString()
                });
            }
        } catch (error) {
            console.error('Error in file explorer:', error);
            res.status(500).json({ error: 'Failed to access path' });
        }
    }

    handleFileContent(req: Request, res: Response) {
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            return res.status(400).json({ error: 'No workspace folder open' });
        }

        try {
            const filePath = req.query.path as string;
            if (!filePath) {
                return res.status(400).json({ error: 'File path is required' });
            }

            const resolvedPath = this.validateAndResolvePath(workspaceRoot, filePath);
            if (!resolvedPath) {
                return res.status(400).json({ error: 'Invalid file path' });
            }

            const stats = fs.statSync(resolvedPath);
            if (stats.isDirectory()) {
                return res.status(400).json({ error: 'Path is a directory, not a file' });
            }

            // Check file size (limit to 1MB for safety)
            if (stats.size > MAX_FILE_SIZE) {
                return res.status(400).json({ error: 'File too large to display' });
            }

            const content = fs.readFileSync(resolvedPath, 'utf8');
            const ext = path.extname(resolvedPath).toLowerCase();
            
            res.json({
                content,
                path: filePath,
                name: path.basename(resolvedPath),
                size: stats.size,
                modified: stats.mtime.toISOString(),
                extension: ext,
                language: this.getLanguageFromExtension(ext)
            });
        } catch (error) {
            console.error('Error reading file:', error);
            if (error instanceof Error && error.message.includes('ENOENT')) {
                res.status(404).json({ error: 'File not found' });
            } else {
                res.status(500).json({ error: 'Failed to read file' });
            }
        }
    }

    private getLanguageFromExtension(ext: string): string {
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.ts': 'typescript',
            '.py': 'python',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.md': 'markdown',
            '.txt': 'text',
            '.yml': 'yaml',
            '.yaml': 'yaml',
            '.xml': 'xml',
            '.sh': 'bash',
            '.sql': 'sql',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.rb': 'ruby'
        };
        return languageMap[ext] || 'text';
    }

    countItems(items: any[]): number {
        let count = 0;
        for (const item of items) {
            count++;
            if (item.children && Array.isArray(item.children)) {
                count += this.countItems(item.children);
            }
        }
        return count;
    }

    private shouldIgnoreFile(filename: string, ignorePatterns: string[]): boolean {
        return ignorePatterns.some(pattern => {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                return regex.test(filename);
            }
            return filename.includes(pattern);
        });
    }

    private isBinaryFile(filePath: string): boolean {
        const binaryExtensions = [
            '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg',
            '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
            '.ttf', '.otf', '.woff', '.woff2', '.eot'
        ];
        
        const ext = path.extname(filePath).toLowerCase();
        return binaryExtensions.includes(ext);
    }
}