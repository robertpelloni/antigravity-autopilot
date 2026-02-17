import * as vscode from 'vscode';
import { claudePanel, debugMode } from '../../core/state';

export function debugLog(message: string): void {
    if (debugMode) {
        const formattedMessage = formatTerminalOutput(message, 'debug');
        console.log(formattedMessage);
        sendToWebviewTerminal(formattedMessage + '\n');
    }
}

export function formatTerminalOutput(text: string, type: 'claude' | 'debug' | 'error' | 'info' | 'success'): string {
    const now = new Date();
    const timestamp = `${now.toLocaleTimeString()}.${now.getMilliseconds().toString().padStart(3, '0')}`;
    
    switch (type) {
        case 'claude':
            return `\n\u001b[36m🤖 [CLAUDE ${timestamp}]\u001b[0m\n\u001b[37m${text}\u001b[0m\n\u001b[36m>>> [END CLAUDE OUTPUT]\u001b[0m\n`;
        case 'debug':
            return `\u001b[35m[DEBUG ${timestamp}]\u001b[0m \u001b[90m${text}\u001b[0m`;
        case 'error':
            return `\u001b[31m❌ [ERROR ${timestamp}]\u001b[0m \u001b[91m${text}\u001b[0m`;
        case 'info':
            return `\u001b[34mℹ️  [INFO ${timestamp}]\u001b[0m \u001b[94m${text}\u001b[0m`;
        case 'success':
            return `\u001b[32m✅ [SUCCESS ${timestamp}]\u001b[0m \u001b[92m${text}\u001b[0m`;
        default:
            return `[${timestamp}] ${text}`;
    }
}

export function sendToWebviewTerminal(output: string): void {
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'terminalOutput',
                output: output
            });
        } catch (error) {
            console.error(`❌ Failed to send to webview terminal: ${error}`);
        }
    }
}

export function getWorkspacePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath || 'global';
}

export function getHistoryStorageKey(): string {
    return `claudeautopilot_history_${getWorkspacePath().replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export function getPendingQueueStorageKey(): string {
    return `claudeautopilot_pending_${getWorkspacePath().replace(/[^a-zA-Z0-9]/g, '_')}`;
}