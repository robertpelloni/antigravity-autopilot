/**
 * Centralized timeout and interval constants for the Claude Autopilot extension
 */

// Git operation timeouts
export const GIT_TIMEOUT = 30000; // 30 seconds

// Mobile server timeouts
export const AUTH_BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes
export const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
export const MOBILE_UPDATE_INTERVAL = 1000; // 1 second

// Usage limit timeouts
export const USAGE_CHECK_INTERVAL = 1000; // 1 second
export const USAGE_RETRY_DELAY = 2000; // 2 seconds
export const USAGE_COUNTDOWN_INTERVAL = 1000; // 1 second
export const USAGE_WAIT_BUFFER = 10 * 1000; // 10 seconds

// Health check intervals
export const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds (from package.json config)

// Sleep prevention timeout
export const SLEEP_PREVENTION_DURATION = 7200; // 2 hours (in seconds)

// File processing limits
export const MAX_FILE_SIZE = 1024 * 1024; // 1MB for file content display
export const MAX_FILE_SIZE_DIFF = 10 * 1024 * 1024; // 10MB for git diffs
export const MAX_FILE_LINES = 1000; // Maximum lines to display
export const MAX_FILE_SIZE_MOBILE = 100 * 1024; // 100KB for mobile interface

// WebSocket timeouts
export const WEBSOCKET_RECONNECT_DELAY = 1000; // 1 second
export const WEBSOCKET_PING_INTERVAL = 30000; // 30 seconds

// UI update intervals
export const UI_UPDATE_INTERVAL = 1000; // 1 second
export const TERMINAL_UPDATE_INTERVAL = 100; // 100ms for terminal updates
export const STATUS_UPDATE_INTERVAL = 500; // 500ms for status updates

// Notification timeouts
export const NOTIFICATION_DISMISS_DELAY = 3000; // 3 seconds
export const ERROR_NOTIFICATION_DELAY = 5000; // 5 seconds

// Queue maintenance intervals
export const QUEUE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
export const QUEUE_MAINTENANCE_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Retry and backoff timeouts
export const RETRY_DELAY_SHORT = 1000; // 1 second
export const RETRY_DELAY_MEDIUM = 5000; // 5 seconds
export const RETRY_DELAY_LONG = 10000; // 10 seconds

// Debug and monitoring intervals
export const DEBUG_OUTPUT_INTERVAL = 100; // 100ms
export const MEMORY_CHECK_INTERVAL = 60000; // 1 minute

// Time conversion utilities
export const SECONDS_TO_MS = 1000;
export const MINUTES_TO_MS = 60 * 1000;
export const HOURS_TO_MS = 60 * 60 * 1000;
export const DAYS_TO_MS = 24 * 60 * 60 * 1000;

/**
 * Convert seconds to milliseconds
 */
export function secondsToMs(seconds: number): number {
    return seconds * SECONDS_TO_MS;
}

/**
 * Convert minutes to milliseconds
 */
export function minutesToMs(minutes: number): number {
    return minutes * MINUTES_TO_MS;
}

/**
 * Convert hours to milliseconds
 */
export function hoursToMs(hours: number): number {
    return hours * HOURS_TO_MS;
}

/**
 * Convert days to milliseconds
 */
export function daysToMs(days: number): number {
    return days * DAYS_TO_MS;
}