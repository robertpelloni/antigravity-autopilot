// HTML utility functions
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function sanitizeHtml(text) {
    return escapeHtml(text);
}