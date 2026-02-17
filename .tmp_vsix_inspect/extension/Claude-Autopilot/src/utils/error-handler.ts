/**
 * Standardized error handling utilities for the Claude Autopilot extension
 */

export interface ErrorContext {
    operation: string;
    details?: Record<string, any>;
}

/**
 * Safely extracts a string message from any error type
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
        return String(error.message);
    }
    return String(error);
}

/**
 * Creates a formatted error message with context
 */
export function formatErrorMessage(error: unknown, context?: ErrorContext): string {
    const baseMessage = getErrorMessage(error);
    
    if (!context) {
        return baseMessage;
    }
    
    let message = `${context.operation}: ${baseMessage}`;
    
    if (context.details) {
        const detailsString = Object.entries(context.details)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(', ');
        message += ` (${detailsString})`;
    }
    
    return message;
}

/**
 * Logs an error with context and returns the formatted message
 */
export function logAndFormatError(error: unknown, context?: ErrorContext): string {
    const message = formatErrorMessage(error, context);
    console.error(message);
    return message;
}

/**
 * Standard error result structure for operations
 */
export interface ErrorResult {
    success: false;
    error: string;
}

/**
 * Creates a standardized error result
 */
export function createErrorResult(error: unknown, context?: ErrorContext): ErrorResult {
    return {
        success: false,
        error: formatErrorMessage(error, context)
    };
}