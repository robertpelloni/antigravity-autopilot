const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

/**
 * VoiceControl Command Parsing Tests
 * Tests command recognition, wake word, confidence, and stats.
 */

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
        if (request === 'vscode') {
            return {
                window: {
                    createOutputChannel: () => ({ appendLine: () => undefined }),
                    showInformationMessage: () => undefined
                },
                workspace: {
                    getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => undefined })
                },
                ConfigurationTarget: { Global: 1 }
            };
        }

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

const voiceControlModule = loadTsModule(path.resolve(__dirname, '../src/modules/voice/control.ts'));
const parseCommand = voiceControlModule.parseCommand;
const VoiceControl = voiceControlModule.VoiceControl;

// ============ Tests ============

describe('VoiceControl Command Parsing', () => {
    it('should parse approve commands', () => {
        assert.strictEqual(parseCommand('approve').intent, 'approve');
        assert.strictEqual(parseCommand('yes').intent, 'approve');
        assert.strictEqual(parseCommand('looks good').intent, 'approve');
        assert.strictEqual(parseCommand('lgtm').intent, 'approve');
    });

    it('should parse reject commands', () => {
        assert.strictEqual(parseCommand('reject this').intent, 'reject');
        assert.strictEqual(parseCommand('no').intent, 'reject');
        assert.strictEqual(parseCommand('abort').intent, 'reject');
    });

    it('should parse bump commands', () => {
        assert.strictEqual(parseCommand('bump').intent, 'bump');
        assert.strictEqual(parseCommand('nudge the agent').intent, 'bump');
    });

    it('should parse switch_model with parameter extraction', () => {
        const cmd = parseCommand('switch to claude');
        assert.strictEqual(cmd.intent, 'switch_model');
        assert.strictEqual(cmd.params.model, 'claude');
    });

    it('should parse status commands', () => {
        assert.strictEqual(parseCommand('status').intent, 'status');
        assert.strictEqual(parseCommand('progress').intent, 'status');
    });

    it('should parse pause and resume', () => {
        assert.strictEqual(parseCommand('pause').intent, 'pause');
        assert.strictEqual(parseCommand('resume').intent, 'resume');
        assert.strictEqual(parseCommand('proceed').intent, 'resume');
    });

    it('should parse dashboard commands', () => {
        assert.strictEqual(parseCommand('open dashboard').intent, 'open_dashboard');
        assert.strictEqual(parseCommand('show the dashboard').intent, 'open_dashboard');
    });

    it('should parse test and deploy commands', () => {
        assert.strictEqual(parseCommand('run tests').intent, 'run_tests');
        assert.strictEqual(parseCommand('deploy').intent, 'deploy');
        assert.strictEqual(parseCommand('ship it').intent, 'deploy');
    });

    it('should return unknown for unrecognized commands', () => {
        const cmd = parseCommand('hello world');
        assert.strictEqual(cmd.intent, 'unknown');
        assert.strictEqual(cmd.confidence, 0.0);
    });

    it('should return null for empty input', () => {
        assert.strictEqual(parseCommand(''), null);
        assert.strictEqual(parseCommand('   '), null);
    });

    it('should execute parsed intents through configured runtime executor', async () => {
        const vc = new VoiceControl();
        await vc.start();

        const executed = [];
        vc.setIntentExecutor(async (cmd) => {
            executed.push(cmd.intent);
            return { handled: cmd.intent === 'approve' };
        });

        const outcome = await vc.processAndExecuteTranscription('approve this');
        assert.strictEqual(outcome.executed, true);
        assert.strictEqual(outcome.handled, true);
        assert.deepStrictEqual(executed, ['approve']);

        const stats = vc.getStats();
        assert.strictEqual(stats.executionSuccesses, 1);
        assert.strictEqual(stats.executionFailures, 0);
        assert.strictEqual(stats.commandCounts.approve, 1);
    });

    it('should support force-processing for manual transcript debug when inactive', async () => {
        const vc = new VoiceControl();
        vc.setIntentExecutor(async () => ({ handled: true }));

        const normal = await vc.processAndExecuteTranscription('status');
        assert.strictEqual(normal.command, null);
        assert.strictEqual(normal.executed, false);

        const forced = await vc.processAndExecuteTranscription('status', { force: true });
        assert.strictEqual(forced.executed, true);
        assert.strictEqual(forced.handled, true);
        assert.strictEqual(forced.command.intent, 'status');
    });

    it('should report execution failure when intent is unsupported or unknown', async () => {
        const vc = new VoiceControl();
        await vc.start();

        vc.setIntentExecutor(async () => ({ handled: false, detail: 'unsupported intent' }));
        const unsupported = await vc.processAndExecuteTranscription('deploy now');
        assert.strictEqual(unsupported.executed, true);
        assert.strictEqual(unsupported.handled, false);
        assert.ok(unsupported.error.includes('unsupported'));

        const unknown = await vc.processAndExecuteTranscription('totally unrecognized phrase');
        assert.strictEqual(unknown.executed, false);
        assert.strictEqual(unknown.handled, false);
        assert.strictEqual(unknown.error, 'unknown intent');

        const stats = vc.getStats();
        assert.ok(stats.executionFailures >= 2);
        assert.ok(typeof stats.lastExecutionError === 'string');
    });
});
