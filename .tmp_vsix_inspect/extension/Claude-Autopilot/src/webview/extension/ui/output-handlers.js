// Terminal and Claude output processing and rendering
import { 
  CLAUDE_RENDER_THROTTLE_MS,
  getClaudeRenderThrottleMs,
  setDebugTerminalContent,
  setClaudeContent,
  setLastRenderedContent,
  setPendingClaudeOutput,
  setClaudeRenderTimer,
  setLastClaudeRenderTime,
  setLastParsedContent,
  setLastParsedHtml,
  resetClaudeOutputState,
  resetTerminalOutputState,
  appendDebugTerminalContent,
  getDebugTerminalContent,
  getClaudeContent,
  getLastRenderedContent,
  getPendingClaudeOutput,
  getClaudeRenderTimer,
  getLastClaudeRenderTime,
  getLastParsedContent,
  getLastParsedHtml,
  setLastContentHash,
  getLastContentHash
} from '../core/state.js';
import { createSafeElement } from '../security/validation.js';
import { parseAnsiToHtml } from '../utils/ansi-parser.js';
import { isDevelopmentMode } from '../core/state.js';

// Store terminal content separately
export function appendToTerminal(output) {
  try {
    const terminalContainer = document.getElementById('terminalContainer');
    let terminalOutput = terminalContainer.querySelector('.terminal-output');

    if (!terminalOutput) {
      terminalOutput = document.createElement('div');
      terminalOutput.className = 'terminal-output';
      terminalContainer.appendChild(terminalOutput);
    }

    // Clear the ready message on first output
    const readyMessage = terminalOutput.querySelector('.terminal-ready-message');
    if (readyMessage) {
      terminalOutput.innerHTML = '';
      setDebugTerminalContent('');
    }

    // Filter out Claude output debug messages (🤖 [CLAUDE timestamp])
    if (output.includes('🤖 [CLAUDE') && output.includes(']')) {
      // Skip Claude output messages in terminal section
      return;
    }

    // Add to debug terminal content (this is just debug info, so we append)
    appendDebugTerminalContent(output);

    // Parse ANSI escape codes for terminal output
    const htmlOutput = parseAnsiToHtml(getDebugTerminalContent());

    // Replace the entire content safely
    terminalOutput.innerHTML = '';
    const outputElement = document.createElement('div');
    outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
    outputElement.innerHTML = htmlOutput;
    terminalOutput.appendChild(outputElement);

    // Auto-scroll to bottom
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  } catch (error) {
    console.error('Error appending to terminal:', error);
  }
}

export function appendToClaudeOutput(output) {
  try {
    // Store the latest output
    setPendingClaudeOutput(output);
        
    // Check if we need to throttle (use dynamic throttling)
    const now = Date.now();
    const timeSinceLastRender = now - getLastClaudeRenderTime();
    const throttleMs = getClaudeRenderThrottleMs();
        
    if (timeSinceLastRender >= throttleMs) {
      // Enough time has passed, render immediately
      if (isDevelopmentMode) {
        console.log('🎨 Rendering Claude output immediately');
      }
      renderClaudeOutput();
    } else {
      // Schedule a delayed render if not already scheduled
      if (!getClaudeRenderTimer()) {
        const delay = throttleMs - timeSinceLastRender;
        if (isDevelopmentMode) {
          console.log(`⏰ Throttling Claude render for ${delay}ms`);
        }
        const timer = setTimeout(() => {
          renderClaudeOutput();
        }, delay);
        setClaudeRenderTimer(timer);
      } else {
        if (isDevelopmentMode) {
          console.log('🔄 Claude render already scheduled, updating pending output');
        }
      }
    }
  } catch (error) {
    console.error('Error appending to Claude output:', error);
  }
}

export function renderClaudeOutput() {
  if (!getPendingClaudeOutput()) {
    return;
  }
    
  const output = getPendingClaudeOutput();
  setPendingClaudeOutput(null);
  setLastClaudeRenderTime(Date.now());
    
  // Clear the timer
  if (getClaudeRenderTimer()) {
    clearTimeout(getClaudeRenderTimer());
    setClaudeRenderTimer(null);
  }
    
  if (isDevelopmentMode) {
    console.log(`🎨 Rendering Claude output (${output.length} chars)`);
  }
    
  // Now perform the actual rendering
  performClaudeRender(output);
}

export function performClaudeRender(output) {
  try {
    const claudeContainer = document.getElementById('claudeOutputContainer');
    let claudeOutput = claudeContainer.querySelector('.claude-live-output');

    if (!claudeOutput) {
      claudeOutput = document.createElement('div');
      claudeOutput.className = 'claude-live-output';
      claudeContainer.appendChild(claudeOutput);
    }

    // Clear the ready message on first output
    const readyMessage = claudeOutput.querySelector('.claude-ready-message');
    if (readyMessage) {
      claudeOutput.innerHTML = '';
      setClaudeContent('');
      setLastRenderedContent('');
            
      // Reset parsing cache
      setLastParsedContent('');
      setLastParsedHtml('');
    }

    // Check if this output contains screen clearing commands
    if (output.includes('\x1b[2J') || output.includes('\x1b[3J') || output.includes('\x1b[H')) {
      // Clear screen - replace entire content
      setClaudeContent(output);
      setLastRenderedContent(output);
      claudeOutput.innerHTML = '';
            
      // Reset cache since this is a new screen
      setLastParsedContent('');
      setLastParsedHtml('');
            
      // Parse and render the new content (remove clear screen codes after detection)
      const contentToRender = getClaudeContent().replace(/\x1b\[[2-3]J/g, '').replace(/\x1b\[H/g, '');
      const htmlOutput = parseAnsiToHtml(contentToRender);
      setLastParsedContent(output);
      setLastParsedHtml(htmlOutput);
            
      const outputElement = document.createElement('div');
      outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
      outputElement.innerHTML = htmlOutput;
      claudeOutput.appendChild(outputElement);
    } else {
      // No clear screen - this is the complete current screen content from backend
      // Create content hash for more efficient change detection
      const contentHash = output.length + '_' + (output.slice(0, 100) + output.slice(-100));
      
      // Only update if content has actually changed (using hash for efficiency)
      if (contentHash !== getLastContentHash()) {
        setClaudeContent(output);
        setLastRenderedContent(output);
                
        // Use cached parsing if content hasn't changed significantly
        let htmlOutput;
        if (output === getLastParsedContent() && getLastParsedHtml()) {
          htmlOutput = getLastParsedHtml();
          if (isDevelopmentMode) {
            console.log('📋 Using cached ANSI parsing result');
          }
        } else {
          // Parse and cache the result
          htmlOutput = parseAnsiToHtml(getClaudeContent());
          setLastParsedContent(output);
          setLastParsedHtml(htmlOutput);
          if (isDevelopmentMode) {
            console.log('🔄 Parsing ANSI content');
          }
        }
                
        // Optimize DOM updates - only update if HTML content actually changed
        let existingElement = claudeOutput.querySelector('.claude-content');
        if (!existingElement) {
          // First time setup
          claudeOutput.innerHTML = '';
          existingElement = document.createElement('div');
          existingElement.className = 'claude-content';
          existingElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
          claudeOutput.appendChild(existingElement);
        }
        
        // Only update DOM if content actually changed
        if (existingElement.innerHTML !== htmlOutput) {
          existingElement.innerHTML = htmlOutput;
        }
        
        // Update content hash after successful render
        setLastContentHash(contentHash);
      } else {
        // Content hasn't changed, skip rendering
        return;
      }
    }

    // Auto-scroll to bottom
    claudeOutput.scrollTop = claudeOutput.scrollHeight;

    // Reduce visual effects in development mode to improve performance
    if (!isDevelopmentMode) {
      // Highlight the Claude output section briefly with new colors (only in normal mode)
      claudeOutput.style.borderColor = '#00ff88';
      claudeOutput.style.boxShadow = '0 0 20px rgba(0, 255, 136, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
      setTimeout(() => {
        claudeOutput.style.borderColor = '#4a9eff';
        claudeOutput.style.boxShadow = '0 0 20px rgba(74, 158, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)';
      }, 800);
    }
  } catch (error) {
    console.error('Error performing Claude render:', error);
  }
}

export function clearClaudeOutput() {
  try {
    const claudeContainer = document.getElementById('claudeOutputContainer');
    let claudeOutput = claudeContainer.querySelector('.claude-live-output');
    if (claudeOutput) {
      claudeOutput.innerHTML = '';
      const readyMessage = createSafeElement('div', '', 'claude-ready-message');
      const pulseDiv = createSafeElement('div', '', 'pulse-dot');
      const messageSpan = createSafeElement('span', 'Output cleared - ready for new Claude output...', '');
      const contentDiv = document.createElement('div');
      contentDiv.style.cssText = 'display: flex; align-items: center; gap: 8px;';
      contentDiv.appendChild(pulseDiv);
      contentDiv.appendChild(messageSpan);
      readyMessage.appendChild(contentDiv);
      claudeOutput.appendChild(readyMessage);
            
      // Reset content tracking
      resetClaudeOutputState();
    }
  } catch (error) {
    console.error('Error clearing Claude output:', error);
  }
}

export function clearClaudeOutputUI() {
  // Same as clearClaudeOutput but called from backend
  clearClaudeOutput();
  if (isDevelopmentMode) {
    console.log('Claude output auto-cleared by backend');
  }
}

// Cleanup function to flush any pending Claude output before page closes
export function flushPendingClaudeOutput() {
  if (getClaudeRenderTimer()) {
    clearTimeout(getClaudeRenderTimer());
    setClaudeRenderTimer(null);
  }
  if (getPendingClaudeOutput()) {
    performClaudeRender(getPendingClaudeOutput());
    setPendingClaudeOutput(null);
  }
    
  // Reset parsing cache
  setLastParsedContent('');
  setLastParsedHtml('');
}