// Session control functions - start, stop, reset, etc.
import { sessionState, updateSessionState } from '../core/state.js';
import { validateMessage } from '../security/validation.js';
import { 
  sendAddMessage, 
  sendStartProcessing, 
  sendStopProcessing, 
  sendClaudeKeypress, 
  sendResetSession, 
  sendOpenSettings 
} from '../communication/vscode-api.js';
import { showError } from '../utils/dom-helpers.js';
import { updateButtonStates } from './queue-manager.js';

export function addMessage() {
  try {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) {
      return;
    }

    const validation = validateMessage(message);
    if (!validation.valid) {
      showError(validation.error);
      return;
    }

    sendAddMessage(message);

    input.value = '';
  } catch (error) {
    console.error('Error adding message:', error);
    showError('Failed to add message');
  }
}

export function startProcessing() {
  try {
    console.log('Frontend: User clicked Start Processing');
    const skipPermissions = document.getElementById('skipPermissions').checked;
    updateSessionState({
      isProcessing: true,
      wasStopped: false, // Reset stopped state when starting
      justStarted: true
    });
        
    // Clear justStarted flag after 2 seconds
    setTimeout(() => {
      updateSessionState({ justStarted: false });
    }, 2000);
        
    updateButtonStates();
    sendStartProcessing(skipPermissions);
  } catch (error) {
    console.error('Error starting processing:', error);
    showError('Failed to start processing');
  }
}

export function stopProcessing() {
  try {
    console.log('Frontend: User clicked Stop Processing');
    updateSessionState({
      isProcessing: false,
      wasStopped: true // Mark that user manually stopped
    });
    updateButtonStates();
    sendStopProcessing();
  } catch (error) {
    console.error('Error stopping processing:', error);
    showError('Failed to stop processing');
  }
}

export function interruptClaude() {
  try {
    console.log('Frontend: User clicked Interrupt (ESC)');
    sendClaudeKeypress('escape');
  } catch (error) {
    console.error('Error interrupting Claude:', error);
  }
}

export function resetSession() {
  try {
    updateSessionState({
      isSessionRunning: false,
      isProcessing: false,
      wasStopped: false // Reset stopped state on session reset
    });
    updateButtonStates();
    sendResetSession();
  } catch (error) {
    console.error('Error resetting session:', error);
    showError('Failed to reset session');
  }
}

export function openSettings() {
  try {
    sendOpenSettings();
  } catch (error) {
    console.error('Error opening settings:', error);
  }
}

// Handle session state updates from backend
export function handleSessionStateChanged(message) {
  console.log('Backend state update:', {
    backendSessionRunning: message.isSessionRunning,
    backendProcessing: message.isProcessing,
    frontendWasStopped: sessionState.wasStopped,
    frontendProcessing: sessionState.isProcessing,
    justStarted: sessionState.justStarted
  });
        
  updateSessionState({ isSessionRunning: message.isSessionRunning });
        
  // If processing finished naturally (backend says processing stopped but user didn't click stop), 
  // reset wasStopped so it goes back to auto-processing mode
  if (sessionState.isProcessing && !message.isProcessing && !sessionState.wasStopped) {
    // Processing finished naturally - keep wasStopped as false
    updateSessionState({ wasStopped: false });
  }
        
  // Don't override wasStopped if user just clicked start and backend hasn't caught up yet
  if (sessionState.wasStopped && message.isProcessing) {
    // User clicked start, backend is now processing - reset wasStopped
    updateSessionState({ wasStopped: false });
  }
        
  // Don't override frontend processing state if user just clicked start
  if (!sessionState.justStarted) {
    updateSessionState({ isProcessing: message.isProcessing });
  } else if (message.isProcessing) {
    // Backend caught up and is processing - good to sync
    updateSessionState({ 
      isProcessing: message.isProcessing,
      justStarted: false 
    });
  }
        
  updateButtonStates();
}