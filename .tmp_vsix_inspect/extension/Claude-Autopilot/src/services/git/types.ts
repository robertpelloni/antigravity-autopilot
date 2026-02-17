export interface GitFileStatus {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked';
    staged: boolean;
    unstaged: boolean;
    additions?: number;
    deletions?: number;
    oldPath?: string; // For renamed files
}

export interface GitBranchInfo {
    branch: string;
    ahead: number;
    behind: number;
    lastCommit: {
        hash: string;
        message: string;
        author: string;
        date: string;
    };
}

export interface GitStatusResult {
    branch: GitBranchInfo | null; // Simplified - branch info is optional
    files: GitFileStatus[];
    isClean: boolean;
}

export interface GitDiffLine {
    type: 'context' | 'addition' | 'deletion' | 'header' | 'hunk' | 'expand';
    oldLineNumber?: number;
    newLineNumber?: number;
    content: string;
    expandable?: boolean;
    expandBefore?: number;
    expandAfter?: number;
    hunkHeader?: string;
}

export interface GitDiffResult {
    filePath: string;
    oldPath?: string;
    isNew: boolean;
    isDeleted: boolean;
    isBinary: boolean;
    additions: number;
    deletions: number;
    lines: GitDiffLine[];
}

export type GitCompareMode = 'working' | 'staged' | 'head' | 'main';