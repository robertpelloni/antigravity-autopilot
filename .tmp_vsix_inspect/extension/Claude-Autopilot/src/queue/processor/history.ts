import * as vscode from 'vscode';
import { HistoryRun, MessageItem } from '../../core/types';
import { extensionContext, currentRun, messageQueue, setCurrentRun } from '../../core/state';
import { claudePanel } from '../../core/state';
import { debugLog, getHistoryStorageKey, getPendingQueueStorageKey, getWorkspacePath } from '../../utils/logging';
import { showErrorFromException } from '../../utils/notifications';
import { DebugEmojis, formatDebugMessage } from '../../core/constants/ui-strings';
import { getValidatedConfig } from '../../core/config';
import { enforceMessageSizeLimits } from '../memory';


export function saveWorkspaceHistory(): void {
    if (!extensionContext || !currentRun) {
        debugLog(formatDebugMessage(DebugEmojis.WARNING, `Cannot save workspace history: ${!extensionContext ? 'no extension context' : 'no current run'}`));
        return;
    }
    
    // Check if auto-save is enabled
    const config = getValidatedConfig();
    if (!config.history.autoSave) {
        debugLog(formatDebugMessage(DebugEmojis.SAVE, 'History auto-save is disabled, skipping save'));
        return;
    }
    
    try {
        const storageKey = getHistoryStorageKey();
        const existingHistory = extensionContext.globalState.get<HistoryRun[]>(storageKey, []);
        
        // Apply size limits to messages before saving to history
        const sizeLimitedMessages = messageQueue.map(msg => enforceMessageSizeLimits(msg));
        
        currentRun.messages = [...sizeLimitedMessages];
        currentRun.totalMessages = messageQueue.length;
        currentRun.completedMessages = messageQueue.filter(m => m.status === 'completed').length;
        currentRun.errorMessages = messageQueue.filter(m => m.status === 'error').length;
        currentRun.waitingMessages = messageQueue.filter(m => m.status === 'waiting').length;
        
        // Update message status map
        currentRun.messageStatusMap = {};
        messageQueue.forEach(msg => {
            if (currentRun) {
            currentRun.messageStatusMap[msg.id] = msg.status;
        }
        });
        
        const existingIndex = existingHistory.findIndex(run => run.id === currentRun!.id);
        if (existingIndex >= 0) {
            existingHistory[existingIndex] = currentRun;
        } else {
            existingHistory.push(currentRun);
        }
        
        // Use the configuration for history limit
        const config = getValidatedConfig();
        const recentHistory = existingHistory.slice(-config.history.maxRuns);
        
        // Log memory cleanup if history was trimmed
        if (existingHistory.length > config.history.maxRuns) {
            const trimmedCount = existingHistory.length - config.history.maxRuns;
            debugLog(`🧹 Trimmed ${trimmedCount} old history runs to prevent memory bloat`);
        }
        
        extensionContext.globalState.update(storageKey, recentHistory);
        debugLog(`💾 Saved workspace history with ${recentHistory.length} runs`);
        
    } catch (error) {
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Failed to save workspace history: ${error}`));
        showErrorFromException(error, 'Failed to save workspace history');
    }
    
    // Always try to save pending queue regardless of history auto-save setting
    savePendingQueue();
}

export function loadWorkspaceHistory(): void {
    if (!extensionContext) return;
    
    const storageKey = getHistoryStorageKey();
    const history = extensionContext.globalState.get<HistoryRun[]>(storageKey, []);
    
    // Sort by startTime descending (newest first) instead of using reverse()
    const sortedHistory = [...history].sort((a, b) => 
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'historyLoaded',
                history: sortedHistory
            });
        } catch (error) {
            debugLog(`❌ Failed to send history to webview: ${error}`);
        }
    }
}

export function filterHistory(filter: string): void {
    if (!extensionContext) return;
    
    const storageKey = getHistoryStorageKey();
    const allHistory = extensionContext.globalState.get<HistoryRun[]>(storageKey, []);
    
    let filteredHistory = allHistory;
    
    switch (filter) {
        case 'waiting':
            filteredHistory = allHistory.filter(run => run.waitingMessages > 0);
            break;
        case 'completed':
            filteredHistory = allHistory.filter(run => run.completedMessages === run.totalMessages && run.totalMessages > 0);
            break;
        case 'errors':
            filteredHistory = allHistory.filter(run => run.errorMessages > 0);
            break;
        case 'recent':
            // Sort first, then take the 10 most recent
            const sortedForRecent = [...allHistory].sort((a, b) => 
                new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
            );
            filteredHistory = sortedForRecent.slice(0, 10);
            break;
        default:
            filteredHistory = allHistory;
    }
    
    // Sort filtered history by startTime descending (newest first)
    const sortedFilteredHistory = [...filteredHistory].sort((a, b) => 
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'historyFiltered',
                history: sortedFilteredHistory,
                filter: filter
            });
        } catch (error) {
            debugLog(`❌ Failed to send filtered history to webview: ${error}`);
        }
    }
}

export function startNewHistoryRun(): void {
    if (!extensionContext) return;
    
    // Before creating a new run, mark any ongoing runs as incomplete
    markIncompleteRuns();
    
    const run: HistoryRun = {
        id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        startTime: new Date().toISOString(),
        workspacePath: getWorkspacePath(),
        messages: [],
        messageStatusMap: {},
        totalMessages: 0,
        completedMessages: 0,
        errorMessages: 0,
        waitingMessages: 0
    };
    setCurrentRun(run);
}

export function ensureHistoryRun(): void {
    if (!currentRun || currentRun.endTime) {
        startNewHistoryRun();
    }
}

export function updateMessageStatusInHistory(messageId: string, status: 'pending' | 'processing' | 'completed' | 'error' | 'waiting', output?: string, error?: string): void {
    if (!currentRun) {
        debugLog('⚠️ No active history run to update message status');
        return;
    }
    
    // Update in message status map
    currentRun.messageStatusMap[messageId] = status;
    
    // Find and update the actual message in the messages array
    const messageIndex = currentRun.messages.findIndex(m => m.id === messageId);
    if (messageIndex !== -1) {
        currentRun.messages[messageIndex].status = status;
        if (output !== undefined) {
            currentRun.messages[messageIndex].output = output;
        }
        if (error !== undefined) {
            currentRun.messages[messageIndex].error = error;
        }
        if (status === 'processing') {
            currentRun.messages[messageIndex].processingStartedAt = new Date().toISOString();
        }
        if (status === 'completed') {
            currentRun.messages[messageIndex].completedAt = new Date().toISOString();
        }
    }
    
    // Update counters based on status map
    const statusCounts = Object.values(currentRun.messageStatusMap).reduce((counts, s) => {
        counts[s] = (counts[s] || 0) + 1;
        return counts;
    }, {} as { [key: string]: number });
    
    currentRun.completedMessages = statusCounts.completed || 0;
    currentRun.errorMessages = statusCounts.error || 0;
    currentRun.waitingMessages = statusCounts.waiting || 0;
    
    debugLog(`📝 Updated message ${messageId} status to ${status} in history`);
    
    // Save updated history
    saveWorkspaceHistory();
}

export function endCurrentHistoryRun(): void {
    if (currentRun) {
        currentRun.endTime = new Date().toISOString();
        saveWorkspaceHistory();
        debugLog(`📋 History run ${currentRun.id} ended at ${currentRun.endTime}`);
    }
}

export function checkAndEndHistoryRunIfComplete(): void {
    if (!currentRun) return;
    
    // Don't auto-end if there are pending or processing messages
    const hasPendingOrProcessing = messageQueue.some(msg => 
        msg.status === 'pending' || msg.status === 'processing'
    );
    
    if (!hasPendingOrProcessing && messageQueue.length > 0) {
        // All messages are either completed, error, or waiting - end the run
        debugLog(`📋 All messages processed, ending current history run`);
        endCurrentHistoryRun();
    }
}

export function savePendingQueue(): void {
    if (!extensionContext) return;
    
    // Check if pending queue persistence is enabled
    const config = getValidatedConfig();
    if (!config.history.persistPendingQueue) {
        debugLog(`📋 Pending queue persistence is disabled, skipping save`);
        return;
    }
    
    const pendingMessages = messageQueue.filter(msg => 
        msg.status === 'pending' || msg.status === 'waiting'
    );
    
    const storageKey = getPendingQueueStorageKey();
    extensionContext.globalState.update(storageKey, pendingMessages);
}

export function loadPendingQueue(): void {
    if (!extensionContext) return;
    
    // Check if pending queue persistence is enabled
    const config = getValidatedConfig();
    if (!config.history.persistPendingQueue) {
        debugLog(`📋 Pending queue persistence is disabled, skipping load`);
        return;
    }
    
    const storageKey = getPendingQueueStorageKey();
    const pendingMessages = extensionContext.globalState.get<MessageItem[]>(storageKey, []);
    
    if (pendingMessages.length > 0) {
        messageQueue.splice(0, messageQueue.length, ...pendingMessages);
        vscode.window.showInformationMessage(`Restored ${pendingMessages.length} pending messages from previous session`);
    }
}

export function clearPendingQueue(): void {
    if (!extensionContext) return;
    
    const storageKey = getPendingQueueStorageKey();
    extensionContext.globalState.update(storageKey, []);
}

export function deleteHistoryRun(runId: string): void {
    if (!extensionContext) return;
    
    try {
        const storageKey = getHistoryStorageKey();
        const history = extensionContext.globalState.get<HistoryRun[]>(storageKey, []);
        
        const filteredHistory = history.filter(run => run.id !== runId);
        
        extensionContext.globalState.update(storageKey, filteredHistory);
        debugLog(`🗑️ Deleted history run ${runId}`);
        
        // Reload history to refresh the UI
        loadWorkspaceHistory();
        
    } catch (error) {
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Failed to delete history run: ${error}`));
        showErrorFromException(error, 'Failed to delete history run');
    }
}

export function deleteAllHistory(): void {
    if (!extensionContext) return;
    
    try {
        const storageKey = getHistoryStorageKey();
        extensionContext.globalState.update(storageKey, []);
        debugLog(`🗑️ Deleted all history`);
        
        // Reload history to refresh the UI
        loadWorkspaceHistory();
        
    } catch (error) {
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Failed to delete all history: ${error}`));
        showErrorFromException(error, 'Failed to delete all history');
    }
}

function markIncompleteRuns(): void {
    if (!extensionContext) return;
    
    try {
        const storageKey = getHistoryStorageKey();
        const history = extensionContext.globalState.get<HistoryRun[]>(storageKey, []);
        
        let hasChanges = false;
        
        // Find runs without endTime (ongoing runs) and mark them as incomplete
        history.forEach(run => {
            if (!run.endTime) {
                // Calculate run processing time: use the last completed message time as end time
                const messagesWithTimes = run.messages.filter(m => m.completedAt);
                if (messagesWithTimes.length > 0) {
                    const lastEnd = Math.max(...messagesWithTimes.map(m => new Date(m.completedAt!).getTime()));
                    run.endTime = new Date(lastEnd).toISOString();
                } else {
                    run.endTime = new Date().toISOString();
                }
                debugLog(`🔄 Marked incomplete run ${run.id} as ended (interrupted)`);
                hasChanges = true;
            }
        });
        
        // Add backward compatibility for processingStartedAt
        history.forEach(run => {
            run.messages.forEach(message => {
                if (!message.processingStartedAt && message.completedAt) {
                    // For backward compatibility, use completedAt as processingStartedAt
                    message.processingStartedAt = message.completedAt;
                    hasChanges = true;
                }
            });
        });
        
        // Save changes if any runs were marked as incomplete or updated for compatibility
        if (hasChanges) {
            extensionContext.globalState.update(storageKey, history);
            debugLog(`💾 Updated history with ${history.filter(r => r.endTime).length} completed runs`);
        }
        
    } catch (error) {
        debugLog(formatDebugMessage(DebugEmojis.ERROR, `Failed to mark incomplete runs: ${error}`));
    }
}