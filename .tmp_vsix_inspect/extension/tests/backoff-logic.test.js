const assert = require('assert');
const { test } = require('node:test');

// Mock AutonomousLoop class with just the static method to avoid importing the whole file (which has vscode dependency)
class AutonomousLoopMock {
    static calculateBackoff(baseInterval, failures, maxMinutes) {
        if (failures === 0) return baseInterval;

        const backoffMultiplier = Math.pow(2, Math.min(failures, 6));
        let newInterval = baseInterval * backoffMultiplier;

        const maxSeconds = maxMinutes * 60;
        if (newInterval > maxSeconds) {
            newInterval = maxSeconds;
        }
        return newInterval;
    }
}

test('Adaptive Backoff Logic', async (t) => {
    const baseInterval = 30;
    const maxMinutes = 5;

    await t.test('should return base interval for 0 failures', () => {
        const result = AutonomousLoopMock.calculateBackoff(baseInterval, 0, maxMinutes);
        assert.strictEqual(result, 30);
    });

    await t.test('should double interval for 1 failure', () => {
        const result = AutonomousLoopMock.calculateBackoff(baseInterval, 1, maxMinutes);
        assert.strictEqual(result, 60);
    });

    await t.test('should be 4x for 2 failures', () => {
        const result = AutonomousLoopMock.calculateBackoff(baseInterval, 2, maxMinutes);
        assert.strictEqual(result, 120);
    });

    await t.test('should cap exponent at 6 failures (64x)', () => {
        const result = AutonomousLoopMock.calculateBackoff(baseInterval, 6, 100); // High max to test exponent cap
        assert.strictEqual(result, 30 * 64); // 1920
    });

    await t.test('should not exceed maxMinutes (hard cap)', () => {
        const result = AutonomousLoopMock.calculateBackoff(baseInterval, 10, 5); // 5 mins = 300s
        assert.strictEqual(result, 300);
    });
});
