// Queue management - operations, rendering, and drag & drop functionality
import { 
  messageQueue, 
  sessionState,
  updateMessageQueue,
  setDraggedIndex,
  getDraggedIndex 
} from '../core/state.js';
import { createSafeElement, sanitizeHtml } from '../security/validation.js';
import { 
  sendRemoveMessage, 
  sendDuplicateMessage, 
  sendReorderQueue,
  sendClearQueue
} from '../communication/vscode-api.js';
import { showEditDialog, showConfirmDialog } from './message-dialogs.js';
import { showError } from '../utils/dom-helpers.js';

export function updateQueue(queue) {
  try {
    updateMessageQueue(queue);
    renderQueue();
    updateButtonStates();
  } catch (error) {
    console.error('Error updating queue:', error);
  }
}

export function renderQueue() {
  try {
    const container = document.getElementById('queueContainer');

    if (messageQueue.length === 0) {
      container.innerHTML = '';
      const emptyMessage = createSafeElement('div', 'No messages in queue', 'empty-queue');
      container.appendChild(emptyMessage);
      return;
    }

    container.innerHTML = '';

    messageQueue.forEach((item, index) => {
      const queueItem = document.createElement('div');
      queueItem.className = `queue-item ${sanitizeHtml(item.status)}`;
      queueItem.setAttribute('data-index', index);
            
      let statusText = item.status;
      let timeText = new Date(item.timestamp).toLocaleString();
      let additionalContent = '';

      // Show processing time for completed/error messages
      if ((item.status === 'completed' || item.status === 'error') && item.processingStartedAt && item.completedAt) {
        const processingTime = new Date(item.completedAt) - new Date(item.processingStartedAt);
        const seconds = (processingTime / 1000).toFixed(1);
        timeText += ` (${seconds}s)`;
      } else if (item.status === 'processing' && item.processingStartedAt) {
        const processingTime = new Date() - new Date(item.processingStartedAt);
        const seconds = (processingTime / 1000).toFixed(1);
        timeText += ` (${seconds}s)`;
      }

      if (item.status === 'waiting' && item.waitSeconds > 0) {
        const hours = Math.floor(item.waitSeconds / 3600);
        const minutes = Math.floor((item.waitSeconds % 3600) / 60);
        const seconds = item.waitSeconds % 60;
        statusText = `waiting - ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
        const countdownDiv = createSafeElement('div', `Resuming in ${hours}h ${minutes}m ${seconds}s`, 'countdown');
        additionalContent = countdownDiv;
      }

      if (item.status === 'completed' && item.output) {
        const outputDiv = createSafeElement('div', item.output, 'queue-item-output');
        additionalContent = outputDiv;
      }

      if (item.status === 'error' && item.error) {
        const errorDiv = createSafeElement('div', `Error: ${item.error}`, 'queue-item-error');
        additionalContent = errorDiv;
      }

      const isDraggable = item.status === 'pending';
            
      // Create actions
      const actions = document.createElement('div');
      actions.className = 'queue-item-actions';
            
      // Show duplicate button for pending, completed, and processing messages
      if (item.status === 'pending' || item.status === 'completed' || item.status === 'processing') {
        const duplicateBtn = document.createElement('button');
        duplicateBtn.textContent = '📋';
        duplicateBtn.className = 'queue-item-action duplicate';
        duplicateBtn.title = 'Duplicate message';
        duplicateBtn.onclick = () => duplicateMessage(item.id);
        actions.appendChild(duplicateBtn);
      }
            
      // Show edit button only for pending messages
      if (item.status === 'pending') {
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️';
        editBtn.className = 'queue-item-action edit';
        editBtn.title = 'Edit message';
        editBtn.onclick = () => {
          console.log('Edit button clicked for message ID:', item.id);
          editMessage(item.id);
        };
        actions.appendChild(editBtn);
                
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.className = 'queue-item-action remove';
        removeBtn.title = 'Remove message';
        removeBtn.onclick = () => removeMessage(item.id);
        actions.appendChild(removeBtn);
      } else {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.className = 'queue-item-action remove';
        removeBtn.title = 'Remove message';
        removeBtn.onclick = () => removeMessage(item.id);
        actions.appendChild(removeBtn);
      }

      // Set drag properties
      queueItem.draggable = isDraggable;
      if (isDraggable) {
        queueItem.addEventListener('dragstart', (e) => handleDragStart(e, index));
      }
      // Add dragover and drop listeners to ALL items so you can drop on any item
      queueItem.addEventListener('dragover', handleDragOver);
      queueItem.addEventListener('drop', (e) => handleDrop(e, index));
            
      // Create header
      const header = document.createElement('div');
      header.className = 'queue-item-header';
            
      const status = createSafeElement('span', statusText, 'queue-item-status');
      const time = createSafeElement('span', timeText, 'queue-item-time');
            
      header.appendChild(status);
      header.appendChild(time);
            
      // Create text content - SAFELY
      const textDiv = createSafeElement('div', item.text, 'queue-item-text');
            
      queueItem.appendChild(actions);
      queueItem.appendChild(header);
      queueItem.appendChild(textDiv);
            
      if (additionalContent) {
        queueItem.appendChild(additionalContent);
      }
            
      container.appendChild(queueItem);
    });
  } catch (error) {
    console.error('Error rendering queue:', error);
    const container = document.getElementById('queueContainer');
    container.innerHTML = '';
    const errorMessage = createSafeElement('div', 'Error rendering queue', 'error-message');
    container.appendChild(errorMessage);
  }
}

export function updateButtonStates() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const clearBtn = document.getElementById('clearBtn');
    
  console.log('Button State Update:', {
    isSessionRunning: sessionState.isSessionRunning,
    isProcessing: sessionState.isProcessing,
    queueLength: messageQueue.length
  });
    
  // Update start button text and state based on session and queue status
  if (!sessionState.isSessionRunning) {
    startBtn.innerHTML = '<span class="btn-icon">🚀</span>Start Session';
    startBtn.disabled = sessionState.isProcessing;
  } else if (sessionState.wasStopped && !sessionState.isProcessing) {
    // Show "Start Processing" only if user manually stopped processing
    startBtn.innerHTML = '<span class="btn-icon">▶️</span>Start Processing';
    startBtn.disabled = messageQueue.length === 0; // Disable only if no messages
  } else if (sessionState.isProcessing) {
    startBtn.innerHTML = '<span class="btn-icon">▶️</span>Processing...';
    startBtn.disabled = true; // Currently processing
  } else {
    // Session running, not stopped by user - show ready state
    startBtn.innerHTML = '<span class="btn-icon">⏳</span>Session Ready';
    startBtn.disabled = true;
  }
    
  console.log('Start button state:', {
    text: startBtn.innerHTML.replace(/<[^>]*>/g, ''),
    disabled: startBtn.disabled,
    wasStopped: sessionState.wasStopped,
    reason: !sessionState.isSessionRunning ? 'no session' : 
      sessionState.wasStopped ? 'manually stopped' :
        sessionState.isProcessing ? 'processing' : 'session ready'
  });
    
  // Stop button: enabled when processing
  stopBtn.disabled = !sessionState.isProcessing;
    
  // Reset button: enabled when session is running but not processing
  resetBtn.disabled = !sessionState.isSessionRunning || sessionState.isProcessing;
    
  // Clear button: always enabled when queue has messages
  clearBtn.disabled = messageQueue.length === 0;
}

// Queue Management Functions
export function removeMessage(messageId) {
  try {
    sendRemoveMessage(messageId);
  } catch (error) {
    console.error('Error removing message:', error);
    showError('Failed to remove message');
  }
}

export function duplicateMessage(messageId) {
  try {
    const message = messageQueue.find(item => item.id === messageId);
    if (message) {
      sendDuplicateMessage(messageId);
    }
  } catch (error) {
    console.error('Error duplicating message:', error);
    showError('Failed to duplicate message');
  }
}

export function editMessage(messageId) {
  try {
    console.log('EditMessage called with messageId:', messageId);
    const message = messageQueue.find(item => item.id === messageId);
    console.log('Found message:', message);
        
    if (message) {
      // Create a custom input dialog instead of using prompt()
      showEditDialog(message, messageId);
    } else {
      console.error('Message not found for ID:', messageId);
      showError('Message not found');
    }
  } catch (error) {
    console.error('Error editing message:', error);
    showError('Failed to edit message');
  }
}


export async function clearQueue() {
  try {
    const confirmed = await showConfirmDialog(
      'Clear Queue',
      'Are you sure you want to clear all messages from the queue? This action cannot be undone.',
      'Clear Queue',
      'Cancel'
    );
    
    if (confirmed) {
      sendClearQueue();
    }
  } catch (error) {
    console.error('Error clearing queue:', error);
    showError('Failed to clear queue');
  }
}

// Drag and Drop Functions
export function handleDragStart(event, index) {
  const item = messageQueue[index];
    
  // Prevent dragging running or completed tasks
  if (item && (item.status === 'processing' || item.status === 'completed' || item.status === 'error' || item.status === 'waiting')) {
    event.preventDefault();
    return false;
  }
    
  setDraggedIndex(index);
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
}

export function handleDragOver(event) {
  event.preventDefault();
    
  // Only allow dropping on pending items or at the end
  const targetElement = event.currentTarget;
  const targetIndex = parseInt(targetElement.dataset.index);
  const targetItem = messageQueue[targetIndex];
    
  if (targetItem && (targetItem.status === 'processing' || targetItem.status === 'completed' || targetItem.status === 'error' || targetItem.status === 'waiting')) {
    event.dataTransfer.dropEffect = 'none';
    return;
  }
    
  event.dataTransfer.dropEffect = 'move';
}

export function handleDrop(event, targetIndex) {
  event.preventDefault();
    
  const draggedIndex = getDraggedIndex();
  const targetItem = messageQueue[targetIndex];
  const draggedItem = messageQueue[draggedIndex];
    
  // Prevent dropping on running/completed tasks or dragging them
  if (targetItem && (targetItem.status === 'processing' || targetItem.status === 'completed' || targetItem.status === 'error' || targetItem.status === 'waiting')) {
    return;
  }
    
  if (draggedItem && (draggedItem.status === 'processing' || draggedItem.status === 'completed' || draggedItem.status === 'error' || draggedItem.status === 'waiting')) {
    return;
  }
    
  if (draggedIndex !== -1 && draggedIndex !== targetIndex) {
    sendReorderQueue(draggedIndex, targetIndex);
  }
    
  // Reset drag styling
  const draggedElement = document.querySelector(`[data-index="${draggedIndex}"]`);
  if (draggedElement) {
    draggedElement.style.opacity = '1';
  }
    
  setDraggedIndex(-1);
}