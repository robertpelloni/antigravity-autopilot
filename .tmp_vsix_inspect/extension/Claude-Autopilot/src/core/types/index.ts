export interface MessageItem {
    id: string;
    text: string;
    timestamp: string;
    status: 'pending' | 'processing' | 'completed' | 'error' | 'waiting';
    output?: string;
    error?: string;
    processingStartedAt?: string;
    completedAt?: string;
    waitUntil?: number;
    waitSeconds?: number;
}

export interface HistoryRun {
    id: string;
    startTime: string;
    endTime?: string;
    workspacePath: string;
    messages: MessageItem[];
    messageStatusMap: { [messageId: string]: 'pending' | 'processing' | 'completed' | 'error' | 'waiting' };
    totalMessages: number;
    completedMessages: number;
    errorMessages: number;
    waitingMessages: number;
}

