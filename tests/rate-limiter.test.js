const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * RateLimiter Logic Tests
 * Tests call counting, hour-based reset, remaining calls,
 * and rate limit detection — without VS Code dependencies.
 */

// ============ Replicate RateLimiter for testing ============

class TestRateLimiter {
    constructor(maxCallsPerHour = 100) {
        this.maxCalls = maxCallsPerHour;
        this.state = {
            callsThisHour: 0,
            hourStartTime: Date.now(),
            isLimited: false,
            waitingForReset: false,
        };
    }

    canMakeCall() {
        this.checkHourReset();
        return this.state.callsThisHour < this.maxCalls && !this.state.waitingForReset;
    }

    recordCall() {
        this.checkHourReset();
        this.state.callsThisHour++;
    }

    checkHourReset() {
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;
        if (now - this.state.hourStartTime >= hourMs) {
            this.state.callsThisHour = 0;
            this.state.hourStartTime = now;
            this.state.isLimited = false;
        }
    }

    getRemainingCalls() {
        this.checkHourReset();
        return Math.max(0, this.maxCalls - this.state.callsThisHour);
    }

    getTimeUntilReset() {
        const hourMs = 60 * 60 * 1000;
        const elapsed = Date.now() - this.state.hourStartTime;
        return Math.max(0, hourMs - elapsed);
    }

    reset() {
        this.state = {
            callsThisHour: 0,
            hourStartTime: Date.now(),
            isLimited: false,
            waitingForReset: false,
        };
    }
}

// ============ Tests ============

describe('RateLimiter', () => {
    it('should allow calls under the limit', () => {
        const rl = new TestRateLimiter(10);
        assert.strictEqual(rl.canMakeCall(), true);
        for (let i = 0; i < 5; i++) rl.recordCall();
        assert.strictEqual(rl.canMakeCall(), true);
    });

    it('should block calls at the limit', () => {
        const rl = new TestRateLimiter(3);
        rl.recordCall();
        rl.recordCall();
        rl.recordCall();
        assert.strictEqual(rl.canMakeCall(), false);
    });

    it('should track remaining calls', () => {
        const rl = new TestRateLimiter(10);
        assert.strictEqual(rl.getRemainingCalls(), 10);
        rl.recordCall();
        rl.recordCall();
        assert.strictEqual(rl.getRemainingCalls(), 8);
    });

    it('should reset after hour boundary', () => {
        const rl = new TestRateLimiter(10);
        rl.recordCall();
        rl.recordCall();
        // Simulate hour passing
        rl.state.hourStartTime = Date.now() - (61 * 60 * 1000);
        assert.strictEqual(rl.getRemainingCalls(), 10);
    });

    it('should calculate time until reset', () => {
        const rl = new TestRateLimiter(10);
        const remaining = rl.getTimeUntilReset();
        assert.ok(remaining > 0);
        assert.ok(remaining <= 60 * 60 * 1000);
    });

    it('should fully reset via reset()', () => {
        const rl = new TestRateLimiter(5);
        rl.recordCall();
        rl.recordCall();
        rl.recordCall();
        rl.reset();
        assert.strictEqual(rl.getRemainingCalls(), 5);
        assert.strictEqual(rl.canMakeCall(), true);
    });

    it('should not go negative on remaining calls', () => {
        const rl = new TestRateLimiter(2);
        rl.recordCall();
        rl.recordCall();
        rl.recordCall(); // over limit
        assert.strictEqual(rl.getRemainingCalls(), 0);
    });
});
