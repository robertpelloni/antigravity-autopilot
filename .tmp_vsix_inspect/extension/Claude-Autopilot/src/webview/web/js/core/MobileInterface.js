import { 
    CONNECTION_STATUS, 
    CONNECTION_STATUS_LABELS, 
    QUEUE_STATUS_EMOJIS, 
    QUEUE_STATUS_LABELS, 
    TOAST_TYPE 
} from '../constants.js';
import { formatTime, formatRelativeTime } from '../utils/time.js';
import { escapeHtml } from '../utils/html.js';
import { parseAnsiToHtml } from '../utils/ansi.js';

export class MobileInterface {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.authToken = null;
        this.isScrollLocked = false;
        this.currentEditingMessageId = null;
        this.hasShownConnectedToast = false;
        
        // Mobile output state (like main extension)
        this.claudeContent = '';
        this.lastRenderedContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        
        // Throttling mechanism (exactly like main extension)
        this.pendingClaudeOutput = null;
        this.claudeRenderTimer = null;
        this.lastClaudeRenderTime = 0;
        this.CLAUDE_RENDER_THROTTLE_MS = 500; // 500ms = 2 times per second max
        
        // Touch gesture state
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchStartTime = 0;
        this.isSwiping = false;
        this.swipeThreshold = 100;
        this.longPressTimeout = null;
        this.longPressDelay = 500;
        
        // Check if we're on desktop (1025px+)
        this.isDesktop = window.matchMedia('(min-width: 1025px)').matches;
        
        this.init();
    }

    init() {
        this.extractAuthToken();
        this.setupEventListeners();
        this.setupResponsiveHandler();
        this.connect();
        this.updateCurrentTime();
        setInterval(() => this.updateCurrentTime(), 1000);
    }
    
    setupResponsiveHandler() {
    // Listen for screen size changes
        const mediaQuery = window.matchMedia('(min-width: 1025px)');
        mediaQuery.addListener((e) => {
            this.isDesktop = e.matches;
            this.handleResponsiveChange();
        });
    }
    
    handleResponsiveChange() {
        if (this.isDesktop) {
            // On desktop: ensure all main section content is visible, but subsections can remain toggled
            const mainSectionContent = document.querySelectorAll('.section-content');
            mainSectionContent.forEach(content => {
                content.style.display = 'block';
            });
        }
    // On mobile: keep current toggle states as they are
    }

    extractAuthToken() {
    // First try to get token from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        this.authToken = urlParams.get('token');
        
        // If not found in URL, try to get from injected global variable
        if (!this.authToken && window.CLAUDE_AUTH_TOKEN) {
            this.authToken = window.CLAUDE_AUTH_TOKEN;
        }
        
        if (!this.authToken) {
            this.showToast('Authentication token missing', TOAST_TYPE.ERROR);
        }
    }

    setupEventListeners() {
    // Control buttons
        document.getElementById('start-btn').addEventListener('click', () => this.handleControlAction('start'));
        document.getElementById('stop-btn').addEventListener('click', () => this.handleControlAction('stop'));
        document.getElementById('interrupt-btn').addEventListener('click', () => this.handleControlAction('interrupt'));
        document.getElementById('reset-btn').addEventListener('click', () => this.handleControlAction('reset'));

        // Add message
        document.getElementById('add-message-btn').addEventListener('click', () => this.showAddMessageModal());
        document.getElementById('confirm-add-message').addEventListener('click', () => this.addMessage());
        document.getElementById('cancel-add-message').addEventListener('click', () => this.hideAddMessageModal());
        document.getElementById('close-add-modal').addEventListener('click', () => this.hideAddMessageModal());

        // Edit message
        document.getElementById('confirm-edit-message').addEventListener('click', () => this.saveEditMessage());
        document.getElementById('cancel-edit-message').addEventListener('click', () => this.hideEditMessageModal());
        document.getElementById('close-edit-modal').addEventListener('click', () => this.hideEditMessageModal());

        // Output controls
        document.getElementById('clear-output-btn').addEventListener('click', () => this.clearOutput());
        document.getElementById('scroll-lock-btn').addEventListener('click', () => this.toggleScrollLock());

        // Section toggles
        document.getElementById('queue-toggle').addEventListener('click', () => this.toggleSection('queue'));
        document.getElementById('explorer-toggle').addEventListener('click', () => this.toggleSection('explorer'));
        document.getElementById('output-toggle').addEventListener('click', () => this.toggleSection('output'));
        document.getElementById('git-toggle').addEventListener('click', () => this.toggleSection('git'));

        // Modal backdrop clicks
        document.getElementById('add-message-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideAddMessageModal();
        });
        document.getElementById('edit-message-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideEditMessageModal();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Touch events for queue items (will be added dynamically)
        document.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });

        // Handle online/offline status
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    connect() {
        if (this.ws) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${this.authToken}`;
        
        this.updateConnectionStatus(CONNECTION_STATUS.CONNECTING);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                this.updateConnectionStatus(CONNECTION_STATUS.CONNECTED);
                this.reconnectAttempts = 0;
                
                // Only show toast once per session or after disconnection
                if (!this.hasShownConnectedToast) {
                    this.showToast('Connected to Claude Autopilot', TOAST_TYPE.SUCCESS);
                    this.hasShownConnectedToast = true;
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) { // eslint-disable-line no-unused-vars
                    // Invalid WebSocket message format
                }
            };
            
            this.ws.onclose = (event) => {
                this.updateConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
                this.ws = null;
                
                // Reset the toast flag so it shows again on next successful connection
                this.hasShownConnectedToast = false;
                
                // Handle different close codes
                if (event.code === 1008) {
                    // Unauthorized - don't retry, show error
                    this.showToast('Authentication failed. Please refresh the page.', TOAST_TYPE.ERROR);
                    this.reconnectAttempts = this.maxReconnectAttempts; // Stop retrying
                } else if (event.code !== 1000) {
                    // Other non-normal closes - attempt reconnect
                    this.attemptReconnect();
                }
            };
            
            this.ws.onerror = (error) => { // eslint-disable-line no-unused-vars
                this.updateConnectionStatus(CONNECTION_STATUS.ERROR);
            };
        } catch (error) { // eslint-disable-line no-unused-vars
            this.updateConnectionStatus('error');
            this.attemptReconnect();
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showToast('Connection failed. Please refresh the page.', TOAST_TYPE.ERROR);
            return;
        }

        this.reconnectAttempts++;
        this.updateConnectionStatus(CONNECTION_STATUS.RECONNECTING);
        
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }

    handleMessage(data) {
        switch (data.type) {
        case 'initialState':
            this.handleInitialState(data.data);
            break;
        case 'queueUpdate':
            this.updateQueue(data.queue);
            break;
        case 'statusUpdate':
            this.updateStatus(data.status);
            break;
        case 'outputUpdate':
            this.appendOutput(data.output, data.timestamp);
            break;
        default:
            // Unknown message type
        }
    }

    handleInitialState(data) {
        this.updateStatus(data.status);
        this.updateQueue(data.queue);
        if (data.output) {
            this.setOutput(data.output);
        }
    }

    updateConnectionStatus(status) {
        const connectionStatus = document.getElementById('connection-status');
        const connectionIndicator = document.getElementById('connection-indicator');
        
        connectionStatus.setAttribute('data-status', status);
        
        const statusText = CONNECTION_STATUS_LABELS[status] || 'Unknown';
        connectionStatus.querySelector('.status-text').textContent = statusText;
        
        // Update footer connection indicator to match header
        if (connectionIndicator) {
            connectionIndicator.setAttribute('data-status', status);
            connectionIndicator.querySelector('.status-text').textContent = statusText;
        }
    }

    updateStatus(status) {
    // Update session status icon
        const sessionStatus = document.getElementById('session-status');
        const sessionIcon = sessionStatus.querySelector('.session-icon');
        
        if (status.isRunning && status.processingQueue) {
            sessionIcon.textContent = '▶️';
            sessionStatus.setAttribute('data-status', 'running');
        } else if (status.sessionReady) {
            sessionIcon.textContent = '⏸️';
            sessionStatus.setAttribute('data-status', 'paused');
        } else {
            sessionIcon.textContent = '⏹️';
            sessionStatus.setAttribute('data-status', 'idle');
        }

        // Update workspace info if available
        if (status.workspace) {
            this.updateWorkspaceInfo(status.workspace);
        }

        // Update control buttons
        this.updateControlButtons(status);
    }

    updateWorkspaceInfo(workspace) {
        const workspaceElement = document.getElementById('workspace-name');
        if (workspaceElement && workspace.name) {
            workspaceElement.textContent = workspace.name;
            workspaceElement.title = workspace.path; // Show full path on hover
        }
    }

    updateControlButtons(status) {
        const startBtn = document.getElementById('start-btn');
        const stopBtn = document.getElementById('stop-btn');
        const interruptBtn = document.getElementById('interrupt-btn');
        const resetBtn = document.getElementById('reset-btn');
        
        startBtn.disabled = status.isRunning && status.processingQueue;
        stopBtn.disabled = !status.isRunning && !status.processingQueue;
        // Interrupt should be enabled when Claude process is running, even if not fully ready
        interruptBtn.disabled = !status.isRunning;
        resetBtn.disabled = false;
    }

    updateQueue(queue) {
        const queueContainer = document.getElementById('queue-container');
        const queueCounter = document.getElementById('queue-counter');
        const totalMessages = document.getElementById('total-messages');
        
        // Update counters
        queueCounter.textContent = queue.length;
        queueCounter.setAttribute('data-count', queue.length);
        if (totalMessages) {
            totalMessages.textContent = queue.length;
        }
        
        // Clear and rebuild queue
        queueContainer.innerHTML = '';
        
        if (queue.length === 0) {
            queueContainer.innerHTML = `
                <div class="empty-state">
                    <p style="text-align: center; color: var(--text-muted); padding: var(--space-lg);">
                        No messages in queue. Add a message to get started.
                    </p>
                </div>
            `;
            return;
        }
        
        queue.forEach(message => {
            const queueItem = this.createQueueItem(message);
            queueContainer.appendChild(queueItem);
        });
    }

    createQueueItem(message) {
        const item = document.createElement('div');
        item.className = 'queue-item';
        item.setAttribute('data-status', message.status);
        item.setAttribute('data-id', message.id);
        
        const statusEmoji = QUEUE_STATUS_EMOJIS[message.status] || '';
        const statusName = QUEUE_STATUS_LABELS[message.status] || message.status;
        
        item.innerHTML = `
            <div class="item-content">
                <div class="item-text">${escapeHtml(message.text)}</div>
                <div class="item-meta">
                    <span class="item-time">${formatRelativeTime(message.timestamp)}</span>
                    <span class="item-status">${statusEmoji} ${statusName}</span>
                </div>
            </div>
            <div class="item-actions">
                <button class="item-action" data-action="edit" title="Edit">✏️</button>
                <button class="item-action" data-action="duplicate" title="Duplicate">📋</button>
                <button class="item-action" data-action="delete" title="Delete">🗑️</button>
            </div>
        `;
        
        // Add event listeners for actions
        item.querySelectorAll('.item-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                this.handleQueueItemAction(message.id, action);
            });
        });
        
        return item;
    }

    handleQueueItemAction(messageId, action) {
        switch (action) {
        case 'edit':
            this.editMessage(messageId);
            break;
        case 'duplicate':
            this.duplicateMessage(messageId);
            break;
        case 'delete':
            this.deleteMessage(messageId);
            break;
        }
    }

    async handleControlAction(action) {
        this.showLoading();
        
        try {
            const response = await fetch(`/api/control/${action}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`Failed to ${action}`);
            }
            
            await response.json();
            this.showToast(`Successfully ${action}ed Claude Autopilot`, TOAST_TYPE.SUCCESS);
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast(`Failed to ${action} Claude Autopilot`, TOAST_TYPE.ERROR);
        } finally {
            this.hideLoading();
        }
    }

    showAddMessageModal() {
        const modal = document.getElementById('add-message-modal');
        const input = document.getElementById('message-input');
        
        input.value = '';
        modal.classList.add('active');
        input.focus();
        
        // Add keyboard handler for Cmd+Enter to send message
        const keyHandler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.addMessage();
            }
        };
        
        input.addEventListener('keydown', keyHandler);
        
        // Remove the handler when modal is closed
        const originalHide = this.hideAddMessageModal.bind(this);
        this.hideAddMessageModal = () => {
            input.removeEventListener('keydown', keyHandler);
            this.hideAddMessageModal = originalHide;
            originalHide();
        };
    }

    hideAddMessageModal() {
        const modal = document.getElementById('add-message-modal');
        modal.classList.remove('active');
    }

    async addMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (!message) {
            this.showToast('Please enter a message', TOAST_TYPE.WARNING);
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch('/api/queue/add', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message })
            });
            
            if (!response.ok) {
                throw new Error('Failed to add message');
            }
            
            this.hideAddMessageModal();
            this.showToast('Message added to queue', TOAST_TYPE.SUCCESS);
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast('Failed to add message', TOAST_TYPE.ERROR);
        } finally {
            this.hideLoading();
        }
    }

    editMessage(messageId) {
    // Find the message in the current queue display
        const queueItem = document.querySelector(`[data-id="${messageId}"]`);
        if (!queueItem) return;
        
        const messageText = queueItem.querySelector('.item-text').textContent;
        const modal = document.getElementById('edit-message-modal');
        const input = document.getElementById('edit-message-input');
        
        this.currentEditingMessageId = messageId;
        input.value = messageText;
        modal.classList.add('active');
        input.focus();
        
        // Add keyboard handler for Cmd+Enter to save message
        const keyHandler = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.saveEditMessage();
            }
        };
        
        input.addEventListener('keydown', keyHandler);
        
        // Remove the handler when modal is closed
        const originalHide = this.hideEditMessageModal.bind(this);
        this.hideEditMessageModal = () => {
            input.removeEventListener('keydown', keyHandler);
            this.hideEditMessageModal = originalHide;
            originalHide();
        };
    }

    hideEditMessageModal() {
        const modal = document.getElementById('edit-message-modal');
        modal.classList.remove('active');
        this.currentEditingMessageId = null;
    }

    async saveEditMessage() {
        if (!this.currentEditingMessageId) return;
        
        const input = document.getElementById('edit-message-input');
        const newText = input.value.trim();
        
        if (!newText) {
            this.showToast('Please enter a message', TOAST_TYPE.WARNING);
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${this.currentEditingMessageId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: newText })
            });
            
            if (!response.ok) {
                throw new Error('Failed to edit message');
            }
            
            this.hideEditMessageModal();
            this.showToast('Message updated', TOAST_TYPE.SUCCESS);
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast('Failed to edit message', TOAST_TYPE.ERROR);
        } finally {
            this.hideLoading();
        }
    }

    async duplicateMessage(messageId) {
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${messageId}/duplicate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to duplicate message');
            }
            
            this.showToast('Message duplicated', TOAST_TYPE.SUCCESS);
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast('Failed to duplicate message', TOAST_TYPE.ERROR);
        } finally {
            this.hideLoading();
        }
    }

    async deleteMessage(messageId) {
        if (!confirm('Are you sure you want to delete this message?')) {
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await fetch(`/api/queue/${messageId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to delete message');
            }
            
            this.showToast('Message deleted', TOAST_TYPE.SUCCESS);
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast('Failed to delete message', TOAST_TYPE.ERROR);
        } finally {
            this.hideLoading();
        }
    }

    // Mobile version of appendToClaudeOutput (exactly like main extension)
    appendOutput(output) {
        try {
            // Store the latest output
            this.pendingClaudeOutput = output;
            
            // Check if we need to throttle
            const now = Date.now();
            const timeSinceLastRender = now - this.lastClaudeRenderTime;
            
            if (timeSinceLastRender >= this.CLAUDE_RENDER_THROTTLE_MS) {
                // Enough time has passed, render immediately
                this.renderClaudeOutput();
            } else {
                // Schedule a delayed render if not already scheduled
                if (!this.claudeRenderTimer) {
                    const delay = this.CLAUDE_RENDER_THROTTLE_MS - timeSinceLastRender;
                    this.claudeRenderTimer = setTimeout(() => {
                        this.renderClaudeOutput();
                    }, delay);
                }
            }
        } catch (error) { // eslint-disable-line no-unused-vars
            // Error appending to Claude output
        }
    }

    renderClaudeOutput() {
        if (!this.pendingClaudeOutput) {
            return;
        }
        
        const output = this.pendingClaudeOutput;
        this.pendingClaudeOutput = null;
        this.lastClaudeRenderTime = Date.now();
        
        // Clear the timer
        if (this.claudeRenderTimer) {
            clearTimeout(this.claudeRenderTimer);
            this.claudeRenderTimer = null;
        }
        
        // Now perform the actual rendering
        this.performClaudeRender(output);
    }

    setOutput(output) {
        if (output) {
            // Use the same throttling mechanism as appendOutput
            this.appendOutput(output);
        } else {
            const outputStream = document.getElementById('claude-output');
            outputStream.innerHTML = '<div class="output-line" data-type="system">📱 Mobile interface ready...</div>';
        }
    }

    // Exact same logic as main extension's performClaudeRender
    performClaudeRender(output) {
        try {
            const claudeOutput = document.getElementById('claude-output');
            
            if (!claudeOutput) {
                return;
            }

            // Clear any ready message on first output
            if (claudeOutput.innerHTML.includes('Mobile interface ready')) {
                claudeOutput.innerHTML = '';
                this.claudeContent = '';
                this.lastRenderedContent = '';
                
                // Reset parsing cache
                this.lastParsedContent = '';
                this.lastParsedHtml = '';
            }

            // Check if this output contains screen clearing commands (like main extension)
            if (output.includes('\x1b[2J') || output.includes('\x1b[3J') || output.includes('\x1b[H')) {
                // Clear screen - replace entire content
                this.claudeContent = output;
                this.lastRenderedContent = output;
                claudeOutput.innerHTML = '';
                
                // Reset cache since this is a new screen
                this.lastParsedContent = '';
                this.lastParsedHtml = '';
                
                // Parse and render the new content (remove clear screen codes after detection)
                const contentToRender = this.claudeContent.replace(/\x1b\[[2-3]J/g, '').replace(/\x1b\[H/g, '');
                const htmlOutput = parseAnsiToHtml(contentToRender);
                this.lastParsedContent = output;
                this.lastParsedHtml = htmlOutput;
                
                const outputElement = document.createElement('div');
                outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
                outputElement.innerHTML = htmlOutput;
                claudeOutput.appendChild(outputElement);
            } else {
                // No clear screen - this is the complete current screen content from backend
                // Only update if content has actually changed
                if (output !== this.lastRenderedContent) {
                    this.claudeContent = output;
                    this.lastRenderedContent = output;
                    
                    // Use cached parsing if content hasn't changed significantly
                    let htmlOutput;
                    if (output === this.lastParsedContent && this.lastParsedHtml) {
                        htmlOutput = this.lastParsedHtml;
                    } else {
                        // Parse and cache the result
                        htmlOutput = parseAnsiToHtml(this.claudeContent);
                        this.lastParsedContent = output;
                        this.lastParsedHtml = htmlOutput;
                    }
                    
                    // Replace the entire content safely
                    claudeOutput.innerHTML = '';
                    const outputElement = document.createElement('div');
                    outputElement.style.cssText = 'white-space: pre; word-wrap: break-word; line-height: 1.4; font-family: inherit;';
                    outputElement.innerHTML = htmlOutput;
                    claudeOutput.appendChild(outputElement);
                }
            }

            // Auto-scroll to bottom
            this.scrollOutputToBottom();
        } catch (error) { // eslint-disable-line no-unused-vars
            // Error rendering Claude output
        }
    }

    clearOutput() {
        const outputStream = document.getElementById('claude-output');
        outputStream.innerHTML = '';
        
        // Reset state like main extension
        this.claudeContent = '';
        this.lastRenderedContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        
        outputStream.innerHTML = '<div class="output-line" data-type="system">📱 Mobile interface ready...</div>';
    }

    toggleScrollLock() {
        this.isScrollLocked = !this.isScrollLocked;
        const btn = document.getElementById('scroll-lock-btn');
        btn.classList.toggle('active', this.isScrollLocked);
        btn.title = this.isScrollLocked ? 'Unlock scroll' : 'Lock scroll';
        
        if (!this.isScrollLocked) {
            this.scrollOutputToBottom();
        }
    }

    scrollOutputToBottom() {
        if (this.isScrollLocked) return;
        
        const outputContainer = document.querySelector('.output-container');
        if (outputContainer) {
            outputContainer.scrollTop = outputContainer.scrollHeight;
        }
    }

    toggleSection(sectionName) {
    // On desktop, main sections are not collapsible
        if (this.isDesktop) {
            return;
        }
        
        const toggle = document.getElementById(`${sectionName}-toggle`);
        const content = document.getElementById(`${sectionName}-content`);
        const icon = toggle.querySelector('.toggle-icon');
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        const newState = !isExpanded;
        
        toggle.setAttribute('data-expanded', newState);
        content.style.display = newState ? 'block' : 'none';
        icon.textContent = newState ? '▼' : '▶';
    }

    // Touch gesture handling
    handleTouchStart(e) {
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchStartTime = Date.now();
        this.isSwiping = false;
        
        // Start long press timer
        this.longPressTimeout = setTimeout(() => {
            if (!this.isSwiping) {
                this.handleLongPress(queueItem);
            }
        }, this.longPressDelay);
    }

    handleTouchMove(e) {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.touches[0];
        const deltaX = touch.clientX - this.touchStartX;
        const deltaY = touch.clientY - this.touchStartY;
        
        // Check if this is a horizontal swipe
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 20) {
            e.preventDefault();
            this.isSwiping = true;
            
            queueItem.classList.add('swiping');
            queueItem.style.transform = `translateX(${deltaX}px)`;
            
            // Show swipe indicators
            if (deltaX < -50) {
                queueItem.classList.add('swipe-left');
                queueItem.classList.remove('swipe-right');
            } else if (deltaX > 50) {
                queueItem.classList.add('swipe-right');
                queueItem.classList.remove('swipe-left');
            } else {
                queueItem.classList.remove('swipe-left', 'swipe-right');
            }
        }
    }

    handleTouchEnd(e) {
        if (this.longPressTimeout) {
            clearTimeout(this.longPressTimeout);
            this.longPressTimeout = null;
        }
        
        const queueItem = e.target.closest('.queue-item');
        if (!queueItem) return;
        
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - this.touchStartX;
        
        // Reset swipe classes
        queueItem.classList.remove('swiping', 'swipe-left', 'swipe-right');
        queueItem.style.transform = '';
        
        if (this.isSwiping && Math.abs(deltaX) > this.swipeThreshold) {
            const messageId = queueItem.getAttribute('data-id');
            
            if (deltaX < -this.swipeThreshold) {
                // Swipe left - delete
                this.handleQueueItemAction(messageId, 'delete');
            } else if (deltaX > this.swipeThreshold) {
                // Swipe right - duplicate
                this.handleQueueItemAction(messageId, 'duplicate');
            }
        }
        
        this.isSwiping = false;
    }

    handleLongPress(queueItem) {
        const messageId = queueItem.getAttribute('data-id');
        this.handleQueueItemAction(messageId, 'edit');
        
        // Haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    }

    handleKeydown(e) {
    // Keyboard shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
            case 'Enter':
                e.preventDefault();
                this.showAddMessageModal();
                break;
            case 'r':
                e.preventDefault();
                this.handleControlAction('start');
                break;
            case 's':
                e.preventDefault();
                this.handleControlAction('stop');
                break;
            case 'i':
                e.preventDefault();
                this.handleControlAction('interrupt');
                break;
            }
        }
        
        // Modal handling and interrupt
        if (e.key === 'Escape') {
            // If modals are open, close them first
            const addModal = document.getElementById('add-message-modal');
            const editModal = document.getElementById('edit-message-modal');
            
            if (addModal.style.display === 'flex' || editModal.style.display === 'flex') {
                this.hideAddMessageModal();
                this.hideEditMessageModal();
            } else {
                // If no modals are open, send interrupt to Claude
                this.handleControlAction('interrupt');
            }
        }
    }

    handleOnline() {
        this.showToast('Connection restored', TOAST_TYPE.SUCCESS);
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.connect();
        }
    }

    handleOffline() {
        this.showToast('Connection lost', TOAST_TYPE.WARNING);
        this.updateConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
    }

    // Utility functions
    showLoading() {
        document.getElementById('loading-overlay').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loading-overlay').classList.remove('active');
    }

    showToast(message, type = TOAST_TYPE.INFO) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        // Auto remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    updateCurrentTime() {
        const timeElement = document.getElementById('current-time');
        if (timeElement) {
            timeElement.textContent = formatTime(Date.now());
        }
    }
}