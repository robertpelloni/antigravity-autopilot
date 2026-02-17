/**
 * Centralized VS Code notification service for consistent messaging throughout the extension
 */
import * as vscode from 'vscode';
import { getErrorMessage } from './error-handler';

export interface NotificationOptions {
    /** Whether to show modal dialog (default: false) */
    modal?: boolean;
    /** Custom buttons to show in notification */
    items?: string[];
}

export interface ErrorNotificationOptions extends NotificationOptions {
    /** Whether to include a "Show Details" button that opens the error in a new document */
    showDetails?: boolean;
}

/**
 * Shows an information notification
 */
export function showInfo(message: string, options?: NotificationOptions): Thenable<string | undefined> {
    if (options?.items) {
        return vscode.window.showInformationMessage(message, { modal: options.modal }, ...options.items);
    }
    return vscode.window.showInformationMessage(message, { modal: options?.modal });
}

/**
 * Shows a warning notification
 */
export function showWarning(message: string, options?: NotificationOptions): Thenable<string | undefined> {
    if (options?.items) {
        return vscode.window.showWarningMessage(message, { modal: options.modal }, ...options.items);
    }
    return vscode.window.showWarningMessage(message, { modal: options?.modal });
}

/**
 * Shows an error notification
 */
export function showError(message: string, options?: ErrorNotificationOptions): Thenable<string | undefined> {
    const items = options?.items ? [...options.items] : [];
    
    if (options?.showDetails) {
        items.push('Show Details');
    }
    
    const promise = items.length > 0
        ? vscode.window.showErrorMessage(message, { modal: options?.modal }, ...items)
        : vscode.window.showErrorMessage(message, { modal: options?.modal });
    
    if (options?.showDetails) {
        promise.then(selection => {
            if (selection === 'Show Details') {
                vscode.workspace.openTextDocument({
                    content: message,
                    language: 'text'
                }).then(doc => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    }
    
    return promise;
}

/**
 * Shows an error notification from an error object or unknown error
 */
export function showErrorFromException(error: unknown, context?: string, options?: ErrorNotificationOptions): Thenable<string | undefined> {
    const errorMessage = getErrorMessage(error);
    const fullMessage = context ? `${context}: ${errorMessage}` : errorMessage;
    return showError(fullMessage, options);
}

/**
 * Shows a progress notification
 */
export function showProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
): Thenable<T> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        },
        task
    );
}

/**
 * Shows an input box for user input
 */
export function showInput(options: {
    prompt: string;
    placeholder?: string;
    value?: string;
    password?: boolean;
    validateInput?: (value: string) => string | undefined;
}): Thenable<string | undefined> {
    return vscode.window.showInputBox({
        prompt: options.prompt,
        placeHolder: options.placeholder,
        value: options.value,
        password: options.password,
        validateInput: options.validateInput
    });
}

/**
 * Shows a quick pick for user selection
 */
export function showQuickPick<T extends vscode.QuickPickItem>(
    items: T[] | Thenable<T[]>,
    options?: vscode.QuickPickOptions
): Thenable<T | undefined> {
    return vscode.window.showQuickPick(items, options);
}

/**
 * Common notification messages used throughout the extension
 */
export const Messages = {
    // Session messages
    SESSION_ALREADY_RUNNING: 'Claude session is already running',
    SESSION_STARTED: 'Claude session started successfully',
    SESSION_STOPPED: 'Claude session stopped',
    
    // Queue messages
    MESSAGE_ADDED: 'Message added to Claude queue',
    ALL_MESSAGES_PROCESSED: 'All messages processed. Claude session remains active. Add messages to continue.',
    QUEUE_CLEARED: 'Message queue cleared',
    
    // Web interface messages
    WEB_INTERFACE_NOT_RUNNING: 'Web interface is not running. Please start it first.',
    WEB_INTERFACE_STARTED: (url: string) => `Web interface started! Scan the QR code or visit: ${url}`,
    WEB_INTERFACE_STOPPED: 'Web interface stopped',
    
    // Error messages
    FAILED_TO_START_PROCESSING: 'Failed to start processing',
    FAILED_TO_START_SESSION: 'Failed to start Claude session',
    FAILED_TO_START_WEB_INTERFACE: 'Failed to start web interface',
    FAILED_TO_STOP_WEB_INTERFACE: 'Failed to stop web interface',
    FAILED_TO_SHOW_QR: 'Failed to show QR code',
    FAILED_TO_OPEN_WEB_INTERFACE: 'Failed to open web interface',
    FAILED_TO_OPEN_SETTINGS: 'Failed to open settings',
    FAILED_AUTO_START_SESSION: 'Failed to auto-start Claude session'
} as const;