/**
 * Type definitions for dependency checking
 */

export interface DependencyCheckResult {
    available: boolean;
    version?: string;
    path?: string;
    error?: string;
    installInstructions?: string;
}

export class DependencyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DependencyError';
    }
}

export interface DependencyCheckResults {
    claude: DependencyCheckResult;
    python: DependencyCheckResult;
    wrapper: DependencyCheckResult;
    ngrok: DependencyCheckResult;
}

export interface DependencyStatus {
    allReady: boolean;
    issues: string[];
    successMessages: string[];
}