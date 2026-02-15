const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * CircuitBreaker Logic Tests
 * Tests state transitions (CLOSED → OPEN → HALF_OPEN → CLOSED),
 * failure counting, threshold tripping, and recovery.
 */

// ============ Replicate CircuitBreaker for testing ============

const CircuitState = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 };

class TestCircuitBreaker {
    constructor(threshold = 5, resetTimeout = 30000) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.failureThreshold = threshold;
        this.resetTimeout = resetTimeout;
    }

    async execute(action) {
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.state = CircuitState.HALF_OPEN;
            } else {
                return null; // Blocked
            }
        }

        try {
            const result = await action();
            if (this.state === CircuitState.HALF_OPEN) {
                this.reset();
            }
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.trip();
        }
    }

    trip() {
        this.state = CircuitState.OPEN;
    }

    reset() {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
    }

    getState() { return this.state; }
}

// ============ Tests ============

describe('CircuitBreaker', () => {
    it('should start in CLOSED state', () => {
        const cb = new TestCircuitBreaker();
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    });

    it('should execute actions when CLOSED', async () => {
        const cb = new TestCircuitBreaker();
        const result = await cb.execute(() => Promise.resolve('hello'));
        assert.strictEqual(result, 'hello');
    });

    it('should count failures and trip at threshold', async () => {
        const cb = new TestCircuitBreaker(3); // trip after 3 failures
        for (let i = 0; i < 3; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);
    });

    it('should block actions when OPEN', async () => {
        const cb = new TestCircuitBreaker(1, 60000); // trip after 1, long timeout
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);

        const result = await cb.execute(() => Promise.resolve('should not run'));
        assert.strictEqual(result, null);
    });

    it('should transition to HALF_OPEN after timeout', async () => {
        const cb = new TestCircuitBreaker(1, 100); // 100ms timeout
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }
        assert.strictEqual(cb.getState(), CircuitState.OPEN);

        // Force lastFailureTime into the past so timeout has elapsed
        cb.lastFailureTime = Date.now() - 200;
        const result = await cb.execute(() => Promise.resolve('recovered'));
        assert.strictEqual(result, 'recovered');
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    });

    it('should reset to CLOSED on success in HALF_OPEN', async () => {
        const cb = new TestCircuitBreaker(1, 100);
        try { await cb.execute(() => Promise.reject(new Error('fail'))); }
        catch { /* expected */ }

        cb.lastFailureTime = Date.now() - 200; // Force timeout elapsed
        const result = await cb.execute(() => Promise.resolve('ok'));
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
        assert.strictEqual(cb.failureCount, 0);
    });

    it('should not trip before reaching threshold', async () => {
        const cb = new TestCircuitBreaker(5);
        for (let i = 0; i < 4; i++) {
            try { await cb.execute(() => Promise.reject(new Error('fail'))); }
            catch { /* expected */ }
        }
        assert.strictEqual(cb.getState(), CircuitState.CLOSED);
        assert.strictEqual(cb.failureCount, 4);
    });
});
