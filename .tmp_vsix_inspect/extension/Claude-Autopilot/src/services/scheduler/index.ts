import * as vscode from 'vscode';
import { getValidatedConfig } from '../../core/config';
import { debugLog } from '../../utils/logging';

let scheduledTimer: NodeJS.Timeout | null = null;

export function startScheduledSession(callback: () => void): void {
    const config = getValidatedConfig();
    
    // Clear any existing timer
    stopScheduledSession();
    
    // Skip if no scheduled time or if autoStart is enabled
    if (!config.session.scheduledStartTime || config.session.autoStart) {
        return;
    }
    
    try {
        const scheduledTime = parseTime(config.session.scheduledStartTime);
        const now = new Date();
        const scheduledDate = new Date(now);
        
        scheduledDate.setHours(scheduledTime.hours, scheduledTime.minutes, 0, 0);
        
        // If the time has already passed today, schedule for tomorrow
        if (scheduledDate <= now) {
            scheduledDate.setDate(scheduledDate.getDate() + 1);
        }
        
        const msUntilStart = scheduledDate.getTime() - now.getTime();
        
        debugLog(`🕒 Scheduling Claude session start for ${config.session.scheduledStartTime} (${formatRelativeTime(msUntilStart)} from now)`);
        
        scheduledTimer = setTimeout(() => {
            debugLog('🚀 Executing scheduled Claude session start');
            vscode.window.showInformationMessage('🚀 Starting scheduled Claude session...');
            callback();
            
            // Schedule for the next day
            startScheduledSession(callback);
        }, msUntilStart);
        
        const timeString = scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        vscode.window.showInformationMessage(`Claude session scheduled to start at ${timeString}`);
        
    } catch (error) {
        debugLog(`❌ Failed to schedule session start: ${error}`);
        vscode.window.showErrorMessage(`Invalid scheduled start time format: ${config.session.scheduledStartTime}`);
    }
}

export function stopScheduledSession(): void {
    if (scheduledTimer) {
        clearTimeout(scheduledTimer);
        scheduledTimer = null;
        debugLog('⏹️ Cancelled scheduled session start');
    }
}

export function isScheduled(): boolean {
    return scheduledTimer !== null;
}

function parseTime(timeString: string): { hours: number; minutes: number } {
    const match = timeString.match(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/);
    
    if (!match) {
        throw new Error(`Invalid time format: ${timeString}`);
    }
    
    return {
        hours: parseInt(match[1], 10),
        minutes: parseInt(match[2], 10)
    };
}

function formatRelativeTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}