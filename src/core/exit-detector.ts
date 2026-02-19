
import { createLogger } from '../utils/logger';

const log = createLogger('ExitDetector');

const NEGATION_PREFIXES = [
    /not\s+/i, /isn't\s+/i, /aren't\s+/i, /won't\s+/i, /far\s+from\s+/i
];

const FUTURE_PREFIXES = [
    /will\s+/i, /going\s+to\s+/i, /plan\s+to\s+/i, /next\s+/i, /once\s+/i, /when\s+/i
];

const HYPOTHETICAL_PREFIXES = [
    /if\s+/i, /assuming\s+/i, /should\s+/i, /maybe\s+/i, /probably\s+/i
];

const PARTIAL_INDICATORS = [
    /partially/i, /pending/i, /remaining/i, /todo/i, /\[\s*\]/ // [ ] checklist
];

const COMPLETION_PATTERNS = [
    /all\s+tasks?\s+(are\s+)?completed?/i,
    /goal\s+achieved/i,
    /implementation\s+(is\s+)?complete/i,
    /nothing\s+(left|remaining)\s+to\s+do/i,
    /no\s+more\s+tasks?/i,
    /done\s+with\s+all\s+tasks?/i,
    /everything\s+is\s+complete/i,
    /full\s+scope\s+implemented/i
];

const ACTIVE_WORK_PATTERNS = [
    /working\s+on/i,
    /implement(ing|ed)?/i,
    /fix(ing|ed)?/i,
    /next\s+task/i,
    /continu(e|ing)/i,
    /running\s+tests?/i,
    /pending/i,
];

const UNCERTAINTY_PATTERNS = [
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

        const sentences = text.split(/[.;!?\n]+/).map(s => s.trim()).filter(Boolean);

        // Analyze each sentence for completion signals, but filter out negated/future/hypothetical ones
        let validCompletionSignals = 0;
        let activeWorkSignals = 0;
        let uncertaintySignals = 0;
        let partialSignals = 0;

        for (const sentence of sentences) {
            const isNegated = NEGATION_PREFIXES.some(p => p.test(sentence));
            const isFuture = FUTURE_PREFIXES.some(p => p.test(sentence));
            const isHypothetical = HYPOTHETICAL_PREFIXES.some(p => p.test(sentence));
            const isPartial = PARTIAL_INDICATORS.some(p => p.test(sentence));

            if (isPartial) partialSignals++;

            // Check for completion
            const hasCompletionPattern = COMPLETION_PATTERNS.some(p => p.test(sentence));
            if (hasCompletionPattern) {
                if (!isNegated && !isFuture && !isHypothetical) {
                    validCompletionSignals++;
                }
            }

            // Check for active work
            const hasActiveWorkPattern = ACTIVE_WORK_PATTERNS.some(p => p.test(sentence));
            if (hasActiveWorkPattern) {
                activeWorkSignals++;
            }

            // Check for uncertainty
            const hasUncertaintyPattern = UNCERTAINTY_PATTERNS.some(p => p.test(sentence));
            if (hasUncertaintyPattern) {
                uncertaintySignals++;
            }
        }

        // Checklist logic: if there are unchecked boxes [ ], it's a strong signal of pending work
        const hasPendingChecklist = /\[\s*\]/.test(text);
        if (hasPendingChecklist) {
            partialSignals += 2; // Strong penalty
        }

        const positiveScore = validCompletionSignals * 0.8;
        const negativeScore = (activeWorkSignals * 0.3) + (uncertaintySignals * 0.2) + (partialSignals * 0.4);
        const confidence = Math.max(0, Math.min(1, positiveScore - negativeScore));

        // Stricter exit criteria
        const shouldExit = validCompletionSignals > 0
            && partialSignals === 0
            && activeWorkSignals === 0
            && confidence >= 0.7; // Increased threshold

        const reasons: string[] = [
            `validCompletion=${validCompletionSignals}`,
            `partial=${partialSignals}`,
            `activeWork=${activeWorkSignals}`,
            `uncertainty=${uncertaintySignals}`,
            `confidence=${confidence.toFixed(2)}`
        ];

        if (shouldExit) {
            // log.info(`Completion detected (${reasons.join(', ')})`); // Assuming log is imported/available
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
