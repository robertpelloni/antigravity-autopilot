// Development and debug tools
import { isDevelopmentMode, setIsDevelopmentMode } from '../core/state.js';
import { 
  sendSimulateUsageLimit, 
  sendClearAllTimers, 
  sendDebugQueueState, 
  sendToggleDebugLogging,
  sendGetDevelopmentModeSetting 
} from '../communication/vscode-api.js';

// Debug functions
export function simulateUsageLimit() {
  sendSimulateUsageLimit();
}

export function clearAllTimers() {
  sendClearAllTimers();
}

export function debugQueueState() {
  sendDebugQueueState();
}

export function toggleDebugMode() {
  sendToggleDebugLogging();
}

// Show/hide development mode sections
export function updateDevelopmentModeUI(enabled) {
  setIsDevelopmentMode(enabled);
    
  const debugSection = document.getElementById('debugSection');
  const terminalSection = document.querySelector('.terminal-section');
    
  if (debugSection) {
    debugSection.style.display = enabled ? 'block' : 'none';
  }
    
  if (terminalSection) {
    terminalSection.style.display = enabled ? 'block' : 'none';
  }
}

export function requestDevelopmentModeSetting() {
  sendGetDevelopmentModeSetting();
}

// Export the development mode state for external access
export { isDevelopmentMode };