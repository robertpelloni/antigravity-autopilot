
import { createLogger } from '../utils/logger';

const log = createLogger('ExitDetector');

const COMPLETION_PATTERNS: RegExp[] = [
    /all\s+tasks?\s+(are\s+)?completed?/i,
    /goal\s+achieved/i,
    /implementation\s+(is\s+)?complete/i,
    /nothing\s+(left|remaining)\s+to\s+do/i,
    /no\s+more\s+tasks?/i,
    /done\s+with\s+all\s+tasks?/i,
    /everything\s+is\s+complete/i,
];

const ACTIVE_WORK_PATTERNS: RegExp[] = [
    /working\s+on/i,
    /implement(ing|ed)?/i,
    /fix(ing|ed)?/i,
    /next\s+task/i,
    /continu(e|ing)/i,
    /running\s+tests?/i,
    /pending/i,
];

const UNCERTAINTY_PATTERNS: RegExp[] = [
    /might\s+be\s+done/i,
    /likely\s+complete/i,
    /seems\s+complete/i,
    /probably/i,
    /maybe/i,
];

export interface ExitResult {
    shouldExit: boolean;
    reason?: string;
    confidence?: number;
    reasons?: string[];
}

export class ExitDetector {
    private failureCount = 0;
    private maxConsecutiveFailures = 5;

    checkResponse(response: string): ExitResult {
        const text = String(response || '');
        if (!text.trim()) {
            return { shouldExit: false, confidence: 0, reasons: ['empty response'] };
        }

        const completionMatches = COMPLETION_PATTERNS.filter((pattern) => pattern.test(text));
        const activeWorkMatches = ACTIVE_WORK_PATTERNS.filter((pattern) => pattern.test(text));
        const uncertaintyMatches = UNCERTAINTY_PATTERNS.filter((pattern) => pattern.test(text));

        const positiveScore = completionMatches.length * 0.55;
        const negativeScore = (activeWorkMatches.length * 0.4) + (uncertaintyMatches.length * 0.25);
        const confidence = Math.max(0, Math.min(1, positiveScore - negativeScore));

        const shouldExit = completionMatches.length > 0
            && activeWorkMatches.length === 0
            && confidence >= 0.5;

        const reasons: string[] = [
            `completionSignals=${completionMatches.length}`,
            `activeWorkSignals=${activeWorkMatches.length}`,
            `uncertaintySignals=${uncertaintyMatches.length}`,
            `confidence=${confidence.toFixed(2)}`
        ];

        if (shouldExit) {
            log.info(`Completion detected (${reasons.join(', ')})`);
            return {
                shouldExit: true,
                reason: 'AI indicated completion',
                confidence,
                reasons
            };
        }

        return {
            shouldExit: false,
            confidence,
            reasons
        };
    }

    reportSuccess() {
        this.failureCount = 0;
    }

    reportFailure(): ExitResult {
        this.failureCount++;
        if (this.failureCount >= this.maxConsecutiveFailures) {
            return { shouldExit: true, reason: `Too many consecutive failures (${this.failureCount})` };
        }
        return { shouldExit: false };
    }

    reset() {
        this.failureCount = 0;
    }
}

export const exitDetector = new ExitDetector();
