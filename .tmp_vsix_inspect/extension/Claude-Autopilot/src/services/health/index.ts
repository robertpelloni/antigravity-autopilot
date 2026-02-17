import * as vscode from 'vscode';
import { claudeProcess, sessionReady, processingQueue, currentMessage, healthCheckTimer, setSessionReady, setClaudeProcess, setProcessingQueue, setCurrentMessage, setHealthCheckTimer } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { updateWebviewContent, updateSessionState } from '../../ui/webview';
import { HEALTH_CHECK_INTERVAL_MS } from '../../core/constants';

export function isClaudeProcessHealthy(): boolean {
    if (!claudeProcess) {
        return false;
    }
    
    if (claudeProcess.killed || claudeProcess.exitCode !== null) {
        debugLog('❌ Claude process is killed or exited');
        return false;
    }
    
    if (!claudeProcess.stdin || claudeProcess.stdin.destroyed || !claudeProcess.stdin.writable) {
        debugLog('❌ Claude process stdin is not writable');
        return false;
    }
    
    return true;
}

export function startHealthCheck(): void {
    if (healthCheckTimer) {
        clearTimeout(healthCheckTimer);
    }
    
    const timer = setInterval(() => {
        if (sessionReady && !isClaudeProcessHealthy()) {
            debugLog('🩺 Health check failed - Claude process is unhealthy');
            
            setSessionReady(false);
            setClaudeProcess(null);
            
            if (processingQueue) {
                setProcessingQueue(false);
                
                if (currentMessage && currentMessage.status === 'processing') {
                    currentMessage.status = 'error';
                    currentMessage.error = 'Claude process became unhealthy';
                    setCurrentMessage(null);
                }
            }
            
            updateWebviewContent();
            updateSessionState();
            
            if (healthCheckTimer) {
                clearTimeout(healthCheckTimer);
                setHealthCheckTimer(null);
            }
            
            vscode.window.showWarningMessage('Claude process became unhealthy. Please restart the session.');
        }
    }, HEALTH_CHECK_INTERVAL_MS);
    
    setHealthCheckTimer(timer);
    debugLog('🩺 Started health monitoring for Claude process');
}

export function stopHealthCheck(): void {
    if (healthCheckTimer) {
        clearTimeout(healthCheckTimer);
        setHealthCheckTimer(null);
        debugLog('🩺 Stopped health monitoring');
    }
}