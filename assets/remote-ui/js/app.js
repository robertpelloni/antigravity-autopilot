/**
 * PhoneBridge-AgentHub - Frontend Application (Simplified)
 * Mobile-first PWA for controlling AI agents
 */

class PhoneBridgeApp {
    constructor() {
        this.serverUrl = '';
        this.sessionId = null;
        this.ws = null;
        this.isConnected = false;
        this.thinkingHideTimer = null;
        this.maxMessagesDirty = false;
        this.snapshotPollTimer = null;
        this.lastSnapshotHash = null;
        this.currentView = 'chat';

        // Streaming state - for message consolidation
        this.streamingBubble = null;
        this.partialMessageIds = new Set();

        // Settings - baseline: font 14px, scale 100%
        this.fontSize = parseInt(localStorage.getItem('phonebridge_font_size')) || 14;
        const savedScale = parseInt(localStorage.getItem('phonebridge_layout_scale'), 10);
        this.layoutScale = Number.isFinite(savedScale) ? savedScale : 100;
        if (this.layoutScale < 100) {
            this.layoutScale = 100;
        }
        const savedMaxMessages = Number.parseInt(localStorage.getItem('phonebridge_max_messages'), 10);
        this.maxHistoryMessages = Number.isFinite(savedMaxMessages) ? savedMaxMessages : 50;

        // Pending actions state
        this.pendingActions = new Map();
        this.isAutoMode = false;

        this.init();
    }

    init() {
        this.elements = {
            // Screens
            connectScreen: document.getElementById('connect-screen'),
            mainScreen: document.getElementById('main-screen'),

            // Connect form
            serverUrlInput: document.getElementById('server-url'),
            repoPathInput: document.getElementById('repo-path'),
            connectBtn: document.getElementById('connect-btn'),
            connectError: document.getElementById('connect-error'),

            // Header
            disconnectBtn: document.getElementById('disconnect-btn'),
            statusDot: document.querySelector('.status-dot'),

            // Chat
            messagesContainer: document.getElementById('messages'),
            chatInput: document.getElementById('chat-input'),
            sendBtn: document.getElementById('send-btn'),
            thinkingIndicator: document.getElementById('thinking-indicator'),

            // View tabs
            tabButtons: document.querySelectorAll('.tab-btn'),
            chatPanel: document.getElementById('chat-panel'),
            snapshotPanel: document.getElementById('snapshot-panel'),

            // Snapshot
            snapshotRoot: document.getElementById('snapshot-root'),
            snapshotStatus: document.getElementById('snapshot-status'),

            // Settings
            settingsBtn: document.getElementById('settings-btn'),
            settingsModal: document.getElementById('settings-modal'),
            fontSizeDisplay: document.getElementById('font-size-display'),
            fontSizeSlider: document.getElementById('font-size-slider'),
            layoutScaleDisplay: document.getElementById('layout-scale-display'),
            layoutScaleSlider: document.getElementById('layout-scale-slider'),
            settingsSessionId: document.getElementById('settings-session-id'),
            settingsConnectionStatus: document.getElementById('settings-connection-status'),
            maxMessagesInput: document.getElementById('max-messages-input'),
            saveMaxMessagesBtn: document.querySelector('.btn-save-messages'),

            // Action Elements (Hamburger Menu)
            actionMenu: document.getElementById('action-menu'),
            btnMoreOptions: document.getElementById('btn-more-options'),
            pendingBadge: document.getElementById('pending-badge'),
            btnOptMode: document.getElementById('btn-opt-mode')
        };

        this.bindEvents();
        this.loadSavedSettings();
        if (this.elements.maxMessagesInput) {
            this.elements.maxMessagesInput.value = this.maxHistoryMessages;
        }
        if (this.elements.saveMaxMessagesBtn) {
            this.elements.saveMaxMessagesBtn.disabled = true;
        }
        this.applySettings();
        this.autoConnect();
    }

    async autoConnect() {
        const serverUrl = window.location.origin;
        if (!serverUrl || serverUrl === 'null') return;

        try {
            const response = await fetch(`${serverUrl}/api/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_path: 'auto-connect' })
            });

            if (response.ok) {
                const data = await response.json();
                this.serverUrl = serverUrl;
                this.sessionId = data.session_id;

                await this.connectWebSocket();
                this.showMainScreen();
                await this.loadServerMessageSettings();
                if (this.currentView === 'snapshot') {
                    this.startSnapshotPolling();
                }
                console.log('✅ Auto-connected!');
            }
        } catch (err) {
            console.log('Auto-connect skipped:', err.message);
        }
    }

    bindEvents() {
        // Connect/Disconnect
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

        // Chat - click button to send
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());

        // Auto-resize textarea
        this.elements.chatInput.addEventListener('input', () => {
            this.elements.chatInput.style.height = 'auto';
            this.elements.chatInput.style.height = Math.min(this.elements.chatInput.scrollHeight, 120) + 'px';
        });

        // Settings button
        this.elements.settingsBtn?.addEventListener('click', () => this.toggleSettings());

        this.elements.maxMessagesInput?.addEventListener('input', () => this.handleMaxMessagesInput());
        this.elements.saveMaxMessagesBtn?.addEventListener('click', () => this.saveMaxMessages());

        // Action Menu Trigger (Hamburger)
        this.elements.btnMoreOptions?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleActionMenu();
        });

        // Close all dropups when clicking outside
        document.addEventListener('click', (e) => {
            const pickerWrappers = document.querySelectorAll('.picker-wrapper');
            let clickedInside = false;

            pickerWrappers.forEach(wrapper => {
                if (wrapper.contains(e.target)) {
                    clickedInside = true;
                }
            });

            if (!clickedInside) {
                this.closeAllDropups();
            }
        });

        // Scroll to bottom button visibility
        this.elements.messagesContainer?.addEventListener('scroll', () => {
            this.updateScrollButton();
        });

        // Settings sliders
        if (this.elements.fontSizeSlider) {
            this.elements.fontSizeSlider.addEventListener('input', (e) => {
                this.setFontSize(e.target.value);
            });
        }

        if (this.elements.layoutScaleSlider) {
            this.elements.layoutScaleSlider.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                if (this.elements.layoutScaleDisplay) {
                    this.elements.layoutScaleDisplay.textContent = `${value}%`;
                }
            });

            this.elements.layoutScaleSlider.addEventListener('change', (e) => {
                this.setLayoutScale(e.target.value);
            });
        }
    }

    /**
     * Update scroll button visibility
     */
    updateScrollButton() {
        const container = this.elements.messagesContainer;
        const btn = document.getElementById('scroll-to-bottom');
        if (!container || !btn) return;

        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < window.innerHeight;
        btn.classList.toggle('hidden', isNearBottom);
    }

    /**
     * Scroll to bottom of messages (smooth with delay)
     */
    scrollToBottom() {
        const container = this.elements.messagesContainer;
        if (container) {
            setTimeout(() => {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth'
                });
            }, 100);
            this.updateScrollButton();
        }
    }

    /**
     * Toggle a specific picker dropup
     * @param {string} type - 'mode', 'model', or 'action'
     */
    togglePicker(type) {
        const dropdownIds = {
            mode: 'mode-dropdown',
            model: 'model-dropdown',
            action: 'action-dropdown'
        };

        // Close all other dropups first
        Object.keys(dropdownIds).forEach(key => {
            if (key !== type) {
                const dropdown = document.getElementById(dropdownIds[key]);
                if (dropdown) dropdown.classList.add('hidden');
            }
        });

        // Toggle the target dropup
        const targetDropdown = document.getElementById(dropdownIds[type]);
        if (targetDropdown) {
            targetDropdown.classList.toggle('hidden');
        }
    }

    /**
     * Close all dropup menus
     */
    closeAllDropups() {
        document.querySelectorAll('.picker-dropdown').forEach(dropdown => {
            dropdown.classList.add('hidden');
        });
    }

    /**
     * Select image to send
     */
    selectImage() {
        // Create hidden file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                this.addChatBubble('system', `📷 Selected: ${file.name}`);
                // TODO: Implement image upload to server
                console.log('Image selected:', file);
            }
        };
        input.click();
    }

    loadSavedSettings() {
        const savedUrl = localStorage.getItem('phonebridge_server_url');
        const savedRepo = localStorage.getItem('phonebridge_repo_path');

        if (savedUrl) {
            this.elements.serverUrlInput.value = savedUrl;
        } else {
            const currentOrigin = window.location.origin;
            if (currentOrigin && currentOrigin !== 'null' && !currentOrigin.includes('localhost')) {
                this.elements.serverUrlInput.value = currentOrigin;
            } else {
                this.elements.serverUrlInput.value = 'http://localhost:8000';
            }
        }

        if (savedRepo) {
            this.elements.repoPathInput.value = savedRepo;
        } else if (this.elements.repoPathInput) {
            this.elements.repoPathInput.value = 'auto-connect';
        }
    }

    async loadServerMessageSettings() {
        if (!this.serverUrl) {
            return;
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/settings/messages`);
            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json().catch(() => ({}));
            const parsed = Number.parseInt(data.max_messages, 10);
            if (Number.isFinite(parsed)) {
                this.maxHistoryMessages = parsed;
                localStorage.setItem('phonebridge_max_messages', this.maxHistoryMessages.toString());
            }
        } catch (err) {
            console.log('Load max messages skipped:', err.message);
        } finally {
            if (this.elements.maxMessagesInput) {
                this.elements.maxMessagesInput.value = this.maxHistoryMessages;
            }
            this.setMaxMessagesDirty(false);
        }
    }


    handleMaxMessagesInput() {
        if (!this.elements.maxMessagesInput) {
            return;
        }

        const rawValue = Number.parseInt(this.elements.maxMessagesInput.value, 10);
        if (!Number.isFinite(rawValue)) {
            this.elements.maxMessagesInput.value = this.maxHistoryMessages;
            return;
        }

        const clamped = Math.max(1, Math.min(rawValue, 500));
        this.elements.maxMessagesInput.value = clamped;
        this.setMaxMessagesDirty(clamped !== this.maxHistoryMessages);
    }

    setMaxMessagesDirty(isDirty) {
        this.maxMessagesDirty = isDirty;
        if (this.elements.saveMaxMessagesBtn) {
            this.elements.saveMaxMessagesBtn.disabled = !isDirty;
        }
    }

    async saveMaxMessages() {
        await this.applyMaxMessagesSetting();
    }

    async applyMaxMessagesSetting() {
        if (!this.elements.maxMessagesInput) {
            return false;
        }

        const rawValue = Number.parseInt(this.elements.maxMessagesInput.value, 10);
        if (!Number.isFinite(rawValue)) {
            this.elements.maxMessagesInput.value = this.maxHistoryMessages;
            return false;
        }

        const clamped = Math.max(1, Math.min(rawValue, 500));
        this.elements.maxMessagesInput.value = clamped;

        if (!this.serverUrl) {
            this.addChatBubble('system', '?? Please connect before saving max messages.');
            return false;
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/settings/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_messages: clamped })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Update failed');
            }

            this.maxHistoryMessages = clamped;
            localStorage.setItem('phonebridge_max_messages', clamped.toString());
            this.setMaxMessagesDirty(false);
            return true;
        } catch (err) {
            this.addChatBubble('system', `?? Update max messages failed: ${err.message}`);
            return false;
        }
    }

    saveSettings() {
        localStorage.setItem('phonebridge_server_url', this.serverUrl);
        localStorage.setItem('phonebridge_repo_path', this.elements.repoPathInput.value);
    }

    // ==================== CONNECTION ====================

    async connect() {
        const serverUrl = this.elements.serverUrlInput.value.trim();
        const repoPath = this.elements.repoPathInput.value.trim();
        const resolvedRepoPath = repoPath || 'auto-connect';

        if (!serverUrl) {
            this.showError('Vui lòng nhập địa chỉ Server');
            return;
        }

        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.setConnecting(true);
        this.hideError();

        try {
            const response = await fetch(`${this.serverUrl}/api/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_path: resolvedRepoPath })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            this.sessionId = data.session_id;

            await this.connectWebSocket();
            this.saveSettings();
            this.showMainScreen();
            await this.loadServerMessageSettings();
            if (this.currentView === 'snapshot') {
                this.startSnapshotPolling();
            }

        } catch (err) {
            console.error('Connection failed:', err);
            this.showError(`Connection failed: ${err.message}`);
        } finally {
            this.setConnecting(false);
        }
    }

    connectWebSocket() {
        return new Promise((resolve, reject) => {
            const wsUrl = this.serverUrl.replace('http', 'ws') + `/ws/${this.sessionId}`;

            this.ws = new WebSocket(wsUrl);
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 10;

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus(true);
                this.startHeartbeat();
                this.startChatPolling();
                resolve();
            };

            this.ws.onclose = (event) => {
                console.log('⚠️ WebSocket disconnected:', event.code, event.reason);
                this.isConnected = false;
                this.updateConnectionStatus(false);
                this.stopHeartbeat();
                this.stopSnapshotPolling();

                if (this.sessionId && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (err) => {
                console.error('❌ WebSocket error:', err);
                reject(new Error('WebSocket connection failed'));
            };

            this.ws.onmessage = (event) => {
                if (event.data === 'pong') return;
                this.handleWebSocketMessage(event);
            };

            setTimeout(() => {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    this.ws.close();
                    reject(new Error('WebSocket connection timeout'));
                }
            }, 5000);
        });
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        console.log(`🔄 Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            if (!this.sessionId) return;

            try {
                await this.connectWebSocket();
            } catch (err) {
                console.error('Reconnect failed:', err);
            }
        }, delay);
    }

    disconnect() {
        this.sessionId = null;
        this.isConnected = false;
        this.stopHeartbeat();
        this.stopChatPolling();
        this.stopSnapshotPolling();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.elements.messagesContainer.innerHTML = '';
        this.elements.mainScreen.classList.remove('active');
        this.elements.connectScreen.classList.add('active');
    }

    switchView(view) {
        if (view === this.currentView) {
            return;
        }
        this.currentView = view;
        if (this.elements.tabButtons) {
            this.elements.tabButtons.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
        }
        if (this.elements.chatPanel) {
            this.elements.chatPanel.classList.toggle('hidden', view !== 'chat');
        }
        if (this.elements.snapshotPanel) {
            this.elements.snapshotPanel.classList.toggle('hidden', view !== 'snapshot');
        }

        if (this.elements.chatInput) {
            this.elements.chatInput.placeholder = view === 'snapshot'
                ? 'Send message to Antigravity...'
                : 'Enter command for AI agent...';
        }

        if (view === 'snapshot') {
            this.startSnapshotPolling();
        } else {
            this.stopSnapshotPolling();
        }
    }

    startSnapshotPolling() {
        if (this.snapshotPollTimer || !this.serverUrl) {
            return;
        }
        this.fetchSnapshot();
        this.snapshotPollTimer = setInterval(() => {
            this.fetchSnapshot();
        }, 3000);
    }

    stopSnapshotPolling() {
        if (this.snapshotPollTimer) {
            clearInterval(this.snapshotPollTimer);
            this.snapshotPollTimer = null;
        }
    }

    async fetchSnapshot() {
        if (!this.serverUrl || !this.elements.snapshotRoot) {
            return;
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/snapshot`);
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `Snapshot error: ${response.status}`);
            }

            const data = await response.json();
            if (!data || !data.html) {
                this.setSnapshotStatus('Snapshot chưa sẵn sàng.');
                return;
            }

            if (data.hash && data.hash === this.lastSnapshotHash) {
                return;
            }
            this.lastSnapshotHash = data.hash || null;
            this.renderSnapshot(data);
        } catch (err) {
            this.setSnapshotStatus(`Snapshot lỗi: ${err.message}`);
        }
    }

    setSnapshotStatus(message) {
        if (this.elements.snapshotStatus) {
            this.elements.snapshotStatus.textContent = message;
        }
    }

    renderSnapshot(data) {
        const root = this.elements.snapshotRoot;
        if (!root) {
            return;
        }

        const safeHtml = this.sanitizeAntigravityContent(data.html || '');
        const css = data.css || '';
        root.style.background = data.bodyBg || 'transparent';
        root.style.color = data.bodyColor || 'inherit';
        root.innerHTML = `<style>${css}</style>${safeHtml}`;
        this.setSnapshotStatus('Snapshot đang cập nhật...');
    }

    async sendSnapshotMessage(message) {
        this.addChatBubble('user', message);
        this.showThinkingIndicator();

        try {
            await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    message: message,
                    send_mode: 'cdp'
                })
            });
        } catch (err) {
            console.error('Failed to send snapshot message:', err);
            this.addChatBubble('system', `❌ Lỗi gửi: ${err.message}`);
        }
    }

    async startChatPolling() {
        if (!this.sessionId || !this.serverUrl) return;

        try {
            await fetch(`${this.serverUrl}/api/response/start-chat-polling`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    intervalMs: 2000
                })
            });
            console.log('✅ Chat polling started');
        } catch (err) {
            console.error('Failed to start chat polling:', err);
        }
    }

    async stopChatPolling() {
        if (!this.serverUrl) return;

        try {
            await fetch(`${this.serverUrl}/api/response/stop-chat-polling`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            console.error('Failed to stop chat polling:', err);
        }
    }

    // ==================== UI HELPERS ====================

    setConnecting(connecting) {
        const btnText = this.elements.connectBtn.querySelector('.btn-text');
        const btnLoading = this.elements.connectBtn.querySelector('.btn-loading');

        if (connecting) {
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');
            this.elements.connectBtn.disabled = true;
        } else {
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
            this.elements.connectBtn.disabled = false;
        }
    }

    showError(message) {
        this.elements.connectError.textContent = message;
        this.elements.connectError.classList.remove('hidden');
    }

    hideError() {
        this.elements.connectError.classList.add('hidden');
    }

    showMainScreen() {
        this.elements.connectScreen.classList.remove('active');
        this.elements.mainScreen.classList.add('active');
        this.updateSettingsInfo();
    }

    updateConnectionStatus(connected) {
        if (this.elements.statusDot) {
            this.elements.statusDot.classList.toggle('disconnected', !connected);
        }
        this.updateSettingsInfo();

        // Reset nút Restart khi kết nối lại thành công
        if (connected) {
            const restartBtn = document.querySelector('.btn-restart');
            if (restartBtn) {
                restartBtn.disabled = false;
                restartBtn.textContent = '🔄 Restart Server';
            }
        }
    }

    updateSettingsInfo() {
        if (this.elements.settingsSessionId) {
            this.elements.settingsSessionId.textContent = this.sessionId || '--';
        }
        if (this.elements.settingsConnectionStatus) {
            this.elements.settingsConnectionStatus.textContent = this.isConnected ? 'Đã kết nối' : 'Mất kết nối';
            this.elements.settingsConnectionStatus.className = 'connection-badge ' + (this.isConnected ? 'connected' : 'disconnected');
        }
    }

    // ==================== CHAT ====================

    async sendMessage() {
        const message = this.elements.chatInput.value.trim();
        if (!message || !this.isConnected) return;

        this.elements.chatInput.value = '';
        this.elements.chatInput.style.height = 'auto';

        // Add user message to UI (no notification needed)
        this.addChatBubble('user', message);
        this.showThinkingIndicator();

        try {
            await fetch(`${this.serverUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    message: message,
                    send_mode: 'cdp' // Always use CDP injection
                })
            });
            // No notification shown - just send silently
        } catch (err) {
            console.error('Failed to send message:', err);
            this.addChatBubble('system', `❌ Lỗi gửi: ${err.message} `);
        }
    }

    renderMarkdown(text) {
        if (typeof marked !== 'undefined') {
            try {
                marked.setOptions({
                    breaks: true,
                    gfm: true,
                    headerIds: false,
                    mangle: false
                });
                return marked.parse(text);
            } catch (e) {
                console.error('Marked.js error:', e);
            }
        }

        // Fallback
        return text
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }

    /**
     * Sanitize content from Antigravity - keep EVERYTHING per user request
     * Only remove script tags for security
     */
    sanitizeAntigravityContent(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Security only: remove scripts
        temp.querySelectorAll('script, noscript').forEach(el => el.remove());

        return temp.innerHTML;
    }

    /**
     * Parse [Image: path] patterns and convert to clickable thumbnails
     */
    parseImageLinks(html) {
        // Pattern: [Image: path] where path must end with common image extensions
        const imagePattern = /\[Image:\s*([^\]]+\.(jpe?g|png|gif|webp|bmp))\]/gi;

        return html.replace(imagePattern, (match, imagePath) => {
            // Extract filename from path
            const filename = imagePath.split(/[\\\/]/).pop();
            const imageUrl = `/uploads/${filename}`;

            return `
                <div class="chat-image-wrapper" onclick="window.open('${imageUrl}', '_blank')">
                    <img src="${imageUrl}" class="chat-thumbnail" alt="Image" 
                         onerror="this.style.display='none'; this.parentElement.innerHTML='[Image not found]';">
                </div>
            `;
        });
    }

    // ==================== WEBSOCKET HANDLER ====================

    handleWebSocketMessage(event) {
        try {
            const { type, data, ts } = JSON.parse(event.data);

            switch (type) {
                case 'status':
                    console.log('Status:', data.message);
                    break;

                case 'plan':
                    this.addChatBubble('assistant', data.markdown);
                    break;

                case 'ai_messages':
                    // Messages từ chat_bridge_ws.js (auto-injected script)
                    this.handleAiMessages(data);
                    break;

                case 'chat_update':
                    this.handleChatUpdate(data);
                    break;

                case 'chat_complete':
                    this.handleChatComplete(data);
                    break;

                case 'error':
                    this.addChatBubble('system', `❌ Lỗi: ${data.message || 'Lỗi không xác định'}`);
                    break;

                // Action notifications
                case 'pending_action':
                    this.handlePendingAction(data);
                    break;

                case 'action_accepted':
                    this.handleActionResolved(data, 'accepted');
                    break;

                case 'action_rejected':
                    this.handleActionResolved(data, 'rejected');
                    break;

                case 'action_timeout':
                    this.handleActionResolved(data, 'timeout');
                    break;
            }
        } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
        }
    }

    /**
     * Handle ai_messages từ chat_bridge_ws.js (injected vào Antigravity)
     * Đây là event chính để nhận AI responses
     */
    handleAiMessages(data) {
        if (!data.messages || data.messages.length === 0) return;

        data.messages.forEach(msg => {
            // Prefer HTML (already rendered from Antigravity) over text
            const content = msg.html || msg.text;
            const isHtml = !!msg.html;

            if (msg.isStreaming) {
                this.showThinkingIndicator();
                // Streaming - update bubble (use text for streaming as it's incomplete)
                this.updateStreamingBubble(msg.text);
            } else if (msg.isComplete) {
                this.scheduleHideThinkingIndicator();
                // Complete message - use HTML if available
                if (this.streamingBubble) {
                    this.streamingBubble.remove();
                    this.streamingBubble = null;
                }
                this.addChatBubble('assistant', content, isHtml);
            } else {
                // Regular message - use HTML if available
                this.scheduleHideThinkingIndicator();
                this.addChatBubble(msg.role || 'assistant', content, isHtml);
            }
        });
    }

    handleChatUpdate(data) {
        if (!data.messages || data.messages.length === 0) return;

        if (data.partial) {
            data.messages.forEach(msg => {
                if (msg.role === 'assistant' || msg.role === 'unknown') {
                    this.showThinkingIndicator();
                    // Prefer HTML over text for rich formatting
                    const content = msg.html || msg.text;
                    const isHtml = !!msg.html;
                    this.updateStreamingBubble(content, isHtml);
                }
            });
        } else {
            data.messages.forEach(msg => {
                const role = msg.role === 'user' ? 'user' : 'assistant';
                const content = msg.html || msg.text;
                const isHtml = !!msg.html;
                this.addChatBubble(role, content, isHtml);
            });
            this.scheduleHideThinkingIndicator();
        }
    }

    handleChatComplete(data) {
        // Prefer HTML over text for rich formatting (tables, code blocks)
        const finalContent = data.html || data.content || data.text || '';
        const isHtml = !!data.html;

        if (this.streamingBubble) {
            this.streamingBubble.remove();
            this.streamingBubble = null;
        }

        this.partialMessageIds.clear();
        this.scheduleHideThinkingIndicator();

        if (finalContent && finalContent.length > 0) {
            this.addChatBubble('assistant', finalContent, isHtml);

            // Force scroll after DOM update for final message
            setTimeout(() => {
                const messages = this.elements.messagesContainer.querySelectorAll('.message');
                const lastMessage = messages[messages.length - 1];
                if (lastMessage) {
                    lastMessage.scrollIntoView({ behavior: 'auto', block: 'end' });
                }
            }, 100);
        }
    }

    updateStreamingBubble(content, isHtml = false) {
        if (!this.streamingBubble) {
            this.streamingBubble = document.createElement('div');
            this.streamingBubble.className = 'message assistant streaming';
            this.streamingBubble.innerHTML = `<div class="streaming-indicator">●</div><div class="message-text"></div>`;
            this.elements.messagesContainer.appendChild(this.streamingBubble);
        }

        const textEl = this.streamingBubble.querySelector('.message-text');
        if (textEl) {
            // Sanitize HTML to remove @ icons, then render
            if (isHtml) {
                textEl.innerHTML = this.sanitizeAntigravityContent(content);
            } else {
                textEl.innerHTML = this.renderMarkdown(content);
            }
        }

        // Auto-scroll to bottom - IMMEDIATE scroll
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        requestAnimationFrame(() => {
            this.streamingBubble.scrollIntoView({ behavior: 'auto', block: 'end' });
        });
    }

    showThinkingIndicator() {
        if (!this.elements.thinkingIndicator) return;
        this.elements.thinkingIndicator.classList.remove('hidden');
        if (this.thinkingHideTimer) {
            clearTimeout(this.thinkingHideTimer);
            this.thinkingHideTimer = null;
        }
    }

    scheduleHideThinkingIndicator() {
        if (!this.elements.thinkingIndicator) return;
        if (this.thinkingHideTimer) {
            clearTimeout(this.thinkingHideTimer);
        }
        this.thinkingHideTimer = setTimeout(() => {
            this.elements.thinkingIndicator.classList.add('hidden');
            this.thinkingHideTimer = null;
        }, 4000);
    }

    addChatBubble(role, text, isHtml = false) {
        const bubble = document.createElement('div');
        bubble.className = `message ${role}`;

        // If isHtml is true, sanitize then use content (remove @ icons from Antigravity)
        // Otherwise, render markdown
        let content;
        if (isHtml) {
            content = this.sanitizeAntigravityContent(text);
        } else {
            content = this.renderMarkdown(text);
        }

        // Parse [Image: path] and convert to actual images
        content = this.parseImageLinks(content);

        bubble.innerHTML = content;

        // Add collapse handlers for Antigravity elements (thinking, tasks)
        this.attachCollapseHandlers(bubble);

        this.elements.messagesContainer.appendChild(bubble);

        // Auto-scroll to new message - IMMEDIATE scroll  
        this.elements.messagesContainer.scrollTop = this.elements.messagesContainer.scrollHeight;
        requestAnimationFrame(() => {
            bubble.scrollIntoView({ behavior: 'auto', block: 'end' });
        });
    }

    /**
     * Attach collapse handlers to thinking sections and task progress
     */
    attachCollapseHandlers(element) {
        // Find all collapsible buttons in thinking/task sections
        const collapseButtons = element.querySelectorAll('.isolate button, [role="button"]');

        collapseButtons.forEach(btn => {
            // Check if it's a collapse toggle (has arrow icon or "Collapse all" text)
            const hasArrow = btn.querySelector('svg.lucide-chevron-down, svg.lucide-chevron-up');
            const isCollapseBtn = btn.textContent.includes('Collapse') || btn.textContent.includes('Thought for');

            if (hasArrow || isCollapseBtn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // Find the collapsible content (next sibling or parent's next sibling)
                    let content = btn.nextElementSibling;
                    if (!content || !content.classList.contains('overflow-hidden')) {
                        // Try parent's next sibling (for nested structures)
                        content = btn.closest('.flex')?.nextElementSibling;
                    }

                    const arrow = btn.querySelector('svg');

                    if (content) {
                        // Toggle visibility
                        const isHidden = content.style.maxHeight === '0px' || content.style.display === 'none';

                        if (isHidden) {
                            content.style.maxHeight = '50vh';
                            content.style.opacity = '1';
                            content.style.display = 'block';
                        } else {
                            content.style.maxHeight = '0px';
                            content.style.opacity = '0';
                            content.style.display = 'none';
                        }

                        // Rotate arrow if exists
                        if (arrow) {
                            const currentRotation = arrow.style.transform || 'rotate(0deg)';
                            arrow.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
                            arrow.style.transition = 'transform 0.2s ease';
                        }
                    }
                });
            }
        });

        // Default collapse task progress sections (per HTML_CHAT.txt)
        const taskProgressSections = element.querySelectorAll('.overflow-y-auto, .overflow-hidden');
        taskProgressSections.forEach(section => {
            // Check if this is a "Progress Updates" section in a task
            const parentIsolate = section.closest('.isolate');
            if (parentIsolate && section.textContent &&
                (section.textContent.includes('Progress Updates') ||
                    section.textContent.includes('Ran terminal') ||
                    section.textContent.includes('Analyzed'))) {
                // Collapse by default
                section.style.maxHeight = '0px';
                section.style.opacity = '0';
                section.style.display = 'none';
            }
        });
    }

    // ==================== SETTINGS ====================

    toggleSettings() {
        this.elements.settingsModal.classList.toggle('hidden');
        this.updateSettingsInfo();
    }

    setFontSize(size) {
        this.fontSize = parseInt(size);
        this.applySettings();
        this.saveUISettings();
    }

    setLayoutScale(scale) {
        this.layoutScale = parseInt(scale);
        this.applySettings();
        this.saveUISettings();
    }

    applySettings() {
        // Apply font size
        document.body.style.fontSize = this.fontSize + 'px';
        if (this.elements.fontSizeDisplay) {
            this.elements.fontSizeDisplay.textContent = this.fontSize + 'px';
        }
        if (this.elements.fontSizeSlider) {
            this.elements.fontSizeSlider.value = this.fontSize;
        }
        // Apply layout scale - CENTER ORIGIN (Requested by User)
        // 1. Scale down (e.g. 0.9)
        // 2. Increase width inversely (e.g. 111.11%)
        // 3. Center the wider body using negative margin
        const scale = this.layoutScale / 100;
        document.body.style.transform = `scale(${scale})`;
        document.body.style.transformOrigin = 'top center';

        const widthPercent = 10000 / this.layoutScale;
        document.body.style.width = `${widthPercent}%`;
        document.body.style.height = `${widthPercent}%`;

        // Calculate margin to center the wider body in the viewport
        // (100 - Width) / 2. Example: (100 - 111.11) / 2 = -5.55%
        document.body.style.marginLeft = `${(100 - widthPercent) / 2}%`;
        document.body.style.marginRight = 'auto';

        document.body.style.overflowX = 'hidden';

        if (this.elements.layoutScaleDisplay) {
            this.elements.layoutScaleDisplay.textContent = this.layoutScale + '%';
        }
        if (this.elements.layoutScaleSlider) {
            this.elements.layoutScaleSlider.value = this.layoutScale;
        }
    }

    saveUISettings() {
        localStorage.setItem('phonebridge_font_size', this.fontSize.toString());
        localStorage.setItem('phonebridge_layout_scale', this.layoutScale.toString());
    }

    async clearMessenger() {
        const confirmed = window.confirm('Clear all messages and images?');
        if (!confirmed) return;

        try {
            const response = await fetch(`${this.serverUrl}/api/clear-messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Clear failed');
            }

            const result = await response.json().catch(() => ({}));

            if (this.elements.messagesContainer) {
                this.elements.messagesContainer.innerHTML = '';
            }
            if (this.streamingBubble) {
                this.streamingBubble.remove();
                this.streamingBubble = null;
            }
            this.partialMessageIds.clear();
            if (this.elements.thinkingIndicator) {
                this.elements.thinkingIndicator.classList.add('hidden');
            }

            const deletedImages = result.deleted_images || 0;
            this.addChatBubble('system', `✅ Cleared messages and ${deletedImages} images`);
        } catch (err) {
            this.addChatBubble('system', `❌ Clear failed: ${err.message}`);
        }
    }

    async restartServer() {
        const btn = document.querySelector('.btn-restart');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Đang restart...';
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/restart`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                this.addChatBubble('system', '🔄 Server đang khởi động lại... Vui lòng đợi 5 giây.');
                this.toggleSettings();

                // Disconnect and reconnect after delay
                this.isConnected = false;
                this.updateConnectionStatus(false);

                setTimeout(() => {
                    this.addChatBubble('system', '🔄 Đang kết nối lại...');
                    this.connect();
                }, 5000);
            } else {
                throw new Error('Restart failed');
            }
        } catch (error) {
            this.addChatBubble('system', '❌ Không thể restart server: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 Restart Server';
            }
        }
    }

    /**
     * Shutdown Server - Tắt hoàn toàn server
     */
    async shutdownServer() {
        if (!confirm('⚠️ Bạn có chắc muốn TẮT server? Server sẽ không tự khởi động lại!')) {
            return;
        }

        const btn = document.querySelector('.btn-shutdown');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Đang tắt...';
        }

        try {
            const response = await fetch(`${this.serverUrl}/api/shutdown`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                this.addChatBubble('system', '⛔ Server đã được tắt. Bạn cần khởi động lại thủ công.');
                this.toggleSettings();
                this.isConnected = false;
                this.updateConnectionStatus(false);
            } else {
                throw new Error('Shutdown failed');
            }
        } catch (error) {
            this.addChatBubble('system', '❌ Không thể tắt server: ' + error.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '⛔ Shutdown Server';
            }
        }
    }

    /**
     * Toggle Fullscreen Mode - Ẩn thanh URL trình duyệt
     */
    toggleFullscreen() {
        const btn = document.querySelector('.btn-fullscreen');

        if (!document.fullscreenElement) {
            // Enter fullscreen
            document.documentElement.requestFullscreen().then(() => {
                if (btn) btn.textContent = '🖥️ Exit Fullscreen';
                this.addChatBubble('system', '🖥️ Đã bật chế độ toàn màn hình. Nhấn ESC hoặc F11 để thoát.');
            }).catch(err => {
                this.addChatBubble('system', '❌ Không thể bật fullscreen: ' + err.message);
            });
        } else {
            // Exit fullscreen
            document.exitFullscreen().then(() => {
                if (btn) btn.textContent = '🖥️ Fullscreen Mode';
            });
        }

        this.toggleSettings();
    }

    // ==================== ACTION BUBBLE ====================

    /**
     * Handle pending action notification
     */
    handlePendingAction(data) {
        if (!data || !data.id) return;

        // Add to pending map
        this.pendingActions.set(data.id, data);
        console.log(`📥 Pending action: ${data.id} (${data.type || 'unknown'})`);

        // Update bubble
        this.updateActionBubble();
    }

    /**
     * Handle action resolved (accepted/rejected/timeout)
     */
    handleActionResolved(data, status) {
        if (!data || !data.id) return;

        // Remove from pending map
        this.pendingActions.delete(data.id);
        console.log(`✅ Action ${status}: ${data.id}`);

        // Update bubble
        this.updateActionBubble();
    }

    /**
     * Update the action UI state (Badge & Menu)
     */
    updateActionBubble() {
        const count = this.pendingActions.size;
        const badge = this.elements.pendingBadge;

        if (count === 0) {
            badge?.classList.add('hidden');
        } else {
            badge?.classList.remove('hidden');
            if (badge) badge.textContent = count;

            // Handle Auto Mode (silent = no notification spam)
            if (this.isAutoMode) {
                this.acceptAllActions(true);
            }
        }
    }

    /**
 * Toggle the Action Menu (Hamburger)
 * Bấm 1 lần mở, bấm lần nữa đóng
 * Hiện cả model-row (lên trên) và action-menu (ngang)
 */
    toggleActionMenu(forceState) {
        const menu = this.elements.actionMenu;
        const modelRow = document.getElementById('model-row');
        const convModeRow = document.getElementById('conv-mode-row');
        if (!menu) return;

        // Check current state
        const isActive = menu.classList.contains('active');
        const shouldShow = forceState !== undefined ? forceState : !isActive;

        console.log(`🔄 Toggle Menu: isActive=${isActive}, shouldShow=${shouldShow}`);

        if (shouldShow) {
            // Show all menus
            menu.classList.remove('hidden');
            menu.classList.add('active');
            if (modelRow) {
                modelRow.classList.remove('hidden');
                modelRow.classList.add('active');
            }
            if (convModeRow) {
                convModeRow.classList.remove('hidden');
                convModeRow.classList.add('active');
            }
        } else {
            // Hide all menus
            menu.classList.remove('active');
            menu.classList.add('hidden');
            if (modelRow) {
                modelRow.classList.remove('active');
                modelRow.classList.add('hidden');
            }
            if (convModeRow) {
                convModeRow.classList.remove('active');
                convModeRow.classList.add('hidden');
            }
            // Also hide model options
            const options = document.getElementById('model-options');
            if (options) options.classList.add('hidden');
        }
    }

    /**
     * Toggle Model Dropdown (hiện/ẩn các model options)
     */
    toggleModelDropdown() {
        const options = document.getElementById('model-options');
        if (options) {
            options.classList.toggle('hidden');
        }
    }
    /**
     * Toggle Auto-Accept Mode
     */
    async toggleAutoMode() {
        this.isAutoMode = !this.isAutoMode;

        const btn = this.elements.btnOptMode;
        if (btn) {
            btn.textContent = this.isAutoMode ? 'AUTO' : 'MANUAL';
            // Optional: Add visual feedback for active state
            btn.style.borderColor = this.isAutoMode ? 'var(--accent-success)' : 'var(--glass-border)';
            btn.style.color = this.isAutoMode ? 'var(--accent-success)' : 'var(--text-primary)';
        }

        console.log(`🔄 Auto Mode: ${this.isAutoMode ? 'ON' : 'OFF'}`);

        // 1. Send CDP Shortcut to Extension
        try {
            console.log('📡 Sending Toggle Shortcut to Antigravity...');
            await fetch(`${this.serverUrl}/api/actions/toggle-cdp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (err) {
            console.error('❌ Error sending toggle shortcut:', err);
        }

        // 2. Local Auto-Accept Logic (silent = no notification spam)
        if (this.isAutoMode && this.pendingActions.size > 0) {
            this.acceptAllActions(true); // silent mode
        }
    }

    /**
     * Accept all pending actions via CDP shortcut
     * @param {boolean} silent - If true, don't show notification (for auto-accept)
     */
    async acceptAllActions(silent = false) {
        console.log('✅ Accepting all actions via CDP...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/accept-cdp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                // Only show notification if not silent (manual accept)
                if (!silent) {
                    this.addChatBubble('system', `✅ Accept sent! (${result.method})`);
                }
                // Clear local pending actions
                this.pendingActions.clear();
                this.updateActionBubble();
            } else {
                this.addChatBubble('system', `❌ Accept failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Accept error:', err);
            this.addChatBubble('system', `❌ Accept error: ${err.message}`);
        }
    }

    /**
     * Reject all pending actions via CDP shortcut
     */
    async rejectAllActions() {
        console.log('❌ Rejecting all actions via CDP...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/reject-cdp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `❌ Reject sent! (${result.method})`);
                // Clear local pending actions (server will broadcast updates)
                this.pendingActions.clear();
                this.updateActionBubble();
            } else {
                this.addChatBubble('system', `❌ Reject failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Reject error:', err);
            this.addChatBubble('system', `❌ Reject error: ${err.message}`);
        }
    }

    /**
     * Change AI Model via CDP DOM Click
     * @param {string} modelName - Name of the model (e.g., "Claude Opus 4.5")
     */
    async changeModel(modelName) {
        if (!modelName) return;

        console.log(`🎨 Changing model to: ${modelName}...`);

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/change-model`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelName: modelName })
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `🎨 Model changed: ${result.model || modelName}`);
            } else {
                this.addChatBubble('system', `❌ Change model failed: ${result.error || 'Unknown error'}`);
            }

        } catch (err) {
            console.error('Change model error:', err);
            this.addChatBubble('system', `❌ Change model error: ${err.message}`);
        }
    }

    /**
     * Select Model - Highlight button và gửi request
     * @param {HTMLElement} btn - Button element được click
     */
    selectModel(btn) {
        const modelName = btn.dataset.model;
        if (!modelName) return;

        // Remove active class từ tất cả buttons
        document.querySelectorAll('#model-dropdown .dropdown-item').forEach(b => b.classList.remove('active'));

        // Add active class cho button được chọn
        btn.classList.add('active');

        // Update displayed text
        const modelText = document.getElementById('current-model-text');
        if (modelText) modelText.textContent = btn.textContent.trim();

        // Close dropdown
        this.closeAllDropups();

        // Gửi request đổi model
        this.changeModel(modelName);
    }

    /**
     * Select Conversation Mode - Highlight button và gửi request
     * @param {HTMLElement} btn - Button element được click
     */
    selectConvMode(btn) {
        const modeName = btn.dataset.mode;
        if (!modeName) return;

        // Remove active class từ tất cả buttons
        document.querySelectorAll('#mode-dropdown .dropdown-item').forEach(b => b.classList.remove('active'));

        // Add active class cho button được chọn
        btn.classList.add('active');

        // Update displayed text
        const modeText = document.getElementById('current-mode');
        if (modeText) modeText.textContent = btn.textContent.trim();

        // Close dropdown
        this.closeAllDropups();

        // Gửi request đổi mode
        this.changeConvMode(modeName);
    }

    /**
     * Change Conversation Mode via CDP Click
     * @param {string} modeName - "Planning" hoặc "Fast"
     */
    async changeConvMode(modeName) {
        if (!modeName) return;

        console.log(`📋 Changing conversation mode to: ${modeName}...`);

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/change-conv-mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modeName: modeName })
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `📋 Mode changed: ${result.mode || modeName}`);
            } else {
                this.addChatBubble('system', `❌ Change mode failed: ${result.error || 'Unknown error'}`);
            }

        } catch (err) {
            console.error('Change conv mode error:', err);
            this.addChatBubble('system', `❌ Change mode error: ${err.message}`);
        }
    }

    // ==================== CDP CLICK FUNCTIONS (v3.0.0) ====================

    /**
     * Accept by CDP Click (KHÔNG cần Extension)
     */
    async acceptByClick() {
        console.log('🟢 Accepting by CDP Click...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/accept-click`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `✅ Accept clicked! (${result.method || 'CDP'})`);
                this.pendingActions.clear();
                this.updateActionBubble();
            } else {
                this.addChatBubble('system', `❌ Accept failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Accept click error:', err);
            this.addChatBubble('system', `❌ Accept error: ${err.message}`);
        }
    }

    /**
     * Reject by CDP Click (KHÔNG cần Extension)
     */
    async rejectByClick() {
        console.log('🔴 Rejecting by CDP Click...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/reject-click`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `❌ Reject clicked! (${result.method || 'CDP'})`);
                this.pendingActions.clear();
                this.updateActionBubble();
            } else {
                this.addChatBubble('system', `❌ Reject failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Reject click error:', err);
            this.addChatBubble('system', `❌ Reject error: ${err.message}`);
        }
    }

    /**
     * Stop AI Generation by CDP Click
     */
    async stopGeneration() {
        console.log('⏹️ Stopping generation...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                this.addChatBubble('system', `⏹️ Generation stopped!`);
            } else {
                this.addChatBubble('system', `⚠️ Stop: ${result.error || 'Button not found'}`);
            }
        } catch (err) {
            console.error('Stop error:', err);
            this.addChatBubble('system', `❌ Stop error: ${err.message}`);
        }
    }

    /**
     * Get Current State from Antigravity
     */
    async getState() {
        console.log('📊 Getting state...');

        try {
            const response = await fetch(`${this.serverUrl}/api/actions/state`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                const stateMsg = `📊 **State:**
- Model: ${result.currentModel || 'Unknown'}
- Pending Actions: ${result.pendingActions || 0}
- Streaming: ${result.isStreaming ? 'Yes' : 'No'}
- Messages: ${result.messageCount || 0}`;
                this.addChatBubble('system', stateMsg);
            } else {
                this.addChatBubble('system', `❌ Get state failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err) {
            console.error('Get state error:', err);
            this.addChatBubble('system', `❌ Get state error: ${err.message}`);
        }
    }
}

// Initialize app
const app = new PhoneBridgeApp();

// ==================== KEYBOARD LAYOUT FIX ====================

/**
 * Fix layout when mobile keyboard opens
 * Prevents chat from being pushed below keyboard
 */
function initKeyboardFix() {
    let initialHeight = window.innerHeight;

    // Detect keyboard open/close
    window.addEventListener('resize', () => {
        const currentHeight = window.innerHeight;
        const messagesContainer = document.getElementById('messages');

        if (currentHeight < initialHeight * 0.75) {
            // Keyboard is open - scroll to bottom
            if (messagesContainer) {
                setTimeout(() => {
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }, 100);
            }
        }
    });

    // Scroll to bottom when new message arrives (if keyboard is open)
    const observer = new MutationObserver(() => {
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer && window.innerHeight < initialHeight * 0.75) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    });

    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        observer.observe(messagesContainer, { childList: true, subtree: true });
    }
}

// Initialize keyboard fix on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initKeyboardFix);
} else {
    initKeyboardFix();
}
