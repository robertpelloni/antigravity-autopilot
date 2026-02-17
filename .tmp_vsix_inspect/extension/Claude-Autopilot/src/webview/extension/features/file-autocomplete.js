// File reference autocomplete functionality (fixed version)
import { sanitizeHtml } from '../security/validation.js';
import { sendGetWorkspaceFiles } from '../communication/vscode-api.js';
import { getCaretCoordinates } from '../utils/dom-helpers.js';

// Local state for file autocomplete
const fileAutocompleteState = {
  isOpen: false,
  query: '',
  selectedIndex: 0,
  files: [],
  atPosition: -1,
  pagination: null,
  currentPage: 0,
  isLoading: false,
  pageScrollHandler: null
};

export function showFileAutocomplete(textarea, atPosition) {
  fileAutocompleteState.isOpen = true;
  fileAutocompleteState.atPosition = atPosition;
  fileAutocompleteState.selectedIndex = 0;
    
  // Create autocomplete container if it doesn't exist
  let autocompleteContainer = document.getElementById('fileAutocompleteContainer');
  if (!autocompleteContainer) {
    autocompleteContainer = document.createElement('div');
    autocompleteContainer.id = 'fileAutocompleteContainer';
    autocompleteContainer.className = 'file-autocomplete-container';
    document.body.appendChild(autocompleteContainer);
  }
    
  // Add scroll listener to close autocomplete when page scrolls
  if (fileAutocompleteState.pageScrollHandler) {
    window.removeEventListener('scroll', fileAutocompleteState.pageScrollHandler);
    document.removeEventListener('scroll', fileAutocompleteState.pageScrollHandler);
  }
    
  const pageScrollHandler = () => {
    hideFileAutocomplete();
  };
  fileAutocompleteState.pageScrollHandler = pageScrollHandler;
    
  // Add new scroll listeners
  window.addEventListener('scroll', pageScrollHandler, { passive: true });
  document.addEventListener('scroll', pageScrollHandler, { passive: true });
    
  // Get caret position for precise positioning
  const caretCoords = getCaretCoordinates(textarea, atPosition + 1);
    
  // Position the autocomplete menu near the caret
  autocompleteContainer.style.cssText = `
        position: fixed;
        top: ${caretCoords.top + 20}px;
        left: ${caretCoords.left}px;
        width: 280px;
        max-height: 150px;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        z-index: 10000;
        overflow-y: auto;
        display: block;
        font-size: 12px;
    `;
    
  // Show loading state
  autocompleteContainer.innerHTML = '<div class="file-autocomplete-loading">Loading files...</div>';
    
  // Request files from extension
  fileAutocompleteState.currentPage = 0;
  sendGetWorkspaceFiles('', 1);
}

export function hideFileAutocomplete() {
  fileAutocompleteState.isOpen = false;
  fileAutocompleteState.query = '';
  fileAutocompleteState.selectedIndex = 0;
  fileAutocompleteState.files = [];
  fileAutocompleteState.atPosition = -1;
  fileAutocompleteState.pagination = null;
  fileAutocompleteState.currentPage = 0;
  fileAutocompleteState.isLoading = false;
    
  const autocompleteContainer = document.getElementById('fileAutocompleteContainer');
  if (autocompleteContainer) {
    autocompleteContainer.style.display = 'none';
    // Remove scroll listener to prevent memory leaks
    autocompleteContainer.removeEventListener('scroll', handleInfiniteScroll);
  }
    
  // Remove page scroll listeners to prevent memory leaks
  if (fileAutocompleteState.pageScrollHandler) {
    window.removeEventListener('scroll', fileAutocompleteState.pageScrollHandler);
    document.removeEventListener('scroll', fileAutocompleteState.pageScrollHandler);
    fileAutocompleteState.pageScrollHandler = null;
  }
}

export function updateFileAutocomplete(query) {
  fileAutocompleteState.query = query;
  fileAutocompleteState.selectedIndex = 0;
  fileAutocompleteState.currentPage = 0;
    
  // Request filtered files from extension
  sendGetWorkspaceFiles(query, 1);
}

export function renderFileAutocomplete(files, pagination = null) {
  const autocompleteContainer = document.getElementById('fileAutocompleteContainer');
  if (!autocompleteContainer || !fileAutocompleteState.isOpen) {
    return;
  }
    
  // For first page or new query, replace content
  if (fileAutocompleteState.currentPage === 0) {
    fileAutocompleteState.files = files;
    fileAutocompleteState.pagination = pagination;
        
    if (files.length === 0) {
      autocompleteContainer.innerHTML = '<div class="file-autocomplete-empty">No files found</div>';
      return;
    }
        
    let html = '';
        
    // Add header with total count
    if (pagination && pagination.totalResults > 0) {
      html += `
                <div class="file-autocomplete-header">
                    <span class="file-count">${pagination.totalResults} files found</span>
                    ${pagination.hasNextPage ? '<span class="loading-more">Scroll for more...</span>' : ''}
                </div>
            `;
    }
        
    files.forEach((file, index) => {
      const isSelected = index === fileAutocompleteState.selectedIndex;
      html += `
                <div class="file-autocomplete-item ${isSelected ? 'selected' : ''}" data-index="${index}" id="file-item-${index}">
                    <div class="file-name">${sanitizeHtml(file.name)}</div>
                    <div class="file-path">${sanitizeHtml(file.path)}</div>
                </div>
            `;
    });
        
    // Add loading indicator if there are more pages
    if (pagination && pagination.hasNextPage) {
      html += '<div class="file-autocomplete-loading-more" id="loadingMore">Loading more files...</div>';
    }
        
    autocompleteContainer.innerHTML = html;
        
    // Setup infinite scroll
    setupInfiniteScroll();
  } else {
    // Append new files for infinite scroll
    // Preserve scroll position to prevent jumping
    const scrollTop = autocompleteContainer.scrollTop;
        
    fileAutocompleteState.files = fileAutocompleteState.files.concat(files);
    fileAutocompleteState.pagination = pagination;
        
    // Remove loading indicator
    const loadingMore = document.getElementById('loadingMore');
    if (loadingMore) {
      loadingMore.remove();
    }
        
    // Append new files
    files.forEach((file, index) => {
      const globalIndex = fileAutocompleteState.files.length - files.length + index;
      const fileItem = document.createElement('div');
      fileItem.className = 'file-autocomplete-item';
      fileItem.setAttribute('data-index', globalIndex);
      fileItem.id = `file-item-${globalIndex}`;
      fileItem.innerHTML = `
                <div class="file-name">${sanitizeHtml(file.name)}</div>
                <div class="file-path">${sanitizeHtml(file.path)}</div>
            `;
      fileItem.addEventListener('click', () => {
        selectFileReference(globalIndex);
      });
      autocompleteContainer.appendChild(fileItem);
    });
        
    // Add new loading indicator if there are more pages
    if (pagination && pagination.hasNextPage) {
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'file-autocomplete-loading-more';
      loadingDiv.id = 'loadingMore';
      loadingDiv.textContent = 'Loading more files...';
      autocompleteContainer.appendChild(loadingDiv);
    }
        
    // Maintain scroll position - keep user at same relative position
    requestAnimationFrame(() => {
      autocompleteContainer.scrollTop = scrollTop;
    });
  }
    
  // Only scroll selected item into view for first page to avoid jumping
  if (fileAutocompleteState.currentPage === 0) {
    scrollSelectedItemIntoView();
  }
    
  // Add click handlers for first page items
  if (fileAutocompleteState.currentPage === 0) {
    autocompleteContainer.querySelectorAll('.file-autocomplete-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        selectFileReference(index);
      });
    });
  }
}

function setupInfiniteScroll() {
  const autocompleteContainer = document.getElementById('fileAutocompleteContainer');
  if (!autocompleteContainer) return;
    
  // Remove existing scroll listener
  autocompleteContainer.removeEventListener('scroll', handleInfiniteScroll);
    
  // Add new scroll listener
  autocompleteContainer.addEventListener('scroll', handleInfiniteScroll);
}

function handleInfiniteScroll(event) {
  const container = event.target;
  const scrollTop = container.scrollTop;
  const scrollHeight = container.scrollHeight;
  const clientHeight = container.clientHeight;
    
  // Load more when scrolled to bottom 90% (less aggressive triggering)
  if (scrollTop + clientHeight >= scrollHeight * 0.9) {
    loadMoreFiles();
  }
}

function loadMoreFiles() {
  if (fileAutocompleteState.pagination && 
        fileAutocompleteState.pagination.hasNextPage && 
        !fileAutocompleteState.isLoading) {
        
    fileAutocompleteState.isLoading = true;
    fileAutocompleteState.currentPage++;
        
    sendGetWorkspaceFiles(
      fileAutocompleteState.query,
      fileAutocompleteState.currentPage + 1
    );
        
    // Reset loading flag after request
    setTimeout(() => {
      fileAutocompleteState.isLoading = false;
    }, 100);
  }
}

function scrollSelectedItemIntoView() {
  const autocompleteContainer = document.getElementById('fileAutocompleteContainer');
  const selectedItem = document.getElementById(`file-item-${fileAutocompleteState.selectedIndex}`);
    
  if (autocompleteContainer && selectedItem) {
    const containerRect = autocompleteContainer.getBoundingClientRect();
    const itemRect = selectedItem.getBoundingClientRect();
        
    // Check if item is above visible area
    if (itemRect.top < containerRect.top) {
      selectedItem.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // Check if item is below visible area
    else if (itemRect.bottom > containerRect.bottom) {
      selectedItem.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }
}

export function selectFileReference(index) {
  if (!fileAutocompleteState.isOpen || index >= fileAutocompleteState.files.length) {
    return;
  }
    
  const selectedFile = fileAutocompleteState.files[index];
  const textarea = document.getElementById('messageInput');
  const currentValue = textarea.value;
    
  // Find the @ position and replace with file reference
  const beforeAt = currentValue.substring(0, fileAutocompleteState.atPosition);
  const afterQuery = currentValue.substring(fileAutocompleteState.atPosition + 1 + fileAutocompleteState.query.length);
    
  const newValue = beforeAt + '@' + selectedFile.path + ' ' + afterQuery;
  textarea.value = newValue;
    
  // Position cursor after the inserted file reference
  const newCursorPosition = beforeAt.length + selectedFile.path.length + 2;
  textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    
  hideFileAutocomplete();
  textarea.focus();
}

export function handleAutocompleteNavigation(event) {
  if (!fileAutocompleteState.isOpen) {
    return false;
  }
    
  switch (event.key) {
  case 'ArrowDown':
    event.preventDefault();
    fileAutocompleteState.selectedIndex = Math.min(
      fileAutocompleteState.selectedIndex + 1,
      fileAutocompleteState.files.length - 1
    );
    renderFileAutocomplete(fileAutocompleteState.files);
    return true;
            
  case 'ArrowUp':
    event.preventDefault();
    fileAutocompleteState.selectedIndex = Math.max(
      fileAutocompleteState.selectedIndex - 1,
      0
    );
    renderFileAutocomplete(fileAutocompleteState.files);
    return true;
            
  case 'Enter':
  case 'Tab':
    event.preventDefault();
    selectFileReference(fileAutocompleteState.selectedIndex);
    return true;
            
  case 'Escape':
    event.preventDefault();
    hideFileAutocomplete();
    return true;
            
  default:
    return false;
  }
}

// Export the state for external access
export { fileAutocompleteState };