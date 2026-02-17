// Security utilities and input validation

// Security utilities
export function sanitizeHtml(unsafe) {
  if (typeof unsafe !== 'string') return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');
}

// Global reference to bypass setting - will be updated by main module
let allowDangerousXssbypass = false;

export function setAllowDangerousXssbypass(value) {
  allowDangerousXssbypass = value;
}

export function validateMessage(text) {
  if (typeof text !== 'string') return { valid: false, error: 'Message must be a string' };
  if (text.length === 0) return { valid: false, error: 'Message cannot be empty' };
  if (text.length > 50000) return { valid: false, error: 'Message too long (max 50,000 characters)' };
    
  // Skip XSS validation if bypass is enabled
  if (allowDangerousXssbypass) {
    return { valid: true };
  }
    
  const dangerousPatterns = [
    /<script[^>]*>/i,
    /javascript:/i,
    /data:text\/html/i,
    /vbscript:/i,
    /on\w+\s*=/i,
    /<iframe[^>]*>/i,
    /<object[^>]*>/i,
    /<embed[^>]*>/i
  ];
    
  for (const pattern of dangerousPatterns) {
    if (pattern.test(text)) {
      return { valid: false, error: 'Message contains potentially dangerous content. Enable XSS bypass in settings if needed.' };
    }
  }
    
  return { valid: true };
}

export function createSafeElement(tagName, textContent, className) {
  const element = document.createElement(tagName);
  element.textContent = textContent;
  if (className) {
    element.className = className.replace(/[^a-zA-Z0-9\-_\s]/g, '');
  }
  return element;
}