// DOM utility functions and helpers

export function getCaretCoordinates(textarea, caretPosition) {
  // Create a mirror div to calculate caret position
  const div = document.createElement('div');
  const style = getComputedStyle(textarea);
    
  // Copy relevant styles
  ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing'].forEach(prop => {
    div.style[prop] = style[prop];
  });
    
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.width = textarea.offsetWidth + 'px';
  div.style.height = 'auto';
    
  document.body.appendChild(div);
    
  // Get text up to caret position
  const textBeforeCaret = textarea.value.substring(0, caretPosition);
  div.textContent = textBeforeCaret;
    
  // Add a span to measure the exact position
  const span = document.createElement('span');
  span.textContent = '|';
  div.appendChild(span);
    
  const textareaRect = textarea.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();
    
  const coordinates = {
    top: textareaRect.top + (spanRect.top - divRect.top) + textarea.scrollTop,
    left: textareaRect.left + (spanRect.left - divRect.left)
  };
    
  document.body.removeChild(div);
  return coordinates;
}

export function showError(message) {
  try {
    // Create error notification
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            font-size: 14px;
            z-index: 1000;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
    errorDiv.textContent = message;
        
    document.body.appendChild(errorDiv);
        
    // Remove after 3 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 3000);
  } catch (error) {
    console.error('Error showing error message:', error);
  }
}