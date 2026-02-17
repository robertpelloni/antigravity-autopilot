const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * CodeReviewer Logic Tests
 * Tests security patterns, quality patterns, scoring, rule toggling,
 * banned commands, and quick security scan — without VS Code deps.
 */

// ============ Replicate patterns and reviewer logic ============

const SECURITY_PATTERNS = [
    { pattern: /(['"`])\s*\+\s*\w+\s*\+\s*\1.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)/i, type: 'security', severity: 'critical', message: 'SQL injection', rule: 'sql-injection' },
    { pattern: /exec\s*\(\s*[`'"].*\$\{/, type: 'security', severity: 'critical', message: 'Command injection', rule: 'command-injection' },
    { pattern: /(?:password|secret|api[_-]?key|token|auth)\s*[=:]\s*['"`][^'"`\s]{8,}/i, type: 'security', severity: 'high', message: 'Hardcoded secret', rule: 'hardcoded-secret' },
    { pattern: /\beval\s*\(/, type: 'security', severity: 'high', message: 'eval() usage', rule: 'no-eval' },
    { pattern: /\.innerHTML\s*=(?!.*sanitize)/i, type: 'security', severity: 'high', message: 'innerHTML XSS', rule: 'xss-innerhtml' },
    { pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/, type: 'security', severity: 'medium', message: 'Insecure HTTP', rule: 'insecure-http' },
    { pattern: /(?:md5|sha1)\s*\(/i, type: 'security', severity: 'medium', message: 'Weak crypto', rule: 'weak-crypto' }
];

const QUALITY_PATTERNS = [
    { pattern: /console\.(log|debug|info)\(/, type: 'quality', severity: 'low', message: 'Console statement', rule: 'no-console' },
    { pattern: /\/\/\s*(TODO|FIXME|HACK|XXX):/i, type: 'quality', severity: 'info', message: 'TODO comment', rule: 'no-todo' },
    { pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, type: 'quality', severity: 'medium', message: 'Empty catch', rule: 'no-empty-catch' },
    { pattern: /[^=!]==[^=]/, type: 'quality', severity: 'low', message: 'Use ===', rule: 'eqeqeq' }
];

const PERFORMANCE_PATTERNS = [
    { pattern: /(?:readFileSync|writeFileSync|existsSync|mkdirSync)\s*\(/, type: 'performance', severity: 'medium', message: 'Sync IO', rule: 'no-sync-io' }
];

const ALL_PATTERNS = [...SECURITY_PATTERNS, ...QUALITY_PATTERNS, ...PERFORMANCE_PATTERNS];

class TestCodeReviewer {
    constructor() {
        this.allPatterns = ALL_PATTERNS;
        this.enabledRules = new Set(ALL_PATTERNS.map(p => p.rule));
        this.disabledRules = new Set();
        this.minSeverityToBlock = 'high';
    }

    enableRule(rule) { this.enabledRules.add(rule); this.disabledRules.delete(rule); }
    disableRule(rule) { this.disabledRules.add(rule); this.enabledRules.delete(rule); }
    setMinBlockSeverity(sev) { this.minSeverityToBlock = sev; }

    review(code) {
        const issues = [];
        const lines = code.split('\n');

        for (let i = 0; i < lines.length; i++) {
            for (const p of this.allPatterns) {
                if (this.disabledRules.has(p.rule) || !this.enabledRules.has(p.rule)) continue;
                if (p.pattern.test(lines[i])) {
                    issues.push({ type: p.type, severity: p.severity, line: i + 1, message: p.message, rule: p.rule });
                }
            }
        }

        // Full-code patterns
        for (const p of this.allPatterns) {
            if (this.disabledRules.has(p.rule)) continue;
            if (issues.some(i => i.rule === p.rule)) continue;
            if (p.pattern.test(code)) {
                issues.push({ type: p.type, severity: p.severity, message: p.message, rule: p.rule });
            }
        }

        const score = this.calculateScore(issues);
        const sevOrder = ['critical', 'high', 'medium', 'low', 'info'];
        const blockThreshold = sevOrder.indexOf(this.minSeverityToBlock);
        const hasBlockingIssue = issues.some(i => sevOrder.indexOf(i.severity) <= blockThreshold);

        return { passed: !hasBlockingIssue, issues, score, reviewedAt: Date.now() };
    }

    calculateScore(issues) {
        const deductions = { critical: 30, high: 15, medium: 8, low: 3, info: 1 };
        let score = 100;
        for (const i of issues) score -= deductions[i.severity];
        return Math.max(0, score);
    }

    quickSecurityScan(code) {
        const issues = [];
        for (const p of SECURITY_PATTERNS) {
            if (p.pattern.test(code) && (p.severity === 'critical' || p.severity === 'high')) {
                issues.push({ type: p.type, severity: p.severity, message: p.message, rule: p.rule });
            }
        }
        return { safe: issues.length === 0, criticalIssues: issues };
    }

    checkBannedCommands(command, bannedList) {
        const norm = command.toLowerCase().trim();
        for (const banned of bannedList) {
            if (norm.includes(banned.toLowerCase())) return { blocked: true, reason: `Banned: ${banned}` };
        }
        const dangerous = [/rm\s+-rf?\s+[\/~]/, /format\s+[a-z]:/i, /del\s+\/[sfq]/i, />\s*\/dev\/sd[a-z]/, /dd\s+if=.*of=\/dev/];
        for (const p of dangerous) {
            if (p.test(norm)) return { blocked: true, reason: 'Destructive command' };
        }
        return { blocked: false };
    }
}

// ============ Tests ============

describe('CodeReviewer', () => {
    it('should detect eval() security issues', () => {
        const r = new TestCodeReviewer();
        const result = r.review('const x = eval("alert(1)")');
        assert.ok(result.issues.some(i => i.rule === 'no-eval'));
        assert.strictEqual(result.passed, false);
    });

    it('should detect innerHTML XSS', () => {
        const r = new TestCodeReviewer();
        const result = r.review('el.innerHTML = userInput');
        assert.ok(result.issues.some(i => i.rule === 'xss-innerhtml'));
    });

    it('should allow innerHTML with sanitize', () => {
        const r = new TestCodeReviewer();
        const result = r.review('el.innerHTML = sanitize(userInput)');
        assert.ok(!result.issues.some(i => i.rule === 'xss-innerhtml'));
    });

    it('should detect hardcoded secrets', () => {
        const r = new TestCodeReviewer();
        const result = r.review('const password = "mysecretpassword123"');
        assert.ok(result.issues.some(i => i.rule === 'hardcoded-secret'));
    });

    it('should detect console.log quality issues', () => {
        const r = new TestCodeReviewer();
        const result = r.review('console.log("debug info")');
        assert.ok(result.issues.some(i => i.rule === 'no-console'));
    });

    it('should detect empty catch blocks', () => {
        const r = new TestCodeReviewer();
        const result = r.review('try { foo() } catch(e) { }');
        assert.ok(result.issues.some(i => i.rule === 'no-empty-catch'));
    });

    it('should detect sync file operations', () => {
        const r = new TestCodeReviewer();
        const result = r.review('const data = readFileSync("file.txt")');
        assert.ok(result.issues.some(i => i.rule === 'no-sync-io'));
    });

    it('should pass clean code with high score', () => {
        const r = new TestCodeReviewer();
        const result = r.review('const x = 1 + 2;');
        assert.strictEqual(result.passed, true);
        assert.ok(result.score >= 90);
    });

    it('should respect disabled rules', () => {
        const r = new TestCodeReviewer();
        r.disableRule('no-eval');
        const result = r.review('eval("code")');
        assert.ok(!result.issues.some(i => i.rule === 'no-eval'));
    });

    it('should run quick security scan', () => {
        const r = new TestCodeReviewer();
        const scan = r.quickSecurityScan('eval("malicious"); md5(data)');
        assert.strictEqual(scan.safe, false);
        assert.ok(scan.criticalIssues.some(i => i.rule === 'no-eval'));
    });

    it('should block banned commands', () => {
        const r = new TestCodeReviewer();
        const result = r.checkBannedCommands('npm init', ['npm']);
        assert.strictEqual(result.blocked, true);

        const safe = r.checkBannedCommands('git status', ['npm']);
        assert.strictEqual(safe.blocked, false);
    });

    it('should block dangerous system commands', () => {
        const r = new TestCodeReviewer();
        const result = r.checkBannedCommands('rm -rf /', []);
        assert.strictEqual(result.blocked, true);

        const format = r.checkBannedCommands('format C:', []);
        assert.strictEqual(format.blocked, true);
    });
});
