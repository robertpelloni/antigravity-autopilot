const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function loadTsModule(filePath, cache = new Map()) {
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
        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, cache);
                }
            }
        }
        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

const runtimeGuardModule = loadTsModule(path.resolve(__dirname, '../src/core/runtime-auto-resume-guard.ts'));
const { evaluateCrossUiHealth, buildAutoResumeGuardReport } = runtimeGuardModule;

function state(overrides = {}) {
    return {
        status: 'waiting_for_chat_message',
        waitingForChatMessage: true,
        profileCoverage: {
            vscode: { hasVisibleInput: true, hasVisibleSendButton: true, pendingAcceptButtons: 0 },
            antigravity: { hasVisibleInput: true, hasVisibleSendButton: true, pendingAcceptButtons: 0 },
            cursor: { hasVisibleInput: false, hasVisibleSendButton: false, pendingAcceptButtons: 0 }
        },
        ...overrides
    };
}

describe('Runtime auto-resume deterministic soak harness', () => {
    it('replays degraded-to-healthy sequence and guard flips from blocked to allowed', () => {
        const degraded = state({
            status: 'unknown',
            profileCoverage: {
                vscode: { hasVisibleInput: false, hasVisibleSendButton: false, pendingAcceptButtons: 0 },
                antigravity: { hasVisibleInput: false, hasVisibleSendButton: false, pendingAcceptButtons: 0 },
                cursor: { hasVisibleInput: false, hasVisibleSendButton: false, pendingAcceptButtons: 0 }
            }
        });

        const healthy = state();

        const before = buildAutoResumeGuardReport(degraded, { minScore: 70, requireStrict: true });
        const after = buildAutoResumeGuardReport(healthy, { minScore: 70, requireStrict: true });

        assert.strictEqual(before.allowed, false);
        assert.strictEqual(after.allowed, true);
        assert.ok(after.health.score > before.health.score);
    });

    it('blocks when strict mode fails even if non-strict score is high enough', () => {
        const strictFailState = state({
            profileCoverage: {
                vscode: { hasVisibleInput: true, hasVisibleSendButton: true, pendingAcceptButtons: 0 },
                antigravity: { hasVisibleInput: false, hasVisibleSendButton: true, pendingAcceptButtons: 0 },
                cursor: { hasVisibleInput: true, hasVisibleSendButton: true, pendingAcceptButtons: 1 }
            }
        });

        const strictReport = buildAutoResumeGuardReport(strictFailState, { minScore: 70, requireStrict: true });
        const relaxedReport = buildAutoResumeGuardReport(strictFailState, { minScore: 70, requireStrict: false });

        assert.strictEqual(strictReport.allowed, false);
        assert.strictEqual(relaxedReport.allowed, true);
        assert.strictEqual(strictReport.health.score, relaxedReport.health.score);
    });

    it('produces stable grade and score parts for equivalent replay states', () => {
        const replayA = state();
        const replayB = state();

        const healthA = evaluateCrossUiHealth(replayA);
        const healthB = evaluateCrossUiHealth(replayB);

        assert.strictEqual(healthA.grade, healthB.grade);
        assert.strictEqual(healthA.score, healthB.score);
        assert.deepStrictEqual(healthA.scoreParts, healthB.scoreParts);
    });
});
