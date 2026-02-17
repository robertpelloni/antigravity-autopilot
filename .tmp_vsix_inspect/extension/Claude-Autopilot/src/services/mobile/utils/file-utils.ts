import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class FileUtils {
    public getWorkspaceInfo(): { name: string; path: string } {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            return {
                name: workspaceFolder.name,
                path: workspaceFolder.uri.fsPath
            };
        }
        return {
            name: 'No Workspace',
            path: process.cwd()
        };
    }

    public getWorkspaceRoot(): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? workspaceFolder.uri.fsPath : null;
    }

    public validateAndResolvePath(workspaceRoot: string, requestPath: string): string | null {
        try {
            const cleanPath = requestPath.replace(/^\/+/, '').replace(/\.\./g, '');
            const fullPath = path.resolve(workspaceRoot, cleanPath);
            
            if (!fullPath.startsWith(path.resolve(workspaceRoot))) {
                return null;
            }
            
            return fullPath;
        } catch (error) {
            return null;
        }
    }

    public buildFileTree(dirPath: string, maxDepth: number, currentDepth: number): any[] {
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
            
            const directories = entries.filter(entry => entry.isDirectory());
            const files = entries.filter(entry => entry.isFile());
            
            const sortedEntries = [
                ...directories.sort((a, b) => a.name.localeCompare(b.name)),
                ...files.sort((a, b) => a.name.localeCompare(b.name))
            ];

            for (const entry of sortedEntries) {
                if (this.shouldIgnoreFile(entry.name, ignorePatterns)) {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                const stats = fs.statSync(fullPath);
                const relativePath = path.relative(this.getWorkspaceRoot()!, fullPath);

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

    public shouldIgnoreFile(filename: string, ignorePatterns: string[]): boolean {
        for (const pattern of ignorePatterns) {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                if (regex.test(filename)) {
                    return true;
                }
            } else if (filename === pattern) {
                return true;
            }
        }
        return false;
    }

    public countItems(items: any[]): number {
        let count = items.length;
        for (const item of items) {
            if (item.children) {
                count += this.countItems(item.children);
            }
        }
        return count;
    }

    public isBinaryFile(filePath: string): boolean {
        try {
            const buffer = fs.readFileSync(filePath, { encoding: null });
            const sampleSize = Math.min(buffer.length, 512);
            
            for (let i = 0; i < sampleSize; i++) {
                const byte = buffer[i];
                if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
                    return true;
                }
            }
            return false;
        } catch (error) {
            return true;
        }
    }

    public getLanguageFromExtension(extension: string): string {
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.html': 'html',
            '.htm': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less',
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.toml': 'toml',
            '.ini': 'ini',
            '.cfg': 'ini',
            '.conf': 'ini',
            '.sh': 'bash',
            '.bash': 'bash',
            '.zsh': 'bash',
            '.fish': 'bash',
            '.ps1': 'powershell',
            '.sql': 'sql',
            '.md': 'markdown',
            '.txt': 'text',
            '.log': 'text',
            '.dockerfile': 'dockerfile',
            '.gitignore': 'text',
            '.env': 'text'
        };
        
        return languageMap[extension] || 'text';
    }
}