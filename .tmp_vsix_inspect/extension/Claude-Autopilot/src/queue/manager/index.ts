import * as vscode from 'vscode';
import { MessageItem } from '../../core/types';
import { messageQueue, claudePanel, processingQueue, sessionReady, setProcessingQueue, setIsRunning } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { updateWebviewContent } from '../../ui/webview';
import { processNextMessage } from '../../claude/communication';
import { enforceMessageSizeLimits, enforceQueueSizeLimit, performQueueMaintenance } from '../memory';
import { savePendingQueue } from '../processor/history';
import { generateMessageId } from '../../utils/id-generator';

export function removeMessageFromQueue(messageId: string): void {
    const index = messageQueue.findIndex(msg => msg.id === messageId);
    if (index >= 0) {
        messageQueue.splice(index, 1);
        updateWebviewContent();
        savePendingQueue(); // Save queue changes
        vscode.window.showInformationMessage('Message removed from queue');
    }
}

export function duplicateMessageInQueue(messageId: string): void {
    const message = messageQueue.find(msg => msg.id === messageId);
    if (message) {
        const duplicatedMessage: MessageItem = {
            id: generateMessageId(),
            text: message.text,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        
        // Smart insertion based on original message status
        if (message.status === 'completed') {
            // If duplicating a completed message, add at end of queue (after last pending)
            messageQueue.push(duplicatedMessage);
        } else {
            // If duplicating a processing/pending message, add after original
            const originalIndex = messageQueue.findIndex(msg => msg.id === messageId);
            messageQueue.splice(originalIndex + 1, 0, duplicatedMessage);
        }
        
        updateWebviewContent();
        savePendingQueue(); // Save queue changes
        
        // Try to auto-start processing if conditions are met
        tryAutoStartProcessing();
        
        vscode.window.showInformationMessage(`Message duplicated: ${message.text.substring(0, 50)}...`);
    }
}

export function editMessageInQueue(messageId: string, newText: string): void {
    debugLog(`EditMessageInQueue called with messageId: ${messageId}, newText: ${newText}`);
    const message = messageQueue.find(msg => msg.id === messageId);
    debugLog(`Found message: ${message ? message.text : 'not found'}`);
    
    if (message) {
        const oldText = message.text;
        message.text = newText;
        message.timestamp = new Date().toISOString(); // Update timestamp when edited
        
        debugLog(`Message edited from "${oldText}" to "${newText}"`);
        updateWebviewContent();
        savePendingQueue(); // Save queue changes
        vscode.window.showInformationMessage(`Message edited: ${oldText.substring(0, 30)}... → ${newText.substring(0, 30)}...`);
    } else {
        debugLog(`ERROR: Message with ID ${messageId} not found in queue`);
        vscode.window.showErrorMessage(`Message with ID ${messageId} not found`);
    }
}

export function reorderQueue(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= messageQueue.length || toIndex < 0 || toIndex >= messageQueue.length) {
        return;
    }
    
    const [movedItem] = messageQueue.splice(fromIndex, 1);
    messageQueue.splice(toIndex, 0, movedItem);
    
    updateWebviewContent();
    savePendingQueue();
}


export function clearMessageQueue(): void {
    messageQueue.length = 0;
    updateWebviewContent();
    savePendingQueue(); // Save queue changes (empty queue)
    vscode.window.showInformationMessage('Message queue cleared');
}

export function addMessageToQueueFromWebview(message: string): void {
    const messageItem: MessageItem = {
        id: generateMessageId(),
        text: message,
        timestamp: new Date().toISOString(),
        status: 'pending'
    };

    // Apply size limits to the new message
    const sizeLimitedMessage = enforceMessageSizeLimits(messageItem);
    
    messageQueue.push(sizeLimitedMessage);
    
    // Check and enforce queue size limits
    enforceQueueSizeLimit();
    
    updateWebviewContent();
    
    const hasWaitingMessages = messageQueue.some(msg => msg.status === 'waiting');
    if (hasWaitingMessages) {
        vscode.window.showInformationMessage(`Message added to queue (waiting for usage limit to reset): ${message.substring(0, 50)}...`);
    } else {
        vscode.window.showInformationMessage(`Message added to queue: ${message.substring(0, 50)}...`);
    }
    
    // Save pending queue after adding message
    savePendingQueue();
    
    // Auto-start processing if conditions are met
    tryAutoStartProcessing();
}

export function tryAutoStartProcessing(): void {
    const hasProcessingMessages = messageQueue.some(msg => msg.status === 'processing');
    const hasPendingMessages = messageQueue.some(msg => msg.status === 'pending');
    const hasWaitingMessages = messageQueue.some(msg => msg.status === 'waiting');
    
    debugLog(`🔍 Auto-start check: sessionReady=${sessionReady}, processingQueue=${processingQueue}, hasProcessing=${hasProcessingMessages}, hasPending=${hasPendingMessages}, hasWaiting=${hasWaitingMessages}`);
    
    // Auto-start processing if:
    // 1. Session is ready AND
    // 2. Either processing is already enabled OR this is the first message added to ready session
    // 3. No messages are currently being processed
    // 4. There are pending messages to process
    // 5. No waiting messages (avoid interference with usage limit waits)
    
    const shouldAutoStart = (
        sessionReady && 
        !hasProcessingMessages && 
        hasPendingMessages && 
        !hasWaitingMessages &&
        (processingQueue || (!processingQueue && messageQueue.filter(m => m.status !== 'waiting').length === 1))
    );
    
    if (shouldAutoStart) {
        if (!processingQueue) {
            debugLog('🚀 Auto-enabling processing for first message in ready session');
            setProcessingQueue(true);
            setIsRunning(true);
        }
        debugLog('🚀 Auto-starting queue processing - conditions met');
        setTimeout(() => {
            processNextMessage();
        }, 200);
    } else {
        debugLog('❌ Auto-start conditions not met - manual start required');
    }
}