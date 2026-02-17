import * as vscode from 'vscode';

export function isDevelopmentMode(): boolean {
    // Check if running in development environment
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    const devMode = config.get<boolean>('developmentMode', false);
    
    // Also check if this is a debug/development build
    const isDebugBuild = process.env.NODE_ENV === 'development' || 
                        process.env.VSCODE_DEBUG_MODE === 'true';
    
    return devMode || isDebugBuild;
}

export function withDevelopmentMode<T>(developmentFn: () => T, productionFn?: () => T): T | undefined {
    if (isDevelopmentMode()) {
        return developmentFn();
    } else if (productionFn) {
        return productionFn();
    }
    return undefined;
}

export function developmentOnly(fn: () => void): void {
    if (isDevelopmentMode()) {
        fn();
    }
}