/**
 * Generate a unique ID for messages
 * Format: timestamp + random suffix for uniqueness
 */
export function generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `msg_${timestamp}_${random}`;
}

/**
 * Validate message ID format
 */
export function isValidMessageId(id: string): boolean {
    return typeof id === 'string' && id.startsWith('msg_') && id.length > 10;
}