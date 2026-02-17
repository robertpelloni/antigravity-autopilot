import * as vscode from 'vscode';
import { MessageItem } from '../../core/types';
import { messageQueue, claudeProcess, sessionReady, processingQueue, currentMessage, setCurrentMessage, setProcessingQueue, setIsRunning } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { getErrorMessage } from '../../utils/error-handler';
import { updateWebviewContent, updateSessionState } from '../../ui/webview';
import { saveWorkspaceHistory, ensureHistoryRun, updateMessageStatusInHistory, checkAndEndHistoryRunIfComplete } from '../../queue/processor/history';
import { TIMEOUT_MS, ANSI_CLEAR_SCREEN_PATTERNS } from '../../core/constants';
import { startClaudeSession } from '../../claude/session';
import { getMobileServer } from '../../services/mobile/index';

// Debouncing for repeated debug messages
let lastOutputLogTime = 0;
let outputLogCount = 0;
let lastClearScreenLogTime = 0;
let clearScreenLogCount = 0;
const OUTPUT_LOG_DEBOUNCE_MS = 1000; // Only log once per second
const CLEAR_SCREEN_LOG_DEBOUNCE_MS = 1000; // Only log once per second

export async function processNextMessage(): Promise<void> {
    debugLog('--- PROCESSING NEXT MESSAGE ---');
    
    if (!processingQueue) {
        debugLog('Processing stopped by user');
        updateWebviewContent();
        updateSessionState();
        return;
    }
    
    if (messageQueue.length === 0) {
        debugLog('Queue empty - waiting for new messages (processing remains active)');
        updateWebviewContent();
        updateSessionState();
        vscode.window.showInformationMessage('All messages processed. Claude session remains active. Add messages to continue.');
        debugLog('✓ All messages processed - ready for new messages');
        return;
    }

    const message = messageQueue.find(m => m.status === 'pending');
    if (!message) {
        debugLog('No pending messages found - processing remains active for new messages');
        // Check if we should end the current history run since queue is complete
        checkAndEndHistoryRunIfComplete();
        updateWebviewContent();
        updateSessionState();
        vscode.window.showInformationMessage('No pending messages to process. Processing remains active.');
        return;
    }

    if (!claudeProcess) {
        debugLog('❌ Claude process not available');
        vscode.window.showWarningMessage('Claude session not started. Please start Claude session first.');
        setProcessingQueue(false);
        setIsRunning(false);
        return;
    }

    if (!sessionReady) {
        debugLog('❌ Claude session not ready - waiting for session to become ready...');
        
        // Wait for session to become ready instead of stopping processing
        const waitForReady = setInterval(() => {
            if (sessionReady) {
                clearInterval(waitForReady);
                processNextMessage();
            }
        }, 1000);
        
        // Timeout after 30 seconds
        setTimeout(() => {
            clearInterval(waitForReady);
            if (!sessionReady) {
                debugLog('❌ Timeout waiting for session to be ready');
                vscode.window.showWarningMessage('Claude session failed to become ready. Please restart the session.');
                setProcessingQueue(false);
                setIsRunning(false);
            }
        }, 30000);
        
        return;
    }

    debugLog(`📋 Processing message #${message.id}: ${message.text.substring(0, 50)}...`);
    message.status = 'processing';
    message.processingStartedAt = new Date().toISOString();
    updateMessageStatusInHistory(message.id, 'processing');
    setCurrentMessage(message);
    updateWebviewContent();
    saveWorkspaceHistory();
    
    // Notify mobile clients of queue update
    try {
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyQueueUpdate();
        }
    } catch (error) {
        // Silently fail if mobile service isn't available
    }

    try {
        debugLog('⏰ Claude is ready, sending message...');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await sendMessageToClaudeProcess(message);
        
        debugLog('⏰ Waiting for Claude to process message and show prompt...');
        await waitForPrompt();
        
        debugLog(`✓ Message #${message.id} completed`);
        message.status = 'completed';
        message.completedAt = new Date().toISOString();
        updateMessageStatusInHistory(message.id, 'completed');
        updateWebviewContent();
        saveWorkspaceHistory();
        
        // Notify mobile clients of queue update
        try {
            const mobileServer = getMobileServer();
            if (mobileServer.isRunning()) {
                mobileServer.notifyQueueUpdate();
            }
        } catch (error) {
            // Silently fail if mobile service isn't available
        }
        
        setTimeout(() => {
            debugLog('Processing next message after delay...');
            processNextMessage();
        }, 1000);
        
    } catch (error) {
        debugLog(`❌ Error processing message #${message.id}: ${error}`);
        
        const errorString = getErrorMessage(error);
        
        message.status = 'error';
        message.error = `Processing failed: ${errorString}`;
        updateMessageStatusInHistory(message.id, 'error', undefined, message.error);
        updateWebviewContent();
        saveWorkspaceHistory();
        
        // Notify mobile clients of queue update
        try {
            const mobileServer = getMobileServer();
            if (mobileServer.isRunning()) {
                mobileServer.notifyQueueUpdate();
            }
        } catch (error) {
            // Silently fail if mobile service isn't available
        }
        
        setTimeout(() => {
            processNextMessage();
        }, 1000);
    }
}

export async function sendMessageToClaudeProcess(message: MessageItem, retryCount: number = 0): Promise<void> {
    const maxRetries = 3;
    
    if (!claudeProcess || !claudeProcess.stdin) {
        if (retryCount < maxRetries) {
            debugLog(`❌ Claude process not available, attempting to restart (retry ${retryCount + 1}/${maxRetries})`);
            
            // Apply progressive delay for retries
            const retryDelay = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s
            debugLog(`⏳ Waiting ${retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            await startClaudeSession(true);
            
            await new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (sessionReady && claudeProcess) {
                        clearInterval(checkInterval);
                        resolve(void 0);
                    }
                }, 1000);
                
                setTimeout(() => {
                    clearInterval(checkInterval);
                    reject(new Error('Claude session restart timeout'));
                }, 30000);
            });
            
            return sendMessageToClaudeProcess(message, retryCount + 1);
        } else {
            throw new Error(`Claude process not available after ${maxRetries} retries`);
        }
    }

    try {
        // Log message details for debugging
        const messagePreview = message.text.length > 100 
            ? message.text.substring(0, 100) + '...' 
            : message.text;
        const hasNewlines = message.text.includes('\n');
        const lineCount = message.text.split('\n').length;
        
        debugLog(`📝 Sending message to Claude process:`);
        debugLog(`   Preview: "${messagePreview}"`);
        debugLog(`   Length: ${message.text.length} chars`);
        debugLog(`   Has newlines: ${hasNewlines} (${lineCount} lines)`);
        
        if (claudeProcess.stdin.destroyed || !claudeProcess.stdin.writable) {
            throw new Error('Claude process stdin is not writable');
        }
        
        // Calculate message size and chunks
        const messageBytes = Buffer.byteLength(message.text, 'utf8');
        const chunks = Math.ceil(messageBytes / 1024);
        debugLog(`📝 Message size: ${messageBytes} bytes (${chunks} chunks)`);
        
        // Send message in chunks to prevent \r from being included in the same PTY read
        const CHUNK_SIZE = 1024;
        const messageBuffer = Buffer.from(message.text, 'utf8');
        
        for (let i = 0; i < messageBuffer.length; i += CHUNK_SIZE) {
            const chunk = messageBuffer.subarray(i, Math.min(i + CHUNK_SIZE, messageBuffer.length));
            
            await new Promise<void>((resolve, reject) => {
                if (!claudeProcess || !claudeProcess.stdin) {
                    reject(new Error('Claude process not available'));
                    return;
                }
                claudeProcess.stdin.write(chunk, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            
            // Wait for chunk to be processed by PTY
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        debugLog(`📝 Message sent in ${chunks} chunks`);
        
        // Extra wait to ensure last chunk is fully processed
        await new Promise(resolve => setTimeout(resolve, 300));
        
        debugLog(`📝 Sending carriage return to submit message...`);
        
        if (!claudeProcess || !claudeProcess.stdin) {
            throw new Error('Claude process stdin became unavailable');
        }
        
        if (claudeProcess.stdin.destroyed || !claudeProcess.stdin.writable) {
            throw new Error('Claude process stdin is not writable');
        }
        
        // Send carriage return as a completely separate operation
        await new Promise<void>((resolve, reject) => {
            if (!claudeProcess || !claudeProcess.stdin) {
                reject(new Error('Claude process not available'));
                return;
            }
            claudeProcess.stdin.write('\r', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        
        debugLog(`✓ Message sent to Claude process successfully`);
        
    } catch (error) {
        debugLog(`❌ Error sending message to Claude: ${error}`);
        
        if (retryCount < maxRetries) {
            debugLog(`🔄 Retrying message send (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return sendMessageToClaudeProcess(message, retryCount + 1);
        } else {
            throw new Error(`Failed to send message after ${maxRetries} retries: ${error}`);
        }
    }
}

function waitForPrompt(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!claudeProcess || !claudeProcess.stdout) {
            reject(new Error('Claude process not available'));
            return;
        }

        let dataListener: ((data: Buffer) => void) | null = null;
        let lastOutputTime = Date.now();
        let screenAnalysisTimer: NodeJS.Timeout | null = null;
        let waitingForPermission = false;
        let currentScreenBuffer = '';
        const SCREEN_ANALYSIS_INTERVAL_MS = 500;
        const DEBOUNCE_THRESHOLD_MS = 1000;

        const readyPatterns = [
            /\? for shortcuts/,
            /\\u001b\[2m\\u001b\[38;5;244m│\\u001b\[39m\\u001b\[22m\s>/,
            />\s*$/,
        ];

        const permissionPrompts = [
            'Do you want to make this edit to',
            'Do you want to create',
            'Do you want to delete',
            'Do you want to read',
            'Would you like to',
            'Proceed with',
            'Continue?'
        ];

        const timeout = setTimeout(() => {
            debugLog(`❌ Timeout after ${TIMEOUT_MS / 1000}s waiting for Claude to be ready`);
            cleanup();
            reject(new Error('Timeout waiting for Claude to finish processing'));
        }, TIMEOUT_MS);

        const cleanup = () => {
            if (dataListener && claudeProcess?.stdout) {
                claudeProcess.stdout.removeListener('data', dataListener);
            }
            if (screenAnalysisTimer) {
                clearTimeout(screenAnalysisTimer);
            }
            clearTimeout(timeout);
        };

        const analyzeCurrentScreen = () => {
            const timeSinceLastOutput = Date.now() - lastOutputTime;
            debugLog(`🔍 Analyzing screen (${currentScreenBuffer.length} chars, ${timeSinceLastOutput}ms since last output)`);
            
            if (waitingForPermission) {
                if (currentScreenBuffer.includes('? for shortcuts')) {
                    debugLog(`✅ Permission resolved - back to normal processing`);
                    waitingForPermission = false;
                } else {
                    debugLog(`🔐 Still waiting for permission response`);
                    screenAnalysisTimer = setTimeout(analyzeCurrentScreen, SCREEN_ANALYSIS_INTERVAL_MS);
                    return;
                }
            }
            
            const hasPermissionPrompt = permissionPrompts.some(prompt => 
                currentScreenBuffer.includes(prompt)
            );
            
            if (hasPermissionPrompt && !waitingForPermission) {
                debugLog(`🔐 Permission prompt detected in screen analysis`);
                waitingForPermission = true;
                vscode.window.showInformationMessage('Claude is asking for permission. Use the Claude output area to navigate and select your choice.');
                screenAnalysisTimer = setTimeout(analyzeCurrentScreen, SCREEN_ANALYSIS_INTERVAL_MS);
                return;
            }
            
            const isReady = readyPatterns.some(pattern => {
                const jsonScreen = JSON.stringify(currentScreenBuffer);
                return pattern.test(jsonScreen) || pattern.test(currentScreenBuffer);
            });
            
            if (isReady && timeSinceLastOutput >= DEBOUNCE_THRESHOLD_MS) {
                debugLog(`✅ Claude is ready! Pattern detected and ${timeSinceLastOutput}ms of stability`);
                cleanup();
                resolve();
            } else if (isReady) {
                debugLog(`⏳ Ready pattern detected but waiting for stability (${timeSinceLastOutput}ms < ${DEBOUNCE_THRESHOLD_MS}ms)`);
                screenAnalysisTimer = setTimeout(analyzeCurrentScreen, SCREEN_ANALYSIS_INTERVAL_MS);
            } else {
                debugLog(`⏱️  No ready pattern detected, continuing analysis`);
                screenAnalysisTimer = setTimeout(analyzeCurrentScreen, SCREEN_ANALYSIS_INTERVAL_MS);
            }
        };

        dataListener = (data: Buffer) => {
            const output = data.toString();
            // Debounce output debug messages to prevent spam
            const now = Date.now();
            if (now - lastOutputLogTime >= OUTPUT_LOG_DEBOUNCE_MS) {
                if (outputLogCount > 0) {
                    debugLog(`📤 Claude output (${data.length} bytes) - ${outputLogCount + 1} outputs in last second`);
                } else {
                    debugLog(`📤 Claude output (${data.length} bytes)`);
                }
                lastOutputLogTime = now;
                outputLogCount = 0;
            } else {
                outputLogCount++;
            }
            
            let foundClearScreen = false;
            for (const pattern of ANSI_CLEAR_SCREEN_PATTERNS) {
                if (output.includes(pattern)) {
                    foundClearScreen = true;
                    break;
                }
            }
            
            if (foundClearScreen) {
                currentScreenBuffer = output;
                // Debounce clear screen debug messages to prevent spam
                const now = Date.now();
                if (now - lastClearScreenLogTime >= CLEAR_SCREEN_LOG_DEBOUNCE_MS) {
                    if (clearScreenLogCount > 0) {
                        debugLog(`🖥️  Clear screen detected - reset screen buffer (${clearScreenLogCount + 1} times in last second)`);
                    } else {
                        debugLog(`🖥️  Clear screen detected - reset screen buffer`);
                    }
                    lastClearScreenLogTime = now;
                    clearScreenLogCount = 0;
                } else {
                    clearScreenLogCount++;
                }
            } else {
                currentScreenBuffer += output;
                
                if (currentScreenBuffer.length > 50000) {
                    currentScreenBuffer = currentScreenBuffer.slice(-40000);
                    debugLog(`📋 Screen buffer trimmed to prevent memory issues`);
                }
            }
            
            lastOutputTime = Date.now();
        };

        claudeProcess.stdout.on('data', dataListener);
        
        screenAnalysisTimer = setTimeout(analyzeCurrentScreen, SCREEN_ANALYSIS_INTERVAL_MS);
    });
}

export async function startProcessingQueue(skipPermissions: boolean = true): Promise<void> {
    debugLog(`🚀 startProcessingQueue called with skipPermissions=${skipPermissions}`);
    
    // Start history tracking when processing begins (this is the meaningful start of a session)
    ensureHistoryRun();
    
    if (!claudeProcess) {
        vscode.window.showInformationMessage('Starting Claude session...');
        await startClaudeSession(skipPermissions);
        
        if (messageQueue.length > 0) {
            const checkReadyInterval = setInterval(() => {
                if (sessionReady) {
                    clearInterval(checkReadyInterval);
                    setProcessingQueue(true);
                    setIsRunning(true);
                    updateSessionState();
                    processNextMessage();
                }
            }, 1000);
            
            setTimeout(() => {
                clearInterval(checkReadyInterval);
                if (!sessionReady) {
                    vscode.window.showErrorMessage('Claude session failed to start. Please check your Claude CLI installation.');
                }
            }, 30000);
        }
        
        return;
    }

    setProcessingQueue(true);
    setIsRunning(true);
    updateSessionState();
    
    if (messageQueue.length === 0) {
        vscode.window.showInformationMessage('Claude session is ready. Add messages to start processing.');
        return;
    }

    processNextMessage();
}

export function stopProcessingQueue(): void {
    setProcessingQueue(false);
    setIsRunning(false);
    setCurrentMessage(null);
    
    if (claudeProcess && claudeProcess.stdin) {
        debugLog('⌨️ Sending ESC to Claude to cancel current operation');
        claudeProcess.stdin.write('\x1b');
    }
    
    // Check if we should end the current history run when processing is manually stopped
    checkAndEndHistoryRunIfComplete();
    
    updateWebviewContent();
    updateSessionState();
    vscode.window.showInformationMessage('Processing stopped. Claude session remains active.');
}