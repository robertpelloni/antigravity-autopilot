const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * TaskAnalyzer Logic Tests
 * Tests keyword-based task classification and fix plan extraction.
 */

// ============ Replicate constants and logic ============

const TaskType = { REASONING: 'reasoning', FRONTEND: 'frontend', QUICK: 'quick', GENERAL: 'general' };

const TASK_KEYWORDS = {
    reasoning: ['debug', 'fix', 'error', 'bug', 'issue', 'problem', 'investigate', 'analyze', 'optimize', 'refactor', 'architecture', 'design', 'complex', 'algorithm', 'performance', 'memory', 'race condition', 'deadlock'],
    frontend: ['ui', 'ux', 'css', 'style', 'layout', 'component', 'react', 'vue', 'angular', 'html', 'responsive', 'animation', 'theme', 'design', 'button', 'form', 'modal', 'dashboard', 'page', 'screen'],
    quick: ['rename', 'typo', 'comment', 'format', 'lint', 'import', 'export', 'simple', 'quick', 'minor', 'small', 'cleanup', 'remove', 'delete']
};

class TestTaskAnalyzer {
    analyze(desc) {
        if (!desc || desc.trim() === '') return TaskType.GENERAL;
        const lower = desc.toLowerCase();
        const scores = this.calculateScores(lower);
        const max = Math.max(scores.reasoning, scores.frontend, scores.quick);
        if (max === 0) return TaskType.GENERAL;
        if (scores.reasoning === max) return TaskType.REASONING;
        if (scores.frontend === max) return TaskType.FRONTEND;
        if (scores.quick === max) return TaskType.QUICK;
        return TaskType.GENERAL;
    }

    calculateScores(text) {
        return {
            reasoning: this.countMatches(text, TASK_KEYWORDS.reasoning),
            frontend: this.countMatches(text, TASK_KEYWORDS.frontend),
            quick: this.countMatches(text, TASK_KEYWORDS.quick)
        };
    }

    countMatches(text, keywords) {
        return keywords.reduce((c, kw) => c + (text.includes(kw) ? 1 : 0), 0);
    }

    extractCurrentTask(content) {
        const lines = content.split('\n');
        for (const line of lines) {
            if (/^[-*]\s*\[\s*\]/.test(line)) {
                if (line.includes('~~')) continue;
                const task = line.replace(/^[-*]\s*\[\s*\]\s*/, '').trim();
                if (task.length < 3) continue;
                return task;
            }
        }
        return null;
    }

    markTaskComplete(content, task) {
        const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^([-*]\\s*)\\[\\s*\\](\\s*${escaped})`, 'mi');
        return content.replace(pattern, '$1[x]$2');
    }
}

// ============ Tests ============

describe('TaskAnalyzer', () => {
    it('should classify debugging tasks as REASONING', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.analyze('Debug the memory leak issue'), TaskType.REASONING);
        assert.strictEqual(a.analyze('Fix the race condition bug'), TaskType.REASONING);
    });

    it('should classify UI tasks as FRONTEND', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.analyze('Update the CSS styles for the dashboard'), TaskType.FRONTEND);
        assert.strictEqual(a.analyze('Create a new React component for the modal'), TaskType.FRONTEND);
    });

    it('should classify simple tasks as QUICK', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.analyze('Rename the variable and fix the typo'), TaskType.QUICK);
        assert.strictEqual(a.analyze('Remove unused imports'), TaskType.QUICK);
    });

    it('should default to GENERAL for unrecognizable tasks', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.analyze('Do something interesting'), TaskType.GENERAL);
    });

    it('should default to GENERAL for empty input', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.analyze(''), TaskType.GENERAL);
        assert.strictEqual(a.analyze(null), TaskType.GENERAL);
    });

    it('should extract current task from fix plan', () => {
        const a = new TestTaskAnalyzer();
        const plan = '- [x] Done task\n- [ ] Current task\n- [ ] Future task';
        assert.strictEqual(a.extractCurrentTask(plan), 'Current task');
    });

    it('should skip crossed-out tasks', () => {
        const a = new TestTaskAnalyzer();
        const plan = '- [ ] ~~Skipped~~ task\n- [ ] Valid task';
        assert.strictEqual(a.extractCurrentTask(plan), 'Valid task');
    });

    it('should mark task complete', () => {
        const a = new TestTaskAnalyzer();
        const content = '- [ ] Fix the bug\n- [ ] Other task';
        const updated = a.markTaskComplete(content, 'Fix the bug');
        assert.ok(updated.includes('[x] Fix the bug'));
    });

    it('should return null when no tasks remain', () => {
        const a = new TestTaskAnalyzer();
        assert.strictEqual(a.extractCurrentTask('- [x] All done'), null);
    });
});
