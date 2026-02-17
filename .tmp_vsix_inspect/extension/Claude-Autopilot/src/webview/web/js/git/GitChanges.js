import { 
    GIT_STATUS, 
    GIT_STATUS_ICONS, 
    DIFF_VIEW_MODE, 
    DIFF_VIEW_LABELS 
} from '../constants.js';
import { getLanguageFromExtension, applySyntaxHighlightingToText } from '../utils/syntax.js';
import { escapeHtml } from '../utils/html.js';

export class GitChanges {
    constructor() {
        this.isExpanded = true; // Always expanded since toggle is removed
        this.gitFiles = [];
        this.currentDiffFile = null;
        this.currentDiffMode = DIFF_VIEW_MODE.INLINE;
        this.refreshInterval = null;
        
        // Check if we're on desktop (1025px+)
        this.isDesktop = window.matchMedia('(min-width: 1025px)').matches;
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupResponsiveHandler();
        this.initializeDiffMode();
        this.loadGitStatus();
        
        // Auto-refresh every 30 seconds (always check for file count)
        this.refreshInterval = setInterval(() => {
            this.loadGitStatus();
        }, 30000);
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
            // On desktop: ensure git main section content is visible, but subsections remain toggleable
            const gitContent = document.getElementById('git-content');
            if (gitContent) gitContent.style.display = 'block';
        }
    // On mobile: keep current toggle states as they are
    // Note: Git subsections remain collapsible on both desktop and mobile
    }

    initializeDiffMode() {
        const diffModeSpan = document.getElementById('diff-mode');
        if (diffModeSpan) {
            diffModeSpan.textContent = DIFF_VIEW_LABELS[this.currentDiffMode];
        }
    }

    setupEventListeners() {
    // Toggle git section
        const gitToggle = document.getElementById('git-toggle');
        if (gitToggle) {
            gitToggle.addEventListener('click', () => this.toggleSection());
        }

        // Toggle versioned files subsection
        const versionedToggle = document.getElementById('versioned-toggle');
        if (versionedToggle) {
            versionedToggle.addEventListener('click', () => this.toggleSubsection('versioned'));
        }

        // Toggle unversioned files subsection
        const unversionedToggle = document.getElementById('unversioned-toggle');
        if (unversionedToggle) {
            unversionedToggle.addEventListener('click', () => this.toggleSubsection('unversioned'));
        }

        // Refresh git status
        const refreshGit = document.getElementById('refresh-git');
        if (refreshGit) {
            refreshGit.addEventListener('click', () => this.loadGitStatus());
        }

        // Diff viewer modal
        const closeDiff = document.getElementById('close-diff');
        if (closeDiff) {
            closeDiff.addEventListener('click', () => this.closeDiffViewer());
        }

        // Toggle diff mode
        const toggleDiffMode = document.getElementById('toggle-diff-mode');
        if (toggleDiffMode) {
            toggleDiffMode.addEventListener('click', () => this.toggleDiffMode());
        }

        // Modal click outside to close
        const diffModal = document.getElementById('diff-viewer-modal');
        if (diffModal) {
            diffModal.addEventListener('click', (e) => {
                if (e.target === diffModal) {
                    this.closeDiffViewer();
                }
            });
        }
    }

    async toggleSection() {
    // On desktop, main sections are not collapsible
        if (this.isDesktop) {
            return;
        }
        
        this.isExpanded = !this.isExpanded;
        const content = document.getElementById('git-content');
        const toggle = document.getElementById('git-toggle');
        const icon = toggle.querySelector('.toggle-icon');
        
        if (this.isExpanded) {
            content.style.display = 'block';
            icon.textContent = '▼';
            toggle.setAttribute('data-expanded', 'true');
            await this.loadGitStatus();
        } else {
            content.style.display = 'none';
            icon.textContent = '▶';
            toggle.setAttribute('data-expanded', 'false');
        }
    }

    toggleSubsection(section) {
    // Git subsections are collapsible on both desktop and mobile
        const toggle = document.getElementById(`${section}-toggle`);
        const content = document.getElementById(`${section}-content`);
        const icon = toggle.querySelector('.toggle-icon');
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        
        if (isExpanded) {
            content.style.display = 'none';
            icon.textContent = '▶';
            toggle.setAttribute('data-expanded', 'false');
        } else {
            content.style.display = 'block';
            icon.textContent = '▼';
            toggle.setAttribute('data-expanded', 'true');
        }
    }

    async loadGitStatus() {
    // Always update file counter, but only show loading/render when expanded
        if (this.isExpanded) {
            this.showLoading();
        }
        
        try {
            const response = await fetch('/api/git/status', {
                headers: {
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const status = await response.json();
            this.renderGitStatus(status);
            
        } catch (error) { // eslint-disable-line no-unused-vars
            if (this.isExpanded) {
                this.showError('Failed to load git status');
            }
        } finally {
            if (this.isExpanded) {
                this.hideLoading();
            }
        }
    }

    renderGitStatus(status) {
        this.gitFiles = status.files;
        
        // Categorize files into versioned and unversioned
        const versionedFiles = status.files.filter(file => file.status !== GIT_STATUS.UNTRACKED);
        const unversionedFiles = status.files.filter(file => file.status === GIT_STATUS.UNTRACKED);
        
        // Always update file counters
        this.updateFileCounters(versionedFiles.length, unversionedFiles.length, status.files.length);
        
        // Only render file lists when expanded
        if (this.isExpanded) {
            this.renderFileLists(versionedFiles, unversionedFiles, status.isClean);
        }
    }

    renderFileLists(versionedFiles, unversionedFiles, isClean) {
        const versionedSection = document.getElementById('versioned-section');
        const unversionedSection = document.getElementById('unversioned-section');
        const versionedFilesContainer = document.getElementById('versioned-files');
        const unversionedFilesContainer = document.getElementById('unversioned-files');
        const gitClean = document.getElementById('git-clean');
        
        if (isClean || (versionedFiles.length === 0 && unversionedFiles.length === 0)) {
            versionedSection.style.display = 'none';
            unversionedSection.style.display = 'none';
            gitClean.style.display = 'flex';
            return;
        }
        
        gitClean.style.display = 'none';
        
        // Show/hide sections based on content
        if (versionedFiles.length > 0) {
            versionedSection.style.display = 'block';
            versionedFilesContainer.innerHTML = versionedFiles.map(file => this.createFileItem(file)).join('');
        } else {
            versionedSection.style.display = 'none';
        }
        
        if (unversionedFiles.length > 0) {
            unversionedSection.style.display = 'block';
            unversionedFilesContainer.innerHTML = unversionedFiles.map(file => this.createFileItem(file)).join('');
        } else {
            unversionedSection.style.display = 'none';
        }
        
        // Add event listeners to file items in both sections
        this.attachFileEventListeners();
    }

    createFileItem(file) {
        const statusIcon = this.getStatusIcon(file.status);
        const statusClass = file.status.toLowerCase();
        const additions = file.additions || 0;
        const deletions = file.deletions || 0;
        
        return `
            <div class="git-file-item git-file-item--${statusClass}" data-path="${file.path}" data-status="${file.status}">
                <div class="file-info">
                    <div class="file-status">
                        <span class="status-icon git-file-status--${statusClass}" title="${file.status}">${statusIcon}</span>
                    </div>
                    <div class="file-details">
                        <div class="file-path" title="${file.path}">${file.path}</div>
                        <div class="file-stats">
                            ${additions > 0 ? `<span class="additions git-file-additions">+${additions}</span>` : ''}
                            ${deletions > 0 ? `<span class="deletions git-file-deletions">-${deletions}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    getStatusIcon(status) {
        return GIT_STATUS_ICONS[status] || '📄';
    }

    attachFileEventListeners() {
        const fileItems = document.querySelectorAll('.git-file-item');
        
        fileItems.forEach(item => {
            // Click on file item to view diff
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.file-actions')) {
                    const filePath = item.getAttribute('data-path');
                    this.viewDiff(filePath);
                }
            });
            
            // Action buttons
            const actionButtons = item.querySelectorAll('.action-btn');
            actionButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute('data-action');
                    const filePath = item.getAttribute('data-path');
                    if (action === 'diff') {
                        this.viewDiff(filePath);
                    }
                });
            });
        });
    }

    async viewDiff(filePath) {
        this.currentDiffFile = filePath;
        this.showDiffViewer();
        await this.loadFileDiff(filePath);
    }

    showDiffViewer() {
        const modal = document.getElementById('diff-viewer-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    closeDiffViewer() {
        const modal = document.getElementById('diff-viewer-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentDiffFile = null;
    }

    toggleDiffMode() {
        const toggleBtn = document.getElementById('toggle-diff-mode');
        const diffModeSpan = document.getElementById('diff-mode');
        const diffContent = document.getElementById('diff-content');
        
        if (!toggleBtn || !diffModeSpan || !diffContent) return;

        // Toggle between modes using enum
        if (this.currentDiffMode === DIFF_VIEW_MODE.INLINE) {
            // Switch to Final File View
            this.currentDiffMode = DIFF_VIEW_MODE.FINAL_FILE;
            diffModeSpan.textContent = DIFF_VIEW_LABELS[DIFF_VIEW_MODE.FINAL_FILE];
            toggleBtn.textContent = '📋';
            toggleBtn.title = 'Show diff view';
            diffContent.classList.add('raw-view');
            diffContent.classList.remove('inline-diff');
        } else {
            // Switch to Inline View
            this.currentDiffMode = DIFF_VIEW_MODE.INLINE;
            diffModeSpan.textContent = DIFF_VIEW_LABELS[DIFF_VIEW_MODE.INLINE];
            toggleBtn.textContent = '📄';
            toggleBtn.title = 'Show file view';
            diffContent.classList.add('inline-diff');
            diffContent.classList.remove('raw-view');
        }
        
        // Reload the current file in the new mode
        if (this.currentDiffFile) {
            this.loadFileDiff(this.currentDiffFile);
        }
    }

    async loadFileDiff(filePath) {
        const diffLoading = document.getElementById('diff-loading');
        const diffContent = document.getElementById('diff-content');
        const diffError = document.getElementById('diff-error');
        const diffFileName = document.getElementById('diff-file-name');
        const diffFilePath = document.getElementById('diff-file-path');
        
        // Show loading
        if (diffLoading) diffLoading.style.display = 'flex';
        if (diffContent) diffContent.style.display = 'none';
        if (diffError) diffError.style.display = 'none';
        
        // Update file name and path
        if (diffFileName) diffFileName.textContent = filePath.split('/').pop();
        if (diffFilePath) diffFilePath.textContent = filePath;
        
        // Check if we're in final file view mode
        const isRawView = this.currentDiffMode === DIFF_VIEW_MODE.FINAL_FILE;
        
        try {
            if (isRawView) {
                // Fetch the final file content using the same API as file explorer
                const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`, {
                    headers: {
                        'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                this.renderFinalFile(data.content);
            } else {
                // Fetch the diff
                const response = await fetch(`/api/git/file-diff?path=${encodeURIComponent(filePath)}&compare=working`, {
                    headers: {
                        'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const diff = await response.json();
                this.renderDiff(diff);
            }
            
        } catch (error) { // eslint-disable-line no-unused-vars
            if (diffError) {
                diffError.style.display = 'block';
                diffError.querySelector('.error-text').textContent = 'Failed to load changes';
            }
        } finally {
            if (diffLoading) diffLoading.style.display = 'none';
        }
    }

    renderDiff(diff) {
        const diffContent = document.getElementById('diff-content');
        const diffEditor = document.getElementById('diff-editor');
        const diffAdditions = document.getElementById('diff-additions');
        const diffDeletions = document.getElementById('diff-deletions');
        
        if (diffContent) diffContent.style.display = 'block';
        
        // Update stats
        if (diffAdditions) diffAdditions.textContent = `+${diff.additions}`;
        if (diffDeletions) diffDeletions.textContent = `-${diff.deletions}`;
        
        if (diff.isBinary) {
            if (diffEditor) {
                diffEditor.innerHTML = '<div class="binary-notice">📁 Binary file - cannot show changes</div>';
            }
            return;
        }
        
        if (diff.isNew) {
            // For new files, show the entire content as additions
            this.renderInlineNewFile(diff);
            return;
        }
        
        if (diff.isDeleted) {
            if (diffEditor) {
                diffEditor.innerHTML = '<div class="deleted-file-notice">🗑️ Deleted file</div>';
            }
            return;
        }
        
        // Render inline diff view
        this.renderInlineDiff(diff);
    }

    renderFinalFile(fileContent) {
        const diffContent = document.getElementById('diff-content');
        const diffEditor = document.getElementById('diff-editor');
        const diffAdditions = document.getElementById('diff-additions');
        const diffDeletions = document.getElementById('diff-deletions');
        
        if (diffContent) diffContent.style.display = 'block';
        
        // Hide stats for final file view
        if (diffAdditions) diffAdditions.textContent = '';
        if (diffDeletions) diffDeletions.textContent = '';
        
        if (!diffEditor) return;
        
        // Get file extension for syntax highlighting
        const fileName = this.currentDiffFile || '';
        const extension = fileName.split('.').pop() || '';
        const language = getLanguageFromExtension(extension);
        
        // Apply syntax highlighting to raw content (escaping handled within highlighting)
        const highlightedContent = applySyntaxHighlightingToText(fileContent, language);
        
        // Display with syntax highlighting
        diffEditor.innerHTML = `<pre><code class="language-${language}">${highlightedContent}</code></pre>`;
    }

    renderInlineDiff(diff) {
        const diffEditor = document.getElementById('diff-editor');
        if (!diffEditor) return;
        
        let html = '';
        
        for (const line of diff.lines) {
            if (line.type === 'header') {
                continue; // Skip file headers
            }
            
            if (line.type === 'hunk') {
                // Show hunk headers to separate diff sections
                html += `
                    <div class="diff-line hunk-header">
                        <div class="line-numbers">
                            <span class="old-line-num">...</span>
                            <span class="new-line-num">...</span>
                        </div>
                        <div class="line-change-indicator"></div>
                        <div class="line-content">${escapeHtml(line.content)}</div>
                    </div>
                `;
                continue;
            }
            
            const lineClass = this.getInlineLineClass(line.type);
            const lineSymbol = this.getLineSymbol(line.type);
            
            // Use the actual line numbers from the diff data
            const oldLineNum = line.oldLineNumber || (line.type === 'addition' ? '' : '');
            const newLineNum = line.newLineNumber || (line.type === 'deletion' ? '' : '');
            
            html += `
                <div class="diff-line ${lineClass}">
                    <div class="line-numbers">
                        <span class="old-line-num">${oldLineNum}</span>
                        <span class="new-line-num">${newLineNum}</span>
                    </div>
                    <div class="line-change-indicator">${lineSymbol}</div>
                    <div class="line-content">${escapeHtml(line.content)}</div>
                </div>
            `;
        }
        
        diffEditor.innerHTML = html;
    }
    
    renderInlineNewFile(diff) {
        const diffEditor = document.getElementById('diff-editor');
        if (!diffEditor) return;
        
        let html = '';
        let lineNumber = 1;
        
        for (const line of diff.lines) {
            if (line.type === 'header') continue;
            
            html += `
                <div class="diff-line addition">
                    <div class="line-numbers">
                        <span class="old-line-num"></span>
                        <span class="new-line-num">${lineNumber}</span>
                    </div>
                    <div class="line-change-indicator">+</div>
                    <div class="line-content">${escapeHtml(line.content)}</div>
                </div>
            `;
            lineNumber++;
        }
        
        diffEditor.innerHTML = html;
    }
    
    getInlineLineClass(lineType) {
        switch (lineType) {
        case 'addition': return 'addition';
        case 'deletion': return 'deletion';
        case 'context': return 'context';
        default: return '';
        }
    }
    
    getLineSymbol(lineType) {
        switch (lineType) {
        case 'addition': return '+';
        case 'deletion': return '-';
        case 'context': return ' ';
        default: return '';
        }
    }

    updateFileCounters(versionedCount, unversionedCount, totalCount) {
    // Update main counter
        const mainCounter = document.getElementById('git-file-counter');
        if (mainCounter) {
            mainCounter.textContent = `${totalCount} file${totalCount !== 1 ? 's' : ''}`;
            mainCounter.setAttribute('data-count', totalCount);
        }
        
        // Update section counters
        const versionedCounter = document.getElementById('versioned-counter');
        if (versionedCounter) {
            versionedCounter.textContent = versionedCount;
        }
        
        const unversionedCounter = document.getElementById('unversioned-counter');
        if (unversionedCounter) {
            unversionedCounter.textContent = unversionedCount;
        }
    }


    showLoading() {
        const loading = document.getElementById('git-loading');
        const versionedSection = document.getElementById('versioned-section');
        const unversionedSection = document.getElementById('unversioned-section');
        const clean = document.getElementById('git-clean');
        
        // Clear current content and show only loading
        if (versionedSection) {
            versionedSection.style.display = 'none';
            const versionedFiles = document.getElementById('versioned-files');
            if (versionedFiles) versionedFiles.innerHTML = '';
        }
        
        if (unversionedSection) {
            unversionedSection.style.display = 'none';
            const unversionedFiles = document.getElementById('unversioned-files');
            if (unversionedFiles) unversionedFiles.innerHTML = '';
        }
        
        if (clean) clean.style.display = 'none';
        if (loading) loading.style.display = 'flex';
    }

    hideLoading() {
        const loading = document.getElementById('git-loading');
        if (loading) loading.style.display = 'none';
    }

    showError(message) { // eslint-disable-line no-unused-vars
    // Simple error display - could be enhanced with toast notifications
    }
}