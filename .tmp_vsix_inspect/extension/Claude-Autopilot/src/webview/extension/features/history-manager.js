// History management functionality
import { historyData, updateHistoryData } from '../core/state.js';
import { createSafeElement } from '../security/validation.js';
import { 
  sendLoadHistory, 
  sendFilterHistory, 
  sendDeleteHistoryRun, 
  sendDeleteAllHistory 
} from '../communication/vscode-api.js';
import { showError } from '../utils/dom-helpers.js';
import { showConfirmDialog } from '../ui/message-dialogs.js';

export function loadHistory() {
  try {
    sendLoadHistory();
  } catch (error) {
    console.error('Error loading history:', error);
    showError('Failed to load history');
  }
}

export function filterHistory() {
  try {
    const filter = document.getElementById('historyFilter').value;
    sendFilterHistory(filter);
  } catch (error) {
    console.error('Error filtering history:', error);
    showError('Failed to filter history');
  }
}

export async function deleteHistoryRun(runId) {
  try {
    const confirmed = await showConfirmDialog(
      'Delete History Run',
      'Are you sure you want to delete this history run? This action cannot be undone.',
      'Delete',
      'Cancel'
    );
    
    if (confirmed) {
      sendDeleteHistoryRun(runId);
    }
  } catch (error) {
    console.error('Error deleting history run:', error);
    showError('Failed to delete history run');
  }
}

export async function deleteAllHistory() {
  try {
    const confirmed = await showConfirmDialog(
      'Delete All History',
      'Are you sure you want to delete ALL history? This action cannot be undone and will remove all historical data.',
      'Delete All',
      'Cancel'
    );
    
    if (confirmed) {
      sendDeleteAllHistory();
    }
  } catch (error) {
    console.error('Error deleting all history:', error);
    showError('Failed to delete all history');
  }
}

export function renderHistory(history) {
  try {
    const container = document.getElementById('historyContainer');
        
    if (!history || history.length === 0) {
      container.innerHTML = '';
      const emptyMessage = createSafeElement('div', 'No previous runs found for this workspace', 'empty-history');
      container.appendChild(emptyMessage);
      return;
    }
        
    container.innerHTML = '';
        
    history.forEach(run => {
      const startTime = new Date(run.startTime).toLocaleString();
      const endTime = run.endTime ? new Date(run.endTime).toLocaleString() : 'In Progress';
      const duration = run.endTime ? 
        Math.round((new Date(run.endTime) - new Date(run.startTime)) / 1000 / 60) + ' min' : 
        'Ongoing';
            
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
            
      // Create header
      const header = document.createElement('div');
      header.className = 'history-item-header';
            
      const title = createSafeElement('div', `Run ${run.id.split('_')[1]}`, 'history-item-title');
            
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'history-item-actions';
            
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑️';
      deleteBtn.className = 'history-item-action delete';
      deleteBtn.title = 'Delete this run';
      deleteBtn.onclick = () => deleteHistoryRun(run.id);
      actionsDiv.appendChild(deleteBtn);
            
      const timeDiv = createSafeElement('div', `${startTime} (${duration})`, 'history-item-time');
      actionsDiv.appendChild(timeDiv);
            
      header.appendChild(title);
      header.appendChild(actionsDiv);
            
      // Create stats
      const stats = document.createElement('div');
      stats.className = 'history-item-stats';
            
      const totalStat = createSafeElement('div', `📊 Total: ${run.totalMessages}`, 'history-stat history-stat-total');
      const completedStat = createSafeElement('div', `✅ Completed: ${run.completedMessages}`, 'history-stat history-stat-completed');
      const errorStat = createSafeElement('div', `❌ Errors: ${run.errorMessages}`, 'history-stat history-stat-errors');
      const waitingStat = createSafeElement('div', `⏳ Waiting: ${run.waitingMessages}`, 'history-stat history-stat-waiting');
            
      stats.appendChild(totalStat);
      stats.appendChild(completedStat);
      stats.appendChild(errorStat);
      stats.appendChild(waitingStat);
            
      // Create messages
      const messages = document.createElement('div');
      messages.className = 'history-item-messages';
            
      run.messages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'history-message';
                
        const textDiv = createSafeElement('div', msg.text, 'history-message-text');
                
        const metaDiv = document.createElement('div');
        metaDiv.className = 'history-message-meta';
                
        const statusSpan = createSafeElement('span', msg.status.toUpperCase(), `status-${msg.status}`);
        
        let timeText = new Date(msg.timestamp).toLocaleTimeString();
        
        // Show processing time for completed/error messages
        if ((msg.status === 'completed' || msg.status === 'error') && msg.processingStartedAt && msg.completedAt) {
          const processingTime = new Date(msg.completedAt) - new Date(msg.processingStartedAt);
          const seconds = (processingTime / 1000).toFixed(1);
          timeText += ` (${seconds}s)`;
        }
        
        const timeSpan = createSafeElement('span', timeText, '');
                
        metaDiv.appendChild(statusSpan);
        metaDiv.appendChild(timeSpan);
                
        messageDiv.appendChild(textDiv);
        messageDiv.appendChild(metaDiv);
                
        messages.appendChild(messageDiv);
      });
            
      historyItem.appendChild(header);
      historyItem.appendChild(stats);
      historyItem.appendChild(messages);
            
      container.appendChild(historyItem);
    });
  } catch (error) {
    console.error('Error rendering history:', error);
    const container = document.getElementById('historyContainer');
    container.innerHTML = '';
    const errorMessage = createSafeElement('div', 'Error rendering history', 'error-message');
    container.appendChild(errorMessage);
  }
}

export function updateHistoryFromMessage(history) {
  updateHistoryData(history);
  renderHistory(historyData);
}