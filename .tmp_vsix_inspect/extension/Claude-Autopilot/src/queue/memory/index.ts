import * as vscode from 'vscode';
import { MessageItem } from '../../core/types';
import { messageQueue, setMessageQueue } from '../../core/state';
import { getValidatedConfig } from '../../core/config';
import { debugLog } from '../../utils/logging';
import { updateWebviewContent } from '../../ui/webview';

export interface QueueMemoryStats {
    totalMessages: number;
    completedMessages: number;
    pendingMessages: number;
    memoryUsageBytes: number;
    oldestMessageAge: number;
    needsCleanup: boolean;
}

export function getQueueMemoryStats(): QueueMemoryStats {
    const now = Date.now();
    const completed = messageQueue.filter(msg => msg.status === 'completed');
    const pending = messageQueue.filter(msg => msg.status === 'pending');
    
    // Calculate approximate memory usage
    const memoryUsage = messageQueue.reduce((total, msg) => {
        return total + 
            (msg.text?.length || 0) + 
            (msg.output?.length || 0) + 
            (msg.error?.length || 0) + 
            200; // Base object overhead
    }, 0);
    
    const oldestMessage = messageQueue.length > 0 ? 
        Math.min(...messageQueue.map(msg => new Date(msg.timestamp).getTime())) : now;
    
    return {
        totalMessages: messageQueue.length,
        completedMessages: completed.length,
        pendingMessages: pending.length,
        memoryUsageBytes: memoryUsage,
        oldestMessageAge: now - oldestMessage,
        needsCleanup: messageQueue.length > getValidatedConfig().queue.cleanupThreshold
    };
}

export function enforceMessageSizeLimits(message: MessageItem): MessageItem {
    const config = getValidatedConfig();
    const limitedMessage = { ...message };
    
    // Truncate text if too large
    if (limitedMessage.text && limitedMessage.text.length > config.queue.maxMessageSize) {
        limitedMessage.text = limitedMessage.text.substring(0, config.queue.maxMessageSize - 100) + 
            '... [truncated due to size limit]';
        debugLog(`⚠️ Message text truncated to ${config.queue.maxMessageSize} characters`);
    }
    
    // Truncate output if too large
    if (limitedMessage.output && limitedMessage.output.length > config.queue.maxOutputSize) {
        limitedMessage.output = limitedMessage.output.substring(0, config.queue.maxOutputSize - 100) + 
            '... [truncated due to size limit]';
        debugLog(`⚠️ Message output truncated to ${config.queue.maxOutputSize} characters`);
    }
    
    // Truncate error if too large
    if (limitedMessage.error && limitedMessage.error.length > config.queue.maxErrorSize) {
        limitedMessage.error = limitedMessage.error.substring(0, config.queue.maxErrorSize - 100) + 
            '... [truncated due to size limit]';
        debugLog(`⚠️ Message error truncated to ${config.queue.maxErrorSize} characters`);
    }
    
    return limitedMessage;
}

export function enforceQueueSizeLimit(): void {
    const config = getValidatedConfig();
    
    if (messageQueue.length <= config.queue.maxSize) {
        return;
    }
    
    debugLog(`⚠️ Queue size limit exceeded: ${messageQueue.length}/${config.queue.maxSize}`);
    
    // Remove oldest completed messages first
    const completedMessages = messageQueue
        .map((msg, index) => ({ ...msg, originalIndex: index }))
        .filter(msg => msg.status === 'completed')
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    const messagesToRemove = messageQueue.length - config.queue.maxSize;
    const removedCount = Math.min(messagesToRemove, completedMessages.length);
    
    if (removedCount > 0) {
        const indicesToRemove = completedMessages
            .slice(0, removedCount)
            .map(msg => msg.originalIndex)
            .sort((a, b) => b - a); // Remove from end to start to maintain indices
        
        const newQueue = messageQueue.filter((_, index) => !indicesToRemove.includes(index));
        setMessageQueue(newQueue);
        
        debugLog(`🧹 Removed ${removedCount} oldest completed messages to enforce size limit`);
        vscode.window.showInformationMessage(`Queue cleanup: Removed ${removedCount} old completed messages`);
        updateWebviewContent();
    } else {
        // If no completed messages to remove, show warning but don't remove pending messages
        vscode.window.showWarningMessage(`Queue is full (${messageQueue.length} messages). Consider clearing completed messages.`);
    }
}

export function cleanupOldCompletedMessages(): number {
    const config = getValidatedConfig();
    const now = Date.now();
    const retentionMs = config.queue.retentionHours * 60 * 60 * 1000;
    
    const originalLength = messageQueue.length;
    const cleanedQueue = messageQueue.filter(msg => {
        if (msg.status !== 'completed') {
            return true; // Keep all non-completed messages
        }
        
        const messageAge = now - new Date(msg.timestamp).getTime();
        return messageAge < retentionMs;
    });
    
    const removedCount = originalLength - cleanedQueue.length;
    
    if (removedCount > 0) {
        setMessageQueue(cleanedQueue);
        debugLog(`🧹 Cleaned up ${removedCount} old completed messages (older than ${config.queue.retentionHours}h)`);
        updateWebviewContent();
    }
    
    return removedCount;
}

export function performQueueMaintenance(): void {
    debugLog('🔧 Performing queue maintenance...');
    
    const stats = getQueueMemoryStats();
    debugLog(`📊 Queue stats: ${stats.totalMessages} messages, ${Math.round(stats.memoryUsageBytes / 1024)}KB memory`);
    
    // Clean up old messages first
    const cleanedCount = cleanupOldCompletedMessages();
    
    // Enforce size limits
    enforceQueueSizeLimit();
    
    // Check if maintenance was effective
    const newStats = getQueueMemoryStats();
    
    if (newStats.needsCleanup) {
        vscode.window.showWarningMessage(
            `Queue still large after cleanup: ${newStats.totalMessages} messages. Consider manually clearing completed messages.`
        );
    }
    
    debugLog(`✅ Queue maintenance complete. Cleaned ${cleanedCount} old messages.`);
}

export function getMemoryUsageSummary(): string {
    const stats = getQueueMemoryStats();
    const memoryMB = (stats.memoryUsageBytes / (1024 * 1024)).toFixed(2);
    const oldestAgeHours = (stats.oldestMessageAge / (1000 * 60 * 60)).toFixed(1);
    
    return `Queue: ${stats.totalMessages} messages (${stats.completedMessages} completed, ${stats.pendingMessages} pending)\n` +
           `Memory: ~${memoryMB}MB\n` +
           `Oldest message: ${oldestAgeHours}h ago\n` +
           `Cleanup needed: ${stats.needsCleanup ? 'Yes' : 'No'}`;
}

// Automatic maintenance scheduling
let maintenanceTimer: NodeJS.Timeout | null = null;
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function startAutomaticMaintenance(): void {
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
    }
    
    maintenanceTimer = setInterval(() => {
        const config = getValidatedConfig();
        const stats = getQueueMemoryStats();
        if (stats.needsCleanup || stats.oldestMessageAge > config.queue.retentionHours * 60 * 60 * 1000) {
            performQueueMaintenance();
        }
    }, MAINTENANCE_INTERVAL_MS);
    
    debugLog('🔄 Started automatic queue maintenance (every 10 minutes)');
}

export function stopAutomaticMaintenance(): void {
    if (maintenanceTimer) {
        clearInterval(maintenanceTimer);
        maintenanceTimer = null;
        debugLog('⏹️ Stopped automatic queue maintenance');
    }
}