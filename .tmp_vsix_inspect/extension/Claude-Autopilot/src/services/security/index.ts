import * as vscode from 'vscode';
import { claudePanel } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { getValidatedConfig } from '../../core/config';

export function sendSecuritySettings(): void {
    const config = getValidatedConfig();
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'setSecuritySettings',
                allowDangerousXssbypass: config.security.allowDangerousXssbypass
            });
            
            // Show warning if XSS bypass is enabled
            if (config.security.allowDangerousXssbypass) {
                vscode.window.showWarningMessage(
                    '⚠️ SECURITY WARNING: XSS bypass is enabled! This allows potentially dangerous content in messages. Only continue if you trust all message content.',
                    'I Understand the Risk',
                    'Disable XSS Bypass'
                ).then(selection => {
                    if (selection === 'Disable XSS Bypass') {
                        const workspaceConfig = vscode.workspace.getConfiguration('claudeAutopilot');
                        workspaceConfig.update('security.allowDangerousXssbypass', false, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage('XSS bypass has been disabled for security.');
                        // Send updated setting
                        setTimeout(() => sendSecuritySettings(), 100);
                    }
                });
            }
        } catch (error) {
            debugLog(`❌ Failed to send security settings to webview: ${error}`);
        }
    }
}

export function toggleXssbypassSetting(enabled: boolean): void {
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    config.update('security.allowDangerousXssbypass', enabled, vscode.ConfigurationTarget.Global);
    debugLog(`🔒 XSS bypass setting updated: ${enabled}`);
    
    // Send updated setting to webview
    sendSecuritySettings();
}