import { claudePanel, claudeOutputBuffer, claudeCurrentScreen, claudeOutputTimer, claudeAutoClearTimer, lastClaudeOutputTime, setClaudeOutputBuffer, setClaudeCurrentScreen, setClaudeOutputTimer, setClaudeAutoClearTimer, setLastClaudeOutputTime } from '../../core/state';
import { CLAUDE_OUTPUT_THROTTLE_MS, CLAUDE_OUTPUT_AUTO_CLEAR_MS, CLAUDE_OUTPUT_MAX_BUFFER_SIZE, ANSI_CLEAR_SCREEN_PATTERNS } from '../../core/constants';
import { debugLog, formatTerminalOutput, sendToWebviewTerminal } from '../../utils/logging';
import { getMobileServer } from '../../services/mobile/index';

// Debouncing for repeated debug messages
let lastClearScreenLogTime = 0;
let clearScreenLogCount = 0;
const CLEAR_SCREEN_LOG_DEBOUNCE_MS = 1000; // Only log once per second

export function sendClaudeOutput(output: string): void {
    setClaudeOutputBuffer(claudeOutputBuffer + output);
    
    if (claudeOutputBuffer.length > CLAUDE_OUTPUT_MAX_BUFFER_SIZE) {
        debugLog(`📦 Buffer too large (${claudeOutputBuffer.length} chars), truncating...`);
        setClaudeOutputBuffer(claudeOutputBuffer.substring(claudeOutputBuffer.length - (CLAUDE_OUTPUT_MAX_BUFFER_SIZE * 0.75)));
    }
    
    let foundClearScreen = false;
    let lastClearScreenIndex = -1;
    
    for (const pattern of ANSI_CLEAR_SCREEN_PATTERNS) {
        const index = claudeOutputBuffer.lastIndexOf(pattern);
        if (index > lastClearScreenIndex) {
            lastClearScreenIndex = index;
            foundClearScreen = true;
        }
    }
    
    if (foundClearScreen) {
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
        
        const newScreen = claudeOutputBuffer.substring(lastClearScreenIndex);
        setClaudeCurrentScreen(newScreen);
        setClaudeOutputBuffer(claudeCurrentScreen);
    } else {
        setClaudeCurrentScreen(claudeOutputBuffer);
    }
    
    const now = Date.now();
    const timeSinceLastOutput = now - lastClaudeOutputTime;
    
    if (timeSinceLastOutput >= CLAUDE_OUTPUT_THROTTLE_MS) {
        flushClaudeOutput();
    } else {
        if (!claudeOutputTimer) {
            const delay = CLAUDE_OUTPUT_THROTTLE_MS - timeSinceLastOutput;
            setClaudeOutputTimer(setTimeout(() => {
                flushClaudeOutput();
            }, delay));
        }
    }
    
    if (!claudeAutoClearTimer) {
        setClaudeAutoClearTimer(setTimeout(() => {
            clearClaudeOutput();
        }, CLAUDE_OUTPUT_AUTO_CLEAR_MS));
    }
}

export function flushClaudeOutput(): void {
    if (claudeCurrentScreen.length === 0) {
        return;
    }
    
    const output = claudeCurrentScreen;
    setLastClaudeOutputTime(Date.now());
    
    if (claudeOutputTimer) {
        clearTimeout(claudeOutputTimer);
        setClaudeOutputTimer(null);
    }
    
    debugLog(`📤 Sending Claude current screen (${output.length} chars)`);
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'claudeOutput',
                output: output
            });
        } catch (error) {
            debugLog(`❌ Failed to send Claude output to webview: ${error}`);
        }
    }
    
    const formattedOutput = formatTerminalOutput(output, 'claude');
    sendToWebviewTerminal(formattedOutput);
    
    // Notify mobile clients if mobile server is running
    try {
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyOutputUpdate();
        }
    } catch (error) {
        debugLog(`⚠️ Failed to notify mobile server of output update: ${error}`);
    }
}

export function clearClaudeOutput(): void {
    debugLog(`🧹 Auto-clearing Claude output buffer (${claudeCurrentScreen.length} chars)`);
    
    setClaudeOutputBuffer('');
    setClaudeCurrentScreen('');
    
    if (claudeOutputTimer) {
        clearTimeout(claudeOutputTimer);
        setClaudeOutputTimer(null);
    }
    if (claudeAutoClearTimer) {
        clearTimeout(claudeAutoClearTimer);
        setClaudeAutoClearTimer(null);
    }
}