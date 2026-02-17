// Central message handler for VS Code communication
import { setAllowDangerousXssbypass } from '../security/validation.js';
import { updateQueue } from '../ui/queue-manager.js';
import { appendToTerminal, appendToClaudeOutput, clearClaudeOutputUI } from '../ui/output-handlers.js';
import { handleSessionStateChanged } from '../ui/session-controls.js';
import { updateHistoryFromMessage } from '../features/history-manager.js';
import { renderFileAutocomplete } from '../features/file-autocomplete.js';
import { updateDevelopmentModeUI } from '../features/development-tools.js';
import { updateWebServerStatusFromMessage } from '../features/web-interface.js';

// Handle messages from extension
export function setupMessageHandler() {
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
    case 'updateQueue':
      updateQueue(message.queue);
      break;
    case 'terminalOutput':
      appendToTerminal(message.output);
      break;
    case 'claudeOutput':
      appendToClaudeOutput(message.output);
      break;
    case 'setSecuritySettings':
      setAllowDangerousXssbypass(message.allowDangerousXssbypass);
      const securityWarning = document.getElementById('securityWarning');
      if (securityWarning) {
        securityWarning.style.display = message.allowDangerousXssbypass ? 'block' : 'none';
      }
      break;
    case 'setHistoryVisibility':
      const historySection = document.querySelector('.history-section');
      if (historySection) {
        historySection.style.display = message.showInUI ? 'block' : 'none';
      }
      break;
    case 'setDevelopmentModeSetting':
      updateDevelopmentModeUI(message.enabled);
      break;
    case 'setSkipPermissionsSetting':
      const skipPermissionsCheckbox = document.getElementById('skipPermissions');
      if (skipPermissionsCheckbox) {
        skipPermissionsCheckbox.checked = message.enabled;
      }
      break;
    case 'webServerStatusUpdate':
      updateWebServerStatusFromMessage(message.status);
      break;
    case 'clearClaudeOutput':
      clearClaudeOutputUI();
      break;
    case 'sessionStateChanged':
      handleSessionStateChanged(message);
      break;
    case 'historyLoaded':
      updateHistoryFromMessage(message.history);
      break;
    case 'historyFiltered':
      updateHistoryFromMessage(message.history);
      break;
    case 'queueSorted':
      const sortField = document.getElementById('sortField');
      const sortDirection = document.getElementById('sortDirection');
      if (sortField && sortDirection && message.sortConfig) {
        // Only update if we have valid field and direction values
        if (message.sortConfig.field && message.sortConfig.direction) {
          console.log('Updating sort selection with:', message.sortConfig);
          sortField.value = message.sortConfig.field;
          sortDirection.value = message.sortConfig.direction;
        } else {
          console.log('Backend sent empty sortConfig, preserving current selection:', {
            currentField: sortField.value,
            currentDirection: sortDirection.value,
            receivedConfig: message.sortConfig
          });
          // Don't change the values - keep current selection
        }
      } else {
        console.warn('Sort elements not found or sortConfig missing:', {
          sortField: !!sortField,
          sortDirection: !!sortDirection,
          sortConfig: !!message.sortConfig
        });
      }
      break;
    case 'workspaceFilesResult':
      renderFileAutocomplete(message.files, message.pagination);
      break;
    }
  });
}