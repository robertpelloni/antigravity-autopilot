const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * Exit Detector Logic Tests
 * Tests the exit detection and consecutive failure tracking logic
 * without requiring VS Code dependencies.
 */

// Replicate the ExitDetector logic for testability
class ExitDetectorTestable {
    failureCount = 0;
    maxConsecutiveFailures = 5;

    checkResponse(response) {
        const lower = response.toLowerCase();
        if (lower.includes('all tasks completed') || lower.includes('goal achieved')) {
            return { shouldExit: true, reason: 'AI indicated completion' };
        }
        return { shouldExit: false };
    }

    reportSuccess() {
        this.failureCount = 0;
    }

    reportFailure() {
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

describe('ExitDetector Logic', () => {
    it('should detect completion phrases', () => {
        const det = new ExitDetectorTestable();
        assert.strictEqual(det.checkResponse('All tasks completed successfully').shouldExit, true);
        assert.strictEqual(det.checkResponse('The goal achieved!').shouldExit, true);
    });

    it('should not trigger on normal responses', () => {
        const det = new ExitDetectorTestable();
        assert.strictEqual(det.checkResponse('Working on task 3...').shouldExit, false);
        assert.strictEqual(det.checkResponse('Implemented the feature').shouldExit, false);
    });

    it('should track consecutive failures', () => {
        const det = new ExitDetectorTestable();
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(det.reportFailure().shouldExit, false);
        }
        // 5th failure should trigger exit
        assert.strictEqual(det.reportFailure().shouldExit, true);
    });

    it('should reset failure count on success', () => {
        const det = new ExitDetectorTestable();
        det.reportFailure();
        det.reportFailure();
        det.reportSuccess();
        assert.strictEqual(det.failureCount, 0);
        // Should need 5 more failures to trigger
        for (let i = 0; i < 4; i++) {
            assert.strictEqual(det.reportFailure().shouldExit, false);
        }
        assert.strictEqual(det.reportFailure().shouldExit, true);
    });

    it('should reset via reset()', () => {
        const det = new ExitDetectorTestable();
        det.reportFailure();
        det.reportFailure();
        det.reportFailure();
        det.reset();
        assert.strictEqual(det.failureCount, 0);
    });
});
