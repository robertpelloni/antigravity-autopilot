const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * TestLoopDetector Logic Tests
 * Tests detection of test-only vs feature-work loops and exit conditions.
 */

// ============ Replicate patterns and logic ============

const TEST_PATTERNS = [
    /running\s+(unit\s+)?tests?/i,
    /npm\s+(run\s+)?test/i,
    /jest|vitest|mocha|pytest|rspec/i,
    /all\s+tests?\s+pass(ed|ing)?/i,
    /\d+\s+tests?\s+(passed|passing)/i,
    /test\s+suite/i,
    /coverage\s+report/i,
    /no\s+changes?\s+(needed|required)/i,
    /everything\s+is\s+working/i,
    /all\s+good|looks\s+good/i,
];

const FEATURE_WORK_PATTERNS = [
    /creat(ed?|ing)\s+(new\s+)?file/i,
    /modif(ied|ying)\s+\w+/i,
    /implement(ed|ing)/i,
    /add(ed|ing)\s+(new\s+)?/i,
    /fix(ed|ing)\s+(bug|issue|error)/i,
    /refactor(ed|ing)/i,
    /updat(ed|ing)\s+\w+/i,
];

class TestLoopDetector {
    constructor(maxTestLoops = 3) {
        this.consecutiveTestLoops = 0;
        this.totalLoops = 0;
        this.testLoops = 0;
        this.maxTestLoops = maxTestLoops;
    }

    analyzeResponse(response) {
        if (!response || response.trim() === '') {
            return { isTestOnly: false, confidence: 0, shouldExit: false };
        }
        this.totalLoops++;
        let testMatches = 0, featureMatches = 0;
        for (const p of TEST_PATTERNS) if (p.test(response)) testMatches++;
        for (const p of FEATURE_WORK_PATTERNS) if (p.test(response)) featureMatches++;

        const isTestOnly = testMatches > 0 && featureMatches === 0;
        const confidence = testMatches / (testMatches + featureMatches + 1);

        if (isTestOnly) { this.consecutiveTestLoops++; this.testLoops++; }
        else { this.consecutiveTestLoops = 0; }

        const shouldExit = this.consecutiveTestLoops >= this.maxTestLoops;
        return { isTestOnly, confidence, shouldExit, reason: shouldExit ? `${this.consecutiveTestLoops} consecutive test loops` : undefined };
    }

    getTestPercentage() {
        if (this.totalLoops === 0) return 0;
        return (this.testLoops / this.totalLoops) * 100;
    }

    getStatus() {
        return { consecutive: this.consecutiveTestLoops, total: this.testLoops, percentage: this.getTestPercentage() };
    }

    reset() { this.consecutiveTestLoops = 0; this.totalLoops = 0; this.testLoops = 0; }
}

// ============ Tests ============

describe('TestLoopDetector', () => {
    it('should detect test-only responses', () => {
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('All tests passed. 45 tests passing.');
        assert.strictEqual(result.isTestOnly, true);
        assert.ok(result.confidence > 0);
    });

    it('should detect feature work responses', () => {
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('Created new file utils.ts and implemented the handler');
        assert.strictEqual(result.isTestOnly, false);
    });

    it('should not flag mixed responses as test-only', () => {
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('Implemented new feature. Running tests now. All tests passed.');
        assert.strictEqual(result.isTestOnly, false);
    });

    it('should track consecutive test loops', () => {
        const d = new TestLoopDetector(3);
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Running test suite');
        assert.strictEqual(d.getStatus().consecutive, 2);
    });

    it('should reset consecutive on feature work', () => {
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Created new file service.ts');
        assert.strictEqual(d.getStatus().consecutive, 0);
    });

    it('should trigger exit after max consecutive test loops', () => {
        const d = new TestLoopDetector(2);
        d.analyzeResponse('npm test');
        const result = d.analyzeResponse('All tests passed');
        assert.strictEqual(result.shouldExit, true);
    });

    it('should track test percentage', () => {
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.analyzeResponse('Implementing feature');
        assert.strictEqual(d.getTestPercentage(), 50);
    });

    it('should reset state', () => {
        const d = new TestLoopDetector();
        d.analyzeResponse('All tests passed');
        d.reset();
        assert.strictEqual(d.getStatus().consecutive, 0);
        assert.strictEqual(d.getStatus().total, 0);
    });

    it('should handle empty responses', () => {
        const d = new TestLoopDetector();
        const result = d.analyzeResponse('');
        assert.strictEqual(result.isTestOnly, false);
        assert.strictEqual(result.shouldExit, false);
    });
});
