import { getLanguageFromExtension, applySyntaxHighlightingToText } from '../utils/syntax.js';

export class FileExplorer {
    constructor() {
        this.expandedFolders = new Set();
        this.fileTree = null;
        this.currentPath = '';
        this.isLoading = false;
        this.currentFilePath = null;
        
        // Cache for performance
        this.treeCache = new Map();
        this.contentCache = new Map();
        
        this.initializeEventListeners();
        
        // Load file tree immediately since section is always expanded
        this.loadFileTree();
    }

    initializeEventListeners() {
    // Explorer toggle
        const explorerToggle = document.getElementById('explorer-toggle');
        if (explorerToggle) {
            explorerToggle.addEventListener('click', () => this.toggleExplorer());
        }

        // Control buttons
        const refreshBtn = document.getElementById('refresh-files');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshFileTree());
        }

        const searchBtn = document.getElementById('search-files');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.openSearch());
        }

        // File preview modal
        const closePreview = document.getElementById('close-preview');
        if (closePreview) {
            closePreview.addEventListener('click', () => this.closePreview());
        }

        const copyPath = document.getElementById('copy-file-path');
        if (copyPath) {
            // Check if clipboard API is available
            if (navigator.clipboard && window.isSecureContext) {
                copyPath.addEventListener('click', () => this.copyCurrentFilePath());
            } else {
            // Hide button if clipboard is not available
                copyPath.style.display = 'none';
            }
        }

        // Search modal
        const closeSearch = document.getElementById('close-search');
        if (closeSearch) {
            closeSearch.addEventListener('click', () => this.closeSearch());
        }

        const performSearch = document.getElementById('perform-search');
        if (performSearch) {
            performSearch.addEventListener('click', () => this.performSearch());
        }

        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        // Modal backdrop clicks
        const previewModal = document.getElementById('file-preview-modal');
        if (previewModal) {
            previewModal.addEventListener('click', (e) => {
                if (e.target === previewModal) {
                    this.closePreview();
                }
            });
        }

        const searchModal = document.getElementById('file-search-modal');
        if (searchModal) {
            searchModal.addEventListener('click', (e) => {
                if (e.target === searchModal) {
                    this.closeSearch();
                }
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closePreview();
                this.closeSearch();
            }
        });
    }

    toggleExplorer() {
        const content = document.getElementById('explorer-content');
        const toggle = document.getElementById('explorer-toggle');
        const toggleIcon = toggle?.querySelector('.toggle-icon');
        
        if (!content || !toggle) return;
        
        const isExpanded = toggle.getAttribute('data-expanded') === 'true';
        
        if (isExpanded) {
            content.style.display = 'none';
            toggle.setAttribute('data-expanded', 'false');
            if (toggleIcon) toggleIcon.textContent = '▶';
        } else {
            content.style.display = 'block';
            toggle.setAttribute('data-expanded', 'true');
            if (toggleIcon) toggleIcon.textContent = '▼';
            
            // Load file tree if not already loaded
            if (!this.fileTree) {
                this.loadFileTree();
            }
        }
    }

    async loadFileTree(path = '') {
        if (this.isLoading) {
            return;
        }
        
        this.isLoading = true;
        this.showLoading(true);
        
        try {
            // Check cache first
            const cacheKey = path || 'root';
            if (this.treeCache.has(cacheKey)) {
                const cachedData = this.treeCache.get(cacheKey);
                this.renderFileTree(cachedData.items);
                this.updateFileCounter(cachedData.total);
                this.showLoading(false);
                this.isLoading = false;
                return;
            }

            const url = `/api/files/tree?path=${encodeURIComponent(path)}&maxDepth=3`;

            const response = await fetch(url, {
                headers: { 
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to load file tree: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            
            // Cache the result
            this.treeCache.set(cacheKey, data);
            
            this.fileTree = data.items;
            this.currentPath = path;
            this.renderFileTree(data.items);
            this.updateFileCounter(data.total);
            
        } catch (error) {
            this.showError('Failed to load file tree: ' + error.message);
        } finally {
            this.showLoading(false);
            this.isLoading = false;
        }
    }

    renderFileTree(items, container = null, level = 0) {
        if (!container) {
            container = document.getElementById('file-tree');
            if (!container) {
                return;
            }
            container.innerHTML = '';
        }

        if (!items || items.length === 0) {
            this.showEmptyState();
            return;
        }

        this.hideEmptyState();

        items.forEach((item) => {
            const fileItem = this.createFileItem(item, level);
            container.appendChild(fileItem);

            if (item.type === 'directory' && item.children && this.expandedFolders.has(item.path)) {
                this.renderFileTree(item.children, container, level + 1);
            }
        });
    }

    createFileItem(item, level) {
        const div = document.createElement('div');
        div.className = `file-item ${item.type}`;
        div.setAttribute('data-path', item.path);
        div.setAttribute('data-type', item.type);

        const indent = document.createElement('div');
        indent.className = 'file-indent';
        indent.style.width = `${level * 20}px`;

        const expand = document.createElement('div');
        expand.className = 'file-expand';
        if (item.type === 'directory') {
            expand.textContent = this.expandedFolders.has(item.path) ? '▼' : '▶';
            expand.classList.toggle('expanded', this.expandedFolders.has(item.path));
        }

        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = this.getFileIcon(item);

        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = item.name;

        const meta = document.createElement('div');
        meta.className = 'file-meta';
        if (item.type === 'file' && item.size !== undefined) {
            meta.textContent = this.formatFileSize(item.size);
        }

        div.appendChild(indent);
        if (item.type === 'directory') {
            div.appendChild(expand);
        }
        div.appendChild(icon);
        div.appendChild(name);
        div.appendChild(meta);

        // Event handlers
        if (item.type === 'directory') {
            expand.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.toggleFolder(item.path);
            });
            
            div.addEventListener('click', async () => {
                await this.toggleFolder(item.path);
            });
        } else {
            div.addEventListener('click', () => {
                this.previewFile(item.path);
            });
        }

        return div;
    }

    async toggleFolder(folderPath) {
        const folderElement = document.querySelector(`[data-path="${folderPath}"]`);
        if (!folderElement) return;
        
        const expandIcon = folderElement.querySelector('.file-expand');
        const folderIcon = folderElement.querySelector('.file-icon');
        
        if (this.expandedFolders.has(folderPath)) {
            // Collapsing folder - remove children from DOM
            this.expandedFolders.delete(folderPath);
            this.removeChildrenFromDOM(folderPath);
            
            // Update icons
            if (expandIcon) expandIcon.textContent = '▶';
            if (folderIcon) folderIcon.textContent = '📁';
            
        } else {
            // Expanding folder
            this.expandedFolders.add(folderPath);
            
            // Update icons immediately
            if (expandIcon) {
                expandIcon.textContent = '▼';
                expandIcon.classList.add('expanded');
            }
            if (folderIcon) folderIcon.textContent = '📂';
            
            // Check if we need to load folder contents
            const folderItem = this.findItemByPath(this.fileTree, folderPath);
            if (folderItem && folderItem.type === 'directory') {
                // Check if folder needs loading
                const needsLoading = !folderItem.children || 
                                   folderItem.children.length === 0 || 
                                   (folderItem.children.length === 0 && !folderItem.hasBeenLoaded);
                
                if (needsLoading) {
                    // Add inline loading indicator
                    this.addInlineLoading(folderPath);
                    
                    // Load folder contents dynamically
                    await this.loadFolderContents(folderPath, folderItem);
                    
                    // Mark as loaded to prevent unnecessary reloads
                    folderItem.hasBeenLoaded = true;
                    
                    // Remove loading and add actual children
                    this.removeInlineLoading(folderPath);
                    if (folderItem.children && folderItem.children.length > 0) {
                        this.addChildrenToDOM(folderPath, folderItem.children);
                    }
                } else if (folderItem.children && folderItem.children.length > 0) {
                    // Add existing children to DOM
                    this.addChildrenToDOM(folderPath, folderItem.children);
                }
            }
        }
    }
    
    findItemByPath(items, targetPath) {
        if (!items) return null;
        
        for (const item of items) {
            if (item.path === targetPath) {
                return item;
            }
            if (item.children) {
                const found = this.findItemByPath(item.children, targetPath);
                if (found) return found;
            }
        }
        return null;
    }
    
    async loadFolderContents(folderPath, folderItem) {
        try {
            // Remove leading slash if present for API call
            const apiPath = folderPath.startsWith('/') ? folderPath.substring(1) : folderPath;
            
            const url = `/api/files/tree?path=${encodeURIComponent(apiPath)}&maxDepth=2`;
            
            const response = await fetch(url, {
                headers: { 
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                }
            });

            if (!response.ok) {
                return;
            }

            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                // Update the folder item with the loaded children
                folderItem.children = data.items;
            } else {
                // Ensure children array exists even if empty
                folderItem.children = [];
            }
            
        } catch (error) { // eslint-disable-line no-unused-vars
            // Ensure children array exists even on error
            folderItem.children = [];
        }
    }
    
    addInlineLoading(folderPath) {
        const folderElement = document.querySelector(`[data-path="${folderPath}"]`);
        if (!folderElement) return;
        
        // Find the folder's level for proper indentation
        const folderLevel = this.getFolderLevel(folderPath);
        
        // Create loading indicator element
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'file-item loading-indicator';
        loadingDiv.setAttribute('data-loading-for', folderPath);
        
        // Add proper indentation
        const indent = document.createElement('div');
        indent.className = 'file-indent';
        indent.style.width = `${(folderLevel + 1) * 20}px`;
        
        // No expand button for loading indicator
        const expandSpace = document.createElement('div');
        expandSpace.className = 'file-expand';
        expandSpace.style.width = '16px';
        
        // Loading icon
        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = '⏳';
        icon.style.opacity = '0.7';
        
        // Loading text
        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = 'Loading...';
        name.style.fontStyle = 'italic';
        name.style.opacity = '0.7';
        
        loadingDiv.appendChild(indent);
        loadingDiv.appendChild(expandSpace);
        loadingDiv.appendChild(icon);
        loadingDiv.appendChild(name);
        
        // Insert after the folder element
        folderElement.parentNode.insertBefore(loadingDiv, folderElement.nextSibling);
    }
    
    removeInlineLoading(folderPath) {
        const loadingElement = document.querySelector(`[data-loading-for="${folderPath}"]`);
        if (loadingElement) {
            loadingElement.remove();
        }
    }
    
    getFolderLevel(folderPath) {
    // Count the number of slashes to determine nesting level
        const cleanPath = folderPath.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
        if (!cleanPath) return 0;
        return cleanPath.split('/').length - 1;
    }
    
    removeChildrenFromDOM(folderPath) {
    // Remove all elements that are children of this folder
        const allItems = document.querySelectorAll('.file-item');
        const folderLevel = this.getFolderLevel(folderPath);
        
        let found = false;
        for (const item of allItems) {
            const itemPath = item.getAttribute('data-path');
            
            // Skip until we find the folder
            if (itemPath === folderPath) {
                found = true;
                continue;
            }
            
            if (!found) continue;
            
            // If we find an item at the same level or higher, we're done
            if (itemPath && this.getFolderLevel(itemPath) <= folderLevel) {
                break;
            }
            
            // This is a child - remove it
            item.remove();
        }
        
        // Also remove any loading indicators
        this.removeInlineLoading(folderPath);
    }
    
    addChildrenToDOM(folderPath, children) {
        const folderElement = document.querySelector(`[data-path="${folderPath}"]`);
        if (!folderElement) return;
        
        const folderLevel = this.getFolderLevel(folderPath);
        let insertAfter = folderElement;
        
        // Create and insert child elements
        children.forEach((child) => {
            const childElement = this.createFileItem(child, folderLevel + 1);
            
            // Insert after the previous element
            insertAfter.parentNode.insertBefore(childElement, insertAfter.nextSibling);
            insertAfter = childElement;
            
            // If this child is expanded, add its children too
            if (child.type === 'directory' && child.children && this.expandedFolders.has(child.path)) {
                const nestedChildren = this.getAllNestedChildren(child);
                nestedChildren.forEach((nestedChild) => {
                    const nestedLevel = this.getFolderLevel(nestedChild.path);
                    const nestedElement = this.createFileItem(nestedChild, nestedLevel);
                    insertAfter.parentNode.insertBefore(nestedElement, insertAfter.nextSibling);
                    insertAfter = nestedElement;
                });
            }
        });
    }
    
    getAllNestedChildren(item, result = []) {
        if (item.children) {
            item.children.forEach(child => {
                result.push(child);
                if (child.type === 'directory' && child.children && this.expandedFolders.has(child.path)) {
                    this.getAllNestedChildren(child, result);
                }
            });
        }
        return result;
    }

    getFileIcon(item) {
        if (item.type === 'directory') {
            return this.expandedFolders.has(item.path) ? '📂' : '📁';
        }
        
        const icons = {
            '.js': '🟨', '.jsx': '🟨', '.ts': '🔷', '.tsx': '🔷',
            '.json': '📄', '.md': '📝', '.css': '🎨', '.scss': '🎨',
            '.html': '🌐', '.htm': '🌐', '.py': '🐍', '.java': '☕',
            '.cpp': '⚙️', '.c': '⚙️', '.h': '⚙️', '.hpp': '⚙️',
            '.sh': '📜', '.bash': '📜', '.zsh': '📜',
            '.yml': '⚙️', '.yaml': '⚙️', '.xml': '📄',
            '.svg': '🖼️', '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️',
            '.gif': '🖼️', '.pdf': '📕', '.txt': '📄', '.log': '📄',
            '.env': '⚙️', '.gitignore': '📄', '.dockerfile': '🐳'
        };
        
        return icons[item.extension] || '📄';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async previewFile(filePath) {
        if (!filePath) return;
        
        this.currentFilePath = filePath;
        this.showPreviewModal();
        this.showPreviewLoading(true);
        
        try {
            // Check cache first
            if (this.contentCache.has(filePath)) {
                const cachedContent = this.contentCache.get(filePath);
                this.displayFileContent(cachedContent);
                this.showPreviewLoading(false);
                return;
            }

            const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`, {
                headers: { 
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                }
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            // Cache the content
            this.contentCache.set(filePath, data);
            
            this.displayFileContent(data);
            
        } catch (error) {
            this.showPreviewError(error.message);
        } finally {
            this.showPreviewLoading(false);
        }
    }

    displayFileContent(data) {
        const nameElement = document.getElementById('preview-file-name');
        const sizeElement = document.getElementById('preview-file-size');
        const linesElement = document.getElementById('preview-file-lines');
        const modifiedElement = document.getElementById('preview-file-modified');
        const codeElement = document.getElementById('preview-code-content');

        if (nameElement) {
            const fileName = this.currentFilePath.split('/').pop();
            nameElement.textContent = fileName || 'Unknown File';
        }

        if (sizeElement) {
            sizeElement.textContent = this.formatFileSize(data.size);
        }

        if (linesElement) {
            linesElement.textContent = `${data.lines} lines`;
        }

        if (modifiedElement) {
            const date = new Date(data.modified).toLocaleDateString();
            modifiedElement.textContent = `Modified: ${date}`;
        }

        if (codeElement) {
            // Get the file extension for proper language detection
            const extension = this.currentFilePath.split('.').pop() || '';
            const language = getLanguageFromExtension(extension);
            
            // Set class
            codeElement.className = `language-${language}`;
            
            // Apply syntax highlighting using the working method from diff viewer
            const highlightedContent = applySyntaxHighlightingToText(data.content, language);
            codeElement.innerHTML = highlightedContent;
        }

        this.hidePreviewError();
    }

    // Modal and UI management methods
    showPreviewModal() {
        const modal = document.getElementById('file-preview-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    closePreview() {
        const modal = document.getElementById('file-preview-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    showPreviewLoading(show) {
        const loading = document.getElementById('preview-loading');
        const content = document.getElementById('preview-content');
        if (loading && content) {
            loading.style.display = show ? 'flex' : 'none';
            content.style.display = show ? 'none' : 'block';
        }
    }

    showPreviewError(message) {
        const error = document.getElementById('preview-error');
        const content = document.getElementById('preview-content');
        if (error && content) {
            error.style.display = 'flex';
            error.querySelector('.error-text').textContent = message;
            content.style.display = 'none';
        }
    }

    hidePreviewError() {
        const error = document.getElementById('preview-error');
        if (error) {
            error.style.display = 'none';
        }
    }

    copyCurrentFilePath() {
        if (!this.currentFilePath) {
            this.showToast('No file path to copy');
            return;
        }

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(this.currentFilePath).then(() => {
                this.showToast('File path copied to clipboard');
            }).catch((error) => { // eslint-disable-line no-unused-vars
                this.showToast('Failed to copy file path');
            });
        } else {
            this.showToast('Clipboard not available in this context');
        }
    }

    // Search functionality
    openSearch() {
        const modal = document.getElementById('file-search-modal');
        const input = document.getElementById('search-input');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }
    }

    closeSearch() {
        const modal = document.getElementById('file-search-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }

    async performSearch() {
        const input = document.getElementById('search-input');
        
        if (!input) return;
        
        const query = input.value.trim();
        if (!query) return;
        
        
        this.showSearchLoading(true);
        
        try {
            const response = await fetch(`/api/files/search?query=${encodeURIComponent(query)}&pageSize=100`, {
                headers: {
                    'Authorization': `Bearer ${window.CLAUDE_AUTH_TOKEN}`,
                }
            });
            
            if (!response.ok) {
                throw new Error('Search request failed');
            }
            
            const result = await response.json();
            this.showSearchResults(result.files);
            
        } catch (error) { // eslint-disable-line no-unused-vars
            this.showToast('Search failed. Please try again.');
        } finally {
            this.showSearchLoading(false);
        }
    }

    showSearchLoading(show) {
        const loading = document.getElementById('search-loading');
        const results = document.getElementById('search-results');
        if (loading && results) {
            loading.style.display = show ? 'flex' : 'none';
            results.style.display = show ? 'none' : 'block';
        }
    }

    showSearchResults(results) {
        const container = document.getElementById('search-results');
        const empty = document.getElementById('search-empty');
        
        if (!container) return;
        
        if (results.length === 0) {
            container.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            return;
        }
        
        if (empty) empty.style.display = 'none';
        container.style.display = 'block';
        container.innerHTML = '';
        
        results.forEach(result => {
            const item = this.createSearchResultItem(result);
            container.appendChild(item);
        });
    }

    createSearchResultItem(file) {
        const item = document.createElement('div');
        item.className = 'file-item search-result';
        item.setAttribute('data-path', file.path);
        item.setAttribute('data-type', 'file');
        
        // No indent for search results
        const indent = document.createElement('div');
        indent.className = 'file-indent';
        indent.style.width = '0px';
        
        const icon = document.createElement('div');
        icon.className = 'file-icon';
        icon.textContent = this.getFileIcon({ name: file.name, type: 'file', path: file.path });
        
        const name = document.createElement('div');
        name.className = 'file-name';
        name.textContent = file.name;
        
        const meta = document.createElement('div');
        meta.className = 'file-meta';
        meta.textContent = file.path;
        
        item.appendChild(indent);
        item.appendChild(icon);
        item.appendChild(name);
        item.appendChild(meta);
        
        item.addEventListener('click', () => {
            this.closeSearch();
            this.previewFile(file.path);
        });
        
        return item;
    }

    // Utility methods
    refreshFileTree() {
        this.treeCache.clear();
        this.contentCache.clear();
        this.loadFileTree(this.currentPath);
    }

    showLoading(show) {
        const loading = document.getElementById('file-tree-loading');
        const tree = document.getElementById('file-tree');
        const empty = document.getElementById('file-tree-empty');
        
        if (loading && tree) {
            if (show) {
                // Clear current content and show only loading
                tree.innerHTML = '';
                tree.style.display = 'none';
                if (empty) empty.style.display = 'none';
                loading.style.display = 'flex';
            } else {
                loading.style.display = 'none';
                tree.style.display = 'block';
            }
        }
    }

    showEmptyState() {
        const empty = document.getElementById('file-tree-empty');
        const tree = document.getElementById('file-tree');
        if (empty && tree) {
            empty.style.display = 'flex';
            tree.style.display = 'none';
        }
    }

    hideEmptyState() {
        const empty = document.getElementById('file-tree-empty');
        const tree = document.getElementById('file-tree');
        if (empty && tree) {
            empty.style.display = 'none';
            tree.style.display = 'block';
        }
    }

    showError(message) {
        this.showToast(message);
    }

    updateFileCounter(count) {
        const counter = document.getElementById('file-counter');
        if (counter) {
            counter.textContent = `${count} files`;
            counter.setAttribute('data-count', count);
        }
    }


    showToast(message) {
    // Use existing toast system if available
        if (window.showToast) {
            window.showToast(message);
        }
    }
}