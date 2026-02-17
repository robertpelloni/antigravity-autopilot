// Connection status constants
export const CONNECTION_STATUS = {
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
};

export const CONNECTION_STATUS_LABELS = {
    [CONNECTION_STATUS.CONNECTING]: 'Connecting...',
    [CONNECTION_STATUS.CONNECTED]: 'Connected',
    [CONNECTION_STATUS.DISCONNECTED]: 'Disconnected',
    [CONNECTION_STATUS.RECONNECTING]: 'Reconnecting...',
    [CONNECTION_STATUS.ERROR]: 'Connection Error'
};

// Queue message status constants
export const QUEUE_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error',
    WAITING: 'waiting'
};

export const QUEUE_STATUS_LABELS = {
    [QUEUE_STATUS.PENDING]: 'Pending',
    [QUEUE_STATUS.PROCESSING]: 'Processing',
    [QUEUE_STATUS.COMPLETED]: 'Completed',
    [QUEUE_STATUS.ERROR]: 'Error',
    [QUEUE_STATUS.WAITING]: 'Waiting'
};

export const QUEUE_STATUS_EMOJIS = {
    [QUEUE_STATUS.PENDING]: '⏳',
    [QUEUE_STATUS.PROCESSING]: '⚡',
    [QUEUE_STATUS.COMPLETED]: '✅',
    [QUEUE_STATUS.ERROR]: '❌',
    [QUEUE_STATUS.WAITING]: '⏱️'
};

// Toast notification types
export const TOAST_TYPE = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

// Git file status constants
export const GIT_STATUS = {
    MODIFIED: 'modified',
    ADDED: 'added',
    DELETED: 'deleted',
    RENAMED: 'renamed',
    COPIED: 'copied',
    UNTRACKED: 'untracked'
};

export const GIT_STATUS_ICONS = {
    [GIT_STATUS.MODIFIED]: '📝',
    [GIT_STATUS.ADDED]: '➕',
    [GIT_STATUS.DELETED]: '🗑️',
    [GIT_STATUS.RENAMED]: '↔️',
    [GIT_STATUS.COPIED]: '📋',
    [GIT_STATUS.UNTRACKED]: '❓'
};

// Diff view mode constants
export const DIFF_VIEW_MODE = {
    INLINE: 'inline',
    FINAL_FILE: 'final_file'
};

export const DIFF_VIEW_LABELS = {
    [DIFF_VIEW_MODE.INLINE]: 'Diff View',
    [DIFF_VIEW_MODE.FINAL_FILE]: 'File View'
};