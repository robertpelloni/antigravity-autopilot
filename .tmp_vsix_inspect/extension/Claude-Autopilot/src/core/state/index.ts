import * as vscode from 'vscode';
import { ChildProcess } from 'child_process';
import { MessageItem, HistoryRun } from '../../core/types';

export let claudePanel: vscode.WebviewPanel | null = null;
export let isRunning = false;
export let messageQueue: MessageItem[] = [];
export let claudeProcess: ChildProcess | null = null;
export let resumeTimer: NodeJS.Timeout | null = null;
export let countdownInterval: NodeJS.Timeout | null = null;
export let sleepPreventionProcess: ChildProcess | null = null;
export let sleepPreventionActive = false;
export let healthCheckTimer: NodeJS.Timeout | null = null;

export let sessionReady = false;
export let currentMessage: MessageItem | null = null;
export let processingQueue = false;
export let debugMode = process.env.DEBUG_MODE === 'true';

export let currentRun: HistoryRun | null = null;
export let extensionContext: vscode.ExtensionContext;

export let claudeOutputBuffer: string = '';
export let claudeCurrentScreen: string = '';
export let claudeOutputTimer: NodeJS.Timeout | null = null;
export let claudeAutoClearTimer: NodeJS.Timeout | null = null;
export let lastClaudeOutputTime: number = 0;

export function setClaudePanel(panel: vscode.WebviewPanel | null) {
    claudePanel = panel;
}

export function setIsRunning(running: boolean) {
    isRunning = running;
    notifyMobileStatusUpdate();
}

export function setMessageQueue(queue: MessageItem[]) {
    messageQueue = queue;
    notifyMobileQueueUpdate();
}

export function setClaudeProcess(process: ChildProcess | null) {
    claudeProcess = process;
}

export function setSessionReady(ready: boolean) {
    sessionReady = ready;
    notifyMobileStatusUpdate();
}

export function setCurrentMessage(message: MessageItem | null) {
    currentMessage = message;
}

export function setProcessingQueue(processing: boolean) {
    processingQueue = processing;
    notifyMobileStatusUpdate();
}

export function setCurrentRun(run: HistoryRun | null) {
    currentRun = run;
}

export function setExtensionContext(context: vscode.ExtensionContext) {
    extensionContext = context;
}

export function setSleepPreventionProcess(process: ChildProcess | null) {
    sleepPreventionProcess = process;
}

export function setSleepPreventionActive(active: boolean) {
    sleepPreventionActive = active;
}

export function setHealthCheckTimer(timer: NodeJS.Timeout | null) {
    healthCheckTimer = timer;
}

export function setResumeTimer(timer: NodeJS.Timeout | null) {
    resumeTimer = timer;
}

export function setCountdownInterval(interval: NodeJS.Timeout | null) {
    countdownInterval = interval;
}

export function setClaudeOutputTimer(timer: NodeJS.Timeout | null) {
    claudeOutputTimer = timer;
}

export function setClaudeAutoClearTimer(timer: NodeJS.Timeout | null) {
    claudeAutoClearTimer = timer;
}

export function setClaudeOutputBuffer(buffer: string) {
    claudeOutputBuffer = buffer;
}

export function setClaudeCurrentScreen(screen: string) {
    claudeCurrentScreen = screen;
}

export function setLastClaudeOutputTime(time: number) {
    lastClaudeOutputTime = time;
}

export function setDebugMode(debug: boolean) {
    debugMode = debug;
}

// Helper function to notify mobile clients of status updates
function notifyMobileStatusUpdate(): void {
    try {
        // Import here to avoid circular dependency
        const { getMobileServer } = require('../services/mobile');
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyStatusUpdate();
        }
    } catch (error) {
        // Silently fail if mobile service isn't available
    }
}

// Helper function to notify mobile clients of queue updates
function notifyMobileQueueUpdate(): void {
    try {
        // Import here to avoid circular dependency
        const { getMobileServer } = require('../services/mobile');
        const mobileServer = getMobileServer();
        if (mobileServer.isRunning()) {
            mobileServer.notifyQueueUpdate();
        }
    } catch (error) {
        // Silently fail if mobile service isn't available
    }
}
