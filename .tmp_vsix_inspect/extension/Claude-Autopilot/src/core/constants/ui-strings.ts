/**
 * Centralized UI strings and status messages for the Claude Autopilot extension
 */

// Debug emoji patterns for consistent logging
export const DebugEmojis = {
    CLOCK: '🕐',
    TIMER: '⏰', 
    ERROR: '❌',
    SUCCESS: '✅',
    ROCKET: '🚀',
    SAVE: '💾',
    MOBILE: '📱',
    SEARCH: '🔍',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    STOP: '🛑',
    START: '▶️',
    PAUSE: '⏸️',
    REFRESH: '🔄',
    CHECK: '🔍',
    DOWNLOAD: '⬇️',
    UPLOAD: '⬆️',
    NETWORK: '🌐',
    KEY: '🔑',
    LOCK: '🔒',
    UNLOCK: '🔓'
} as const;

// Queue status messages
export const QueueMessages = {
    PROCESSING_STARTED: 'Queue processing started',
    PROCESSING_STOPPED: 'Queue processing stopped',
    MESSAGE_ADDED: 'Message added to queue',
    MESSAGE_REMOVED: 'Message removed from queue',
    MESSAGE_EDITED: 'Message edited',
    MESSAGE_DUPLICATED: 'Message duplicated',
    QUEUE_CLEARED: 'Queue cleared',
    QUEUE_EMPTY: 'Queue is empty',
    ALL_PROCESSED: 'All messages processed',
    PROCESSING_NEXT: 'Processing next message'
} as const;

// Session status messages  
export const SessionMessages = {
    STARTING: 'Starting Claude session',
    STARTED: 'Claude session started',
    STOPPING: 'Stopping Claude session',
    STOPPED: 'Claude session stopped',
    READY: 'Session ready',
    NOT_READY: 'Session not ready',
    RESETTING: 'Resetting session',
    RESET_COMPLETE: 'Session reset complete'
} as const;

// File operation messages
export const FileMessages = {
    READING: 'Reading file',
    WRITING: 'Writing file',
    SAVING: 'Saving file',
    LOADING: 'Loading file',
    FILE_NOT_FOUND: 'File not found',
    FILE_TOO_LARGE: 'File too large',
    INVALID_PATH: 'Invalid file path',
    ACCESS_DENIED: 'Access denied'
} as const;

// Git operation messages
export const GitMessages = {
    GETTING_STATUS: 'Getting git status',
    GETTING_DIFF: 'Getting file diff',
    STAGING_FILE: 'Staging file',
    UNSTAGING_FILE: 'Unstaging file',
    COMMITTING: 'Creating commit',
    PUSHING: 'Pushing changes',
    PULLING: 'Pulling changes',
    NOT_A_REPO: 'Not a git repository',
    NO_CHANGES: 'No changes to commit'
} as const;

// Mobile interface messages
export const MobileMessages = {
    CONNECTING: 'Connecting to server',
    CONNECTED: 'Connected to server',
    DISCONNECTED: 'Disconnected from server',
    RECONNECTING: 'Reconnecting',
    CONNECTION_FAILED: 'Connection failed',
    UNAUTHORIZED: 'Unauthorized access',
    PASSWORD_REQUIRED: 'Password required',
    LOGIN_SUCCESSFUL: 'Login successful',
    LOGIN_FAILED: 'Login failed'
} as const;

// Error messages
export const ErrorMessages = {
    UNKNOWN_ERROR: 'Unknown error occurred',
    NETWORK_ERROR: 'Network error',
    TIMEOUT_ERROR: 'Operation timed out',
    PERMISSION_ERROR: 'Permission denied',
    VALIDATION_ERROR: 'Validation failed',
    CONFIGURATION_ERROR: 'Configuration error',
    DEPENDENCY_ERROR: 'Dependency error'
} as const;

// Success messages
export const SuccessMessages = {
    OPERATION_COMPLETE: 'Operation completed successfully',
    SAVE_COMPLETE: 'Save completed',
    LOAD_COMPLETE: 'Load completed',
    SYNC_COMPLETE: 'Sync completed',
    BACKUP_COMPLETE: 'Backup completed',
    RESTORE_COMPLETE: 'Restore completed'
} as const;

// Utility functions for formatted messages
export function formatDebugMessage(emoji: string, message: string): string {
    return `${emoji} ${message}`;
}

export function formatTimestamp(message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    return `[${timestamp}] ${message}`;
}

export function formatProgress(current: number, total: number, message: string): string {
    const percentage = Math.round((current / total) * 100);
    return `${message} (${current}/${total} - ${percentage}%)`;
}

export function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}