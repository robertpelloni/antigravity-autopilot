// VS Code communication layer - handles all message passing with the extension
import { vscode } from '../core/state.js';

// Message sending utilities
export function sendMessageToVSCode(command, data = {}) {
  try {
    vscode.postMessage({
      command,
      ...data
    });
  } catch (error) {
    console.error(`Error sending message to VS Code (${command}):`, error);
  }
}

// Specific VS Code API calls
export function sendAddMessage(text) {
  sendMessageToVSCode('addMessage', { text });
}

export function sendStartProcessing(skipPermissions) {
  sendMessageToVSCode('startProcessing', { skipPermissions });
}

export function sendStopProcessing() {
  sendMessageToVSCode('stopProcessing');
}

export function sendClaudeKeypress(key) {
  sendMessageToVSCode('claudeKeypress', { key });
}

export function sendClearQueue() {
  sendMessageToVSCode('clearQueue');
}

export function sendResetSession() {
  sendMessageToVSCode('resetSession');
}

export function sendOpenSettings() {
  sendMessageToVSCode('openSettings');
}

export function sendRemoveMessage(messageId) {
  sendMessageToVSCode('removeMessage', { messageId });
}

export function sendDuplicateMessage(messageId) {
  sendMessageToVSCode('duplicateMessage', { messageId });
}

export function sendEditMessage(messageId, newText) {
  sendMessageToVSCode('editMessage', { messageId, newText });
}

export function sendReorderQueue(fromIndex, toIndex) {
  sendMessageToVSCode('reorderQueue', { fromIndex, toIndex });
}


export function sendLoadHistory() {
  sendMessageToVSCode('loadHistory');
}

export function sendFilterHistory(filter) {
  sendMessageToVSCode('filterHistory', { filter });
}

export function sendDeleteHistoryRun(runId) {
  sendMessageToVSCode('deleteHistoryRun', { runId });
}

export function sendDeleteAllHistory() {
  sendMessageToVSCode('deleteAllHistory');
}

export function sendGetWorkspaceFiles(query, page) {
  sendMessageToVSCode('getWorkspaceFiles', { query, page });
}

export function sendGetDevelopmentModeSetting() {
  sendMessageToVSCode('getDevelopmentModeSetting');
}

export function sendGetSkipPermissionsSetting() {
  sendMessageToVSCode('getSkipPermissionsSetting');
}

export function sendUpdateSkipPermissionsSetting(enabled) {
  sendMessageToVSCode('updateSkipPermissionsSetting', { enabled });
}

export function sendGetHistoryVisibilitySetting() {
  sendMessageToVSCode('getHistoryVisibilitySetting');
}


export function sendSimulateUsageLimit() {
  sendMessageToVSCode('simulateUsageLimit');
}

export function sendClearAllTimers() {
  sendMessageToVSCode('clearAllTimers');
}

export function sendDebugQueueState() {
  sendMessageToVSCode('debugQueueState');
}

export function sendToggleDebugLogging() {
  sendMessageToVSCode('toggleDebugLogging');
}

export function sendStartWebInterface() {
  sendMessageToVSCode('startWebInterface');
}

export function sendStopWebInterface() {
  sendMessageToVSCode('stopWebInterface');
}

export function sendShowWebInterfaceQR() {
  sendMessageToVSCode('showWebInterfaceQR');
}

export function sendOpenWebInterface() {
  sendMessageToVSCode('openWebInterface');
}

export function sendGetWebServerStatus() {
  sendMessageToVSCode('getWebServerStatus');
}