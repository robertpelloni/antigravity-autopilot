const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function createLoggerMock() {
    const noop = () => { };
    return { debug: noop, info: noop, warn: noop, error: noop };
}

function createVscodeMock() {
    class Range {
        constructor(startLine, startCharacter, endLine, endCharacter) {
            this.start = { line: startLine, character: startCharacter };
            this.end = { line: endLine, character: endCharacter };
        }
    }

    class Diagnostic {
        constructor(range, message, severity) {
            this.range = range;
            this.message = message;
            this.severity = severity;
            this.source = undefined;
            this.code = undefined;
        }
    }

    return {
        DiagnosticSeverity: {
            Error: 0,
            Warning: 1,
            Information: 2,
            Hint: 3
        },
        Range,
        Diagnostic
    };
}

function loadTsModule(filePath, mocks = {}, cache = new Map()) {
    const absolutePath = path.resolve(filePath);
    if (cache.has(absolutePath)) {
        return cache.get(absolutePath).exports;
    }

    const source = fs.readFileSync(absolutePath, 'utf-8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        },
        fileName: absolutePath
    }).outputText;

    const mod = new Module(absolutePath, module);
    cache.set(absolutePath, mod);
    mod.filename = absolutePath;
    mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
        if (request in mocks) {
            return mocks[request];
        }

        if (request === 'vscode') {
            return createVscodeMock();
        }

        if (request === '../utils/logger' || request.endsWith('/utils/logger')) {
            return { createLogger: () => createLoggerMock() };
        }

        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, mocks, cache);
                }
            }
        }

        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

const reviewerModule = loadTsModule(path.resolve(__dirname, '../src/core/code-reviewer.ts'));
const CodeReviewer = reviewerModule.CodeReviewer;

describe('CodeReviewer (real module)', () => {
    it('should detect eval() security issues', () => {
        const reviewer = new CodeReviewer();
        const result = reviewer.review('const x = eval("alert(1)")');

        assert.ok(result.issues.some((i) => i.rule === 'no-eval'));
        assert.strictEqual(result.passed, false);
    });

    it('should detect innerHTML XSS and allow sanitized usage', () => {
        const reviewer = new CodeReviewer();

        const bad = reviewer.review('el.innerHTML = userInput');
        assert.ok(bad.issues.some((i) => i.rule === 'xss-innerhtml'));

        const good = reviewer.review('el.innerHTML = sanitize(userInput)');
        assert.ok(!good.issues.some((i) => i.rule === 'xss-innerhtml'));
    });

    it('should detect hardcoded secrets', () => {
        const reviewer = new CodeReviewer();
        const result = reviewer.review('const password = "mysecretpassword123"');
        assert.ok(result.issues.some((i) => i.rule === 'hardcoded-secret'));
    });

    it('should detect quality and performance issues', () => {
        const reviewer = new CodeReviewer();
        const result = reviewer.review('console.log("debug");\ntry { foo(); } catch(e) { }\nreadFileSync("x")');

        assert.ok(result.issues.some((i) => i.rule === 'no-console'));
        assert.ok(result.issues.some((i) => i.rule === 'no-empty-catch'));
        assert.ok(result.issues.some((i) => i.rule === 'no-sync-io'));
    });

    it('should pass clean code with strong score', () => {
        const reviewer = new CodeReviewer();
        const result = reviewer.review('const x = 1 + 2;');

        assert.strictEqual(result.passed, true);
        assert.ok(result.score >= 90);
    });

    it('should respect disabled rules', () => {
        const reviewer = new CodeReviewer();
        reviewer.disableRule('no-eval');

        const result = reviewer.review('eval("code")');
        assert.ok(!result.issues.some((i) => i.rule === 'no-eval'));
    });

    it('should support quick security scan for high/critical findings', () => {
        const reviewer = new CodeReviewer();
        const scan = reviewer.quickSecurityScan('eval("malicious"); md5(data)');

        assert.strictEqual(scan.safe, false);
        assert.ok(scan.criticalIssues.some((i) => i.rule === 'no-eval'));
        assert.ok(!scan.criticalIssues.some((i) => i.rule === 'weak-crypto'));
    });

    it('should block banned and dangerous commands', () => {
        const reviewer = new CodeReviewer();

        const banned = reviewer.checkBannedCommands('npm init', ['npm']);
        assert.strictEqual(banned.blocked, true);

        const dangerous = reviewer.checkBannedCommands('rm -rf /', []);
        assert.strictEqual(dangerous.blocked, true);

        const safe = reviewer.checkBannedCommands('git status', ['npm']);
        assert.strictEqual(safe.blocked, false);
    });

    it('should generate diagnostics with mapped severity and rule code', () => {
        const reviewer = new CodeReviewer();
        const result = reviewer.review('const x = eval("alert(1)")');

        const diagnostics = reviewer.showDiagnostics({ fileName: 'sample.ts' }, result.issues);
        assert.ok(diagnostics.length >= 1);
        assert.ok(diagnostics[0].message.includes('[Yoke]'));
        assert.ok(typeof diagnostics[0].code === 'string');
    });
});
