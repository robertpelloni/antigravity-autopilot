const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * ProgressTracker Logic Tests
 * Tests session lifecycle, loop recording, stats tracking, and summary.
 */

// ============ Replicate ProgressTracker for testing ============

class TestProgressTracker {
    constructor() {
        this.stats = {
            totalLoops: 0, successfulLoops: 0, failedLoops: 0,
            modelSwitches: 0, startTime: Date.now(), filesChanged: 0, promptsSent: 0
        };
    }

    startSession() {
        this.stats = {
            totalLoops: 0, successfulLoops: 0, failedLoops: 0,
            modelSwitches: 0, startTime: Date.now(), filesChanged: 0, promptsSent: 0
        };
    }

    async recordLoop(result) {
        this.stats.totalLoops++;
        if (result.hasErrors) this.stats.failedLoops++;
        else this.stats.successfulLoops++;
        const filesChanged = result.hasErrors ? 0 : 1;
        this.stats.filesChanged += filesChanged;
        return { filesChanged, hasErrors: result.hasErrors, responseLength: 100, responseHash: 'dummy' };
    }

    recordModelSwitch() { this.stats.modelSwitches++; }
    recordPromptSent() { this.stats.promptsSent++; }

    getSummary() {
        const duration = (Date.now() - this.stats.startTime) / 1000 / 60;
        const rate = this.stats.totalLoops > 0 ? ((this.stats.successfulLoops / this.stats.totalLoops) * 100).toFixed(1) : '0.0';
        return `Session Duration: ${duration.toFixed(1)} mins\nTotal Loops: ${this.stats.totalLoops}\nSuccess Rate: ${rate}%\nModel Switches: ${this.stats.modelSwitches}\nPrompts Sent: ${this.stats.promptsSent}`;
    }

    getStats() { return { ...this.stats }; }
    getDurationMinutes() { return (Date.now() - this.stats.startTime) / 1000 / 60; }
}

// ============ Tests ============

describe('ProgressTracker', () => {
    it('should start a fresh session', () => {
        const pt = new TestProgressTracker();
        pt.startSession();
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 0);
        assert.strictEqual(stats.successfulLoops, 0);
        assert.strictEqual(stats.failedLoops, 0);
    });

    it('should record successful loops', async () => {
        const pt = new TestProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: false });
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 1);
        assert.strictEqual(stats.successfulLoops, 1);
        assert.strictEqual(stats.filesChanged, 1);
    });

    it('should record failed loops', async () => {
        const pt = new TestProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: true });
        const stats = pt.getStats();
        assert.strictEqual(stats.failedLoops, 1);
        assert.strictEqual(stats.filesChanged, 0);
    });

    it('should track model switches', () => {
        const pt = new TestProgressTracker();
        pt.recordModelSwitch();
        pt.recordModelSwitch();
        assert.strictEqual(pt.getStats().modelSwitches, 2);
    });

    it('should track prompts sent', () => {
        const pt = new TestProgressTracker();
        pt.recordPromptSent();
        pt.recordPromptSent();
        pt.recordPromptSent();
        assert.strictEqual(pt.getStats().promptsSent, 3);
    });

    it('should generate summary string', async () => {
        const pt = new TestProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: false });
        await pt.recordLoop({ modelUsed: 'test', hasErrors: true });
        pt.recordModelSwitch();
        const summary = pt.getSummary();
        assert.ok(summary.includes('Total Loops: 2'));
        assert.ok(summary.includes('Model Switches: 1'));
        assert.ok(summary.includes('Success Rate: 50.0%'));
    });

    it('should track duration', () => {
        const pt = new TestProgressTracker();
        const duration = pt.getDurationMinutes();
        assert.ok(duration >= 0);
        assert.ok(duration < 1); // Should be less than 1 minute since we just created it
    });

    it('should reset on new session', async () => {
        const pt = new TestProgressTracker();
        await pt.recordLoop({ modelUsed: 'test', hasErrors: false });
        pt.recordModelSwitch();
        pt.startSession();
        const stats = pt.getStats();
        assert.strictEqual(stats.totalLoops, 0);
        assert.strictEqual(stats.modelSwitches, 0);
    });
});
