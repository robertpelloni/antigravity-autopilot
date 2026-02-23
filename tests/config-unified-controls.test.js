const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

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

function createVscodeConfigMock(values = {}) {
    return {
        workspace: {
            getConfiguration: () => ({
                get: (key, defaultValue) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue),
                update: async () => undefined
            })
        },
        ConfigurationTarget: {
            Global: 1,
            Workspace: 2,
            WorkspaceFolder: 3
        }
    };
}

function loadConfigWithValues(values) {
    return loadTsModule(
        path.resolve(__dirname, '../src/utils/config.ts'),
        { vscode: createVscodeConfigMock(values) }
    );
}

describe('Config unified autopilot controls (real module)', () => {
    it('derives autopilotAutoAcceptEnabled from legacy toggles when unified key is unset', () => {
        const configModule = loadConfigWithValues({
            autoAllEnabled: true,
            autoAcceptEnabled: false
        });

        const all = configModule.config.getAll();
        assert.strictEqual(all.autopilotAutoAcceptEnabled, true);
    });

    it('honors explicit unified autopilotAutoAcceptEnabled over legacy fallback', () => {
        const configModule = loadConfigWithValues({
            autopilotAutoAcceptEnabled: false,
            autoAllEnabled: true,
            autoAcceptEnabled: true
        });

        const all = configModule.config.getAll();
        assert.strictEqual(all.autopilotAutoAcceptEnabled, false);
    });

    it('falls back autoAcceptPollIntervalMs to pollFrequency when unified timing is unset', () => {
        const configModule = loadConfigWithValues({
            pollFrequency: 650
        });

        const all = configModule.config.getAll();
        assert.strictEqual(all.autoAcceptPollIntervalMs, 650);
    });

    it('falls back autoBumpCooldownSec to autoApproveDelay when unified timing is unset', () => {
        const configModule = loadConfigWithValues({
            autoApproveDelay: 42
        });

        const all = configModule.config.getAll();
        assert.strictEqual(all.autoBumpCooldownSec, 42);
    });

    it('keeps grouped toggle defaults enabled for bump and run/expand/continue', () => {
        const configModule = loadConfigWithValues({});
        const all = configModule.config.getAll();

        assert.strictEqual(all.autopilotAutoBumpEnabled, true);
        assert.strictEqual(all.autopilotRunExpandContinueEnabled, true);
    });

    it('sanitizes unsafe click/submit methods from effective config', () => {
        const configModule = loadConfigWithValues({
            interactionClickMethods: ['dom-scan-click', 'bridge-click', 'cdp-mouse', 'native-accept', 'coord-click', 'vscode-cmd', 'process-peek'],
            interactionSubmitMethods: ['vscode-submit', 'script-submit', 'alt-enter', 'cdp-enter', 'ctrl-enter']
        });

        const all = configModule.config.getAll();
        assert.deepStrictEqual(all.interactionClickMethods, ['dom-scan-click', 'native-accept']);
        assert.deepStrictEqual(all.interactionSubmitMethods, ['vscode-submit', 'script-submit']);
    });

    it('uses safe defaults for per-profile click methods', () => {
        const configModule = loadConfigWithValues({
            interactionClickMethodsVSCode: ['dom-scan-click', 'bridge-click', 'cdp-mouse', 'vscode-cmd'],
            interactionClickMethodsAntigravity: ['dom-click', 'bridge-click', 'script-force'],
            interactionClickMethodsCursor: ['dom-click', 'cdp-mouse', 'native-accept']
        });

        const all = configModule.config.getAll();
        assert.deepStrictEqual(all.interactionClickMethodsVSCode, ['dom-scan-click']);
        assert.deepStrictEqual(all.interactionClickMethodsAntigravity, ['dom-click', 'script-force']);
        assert.deepStrictEqual(all.interactionClickMethodsCursor, ['dom-click', 'native-accept']);
    });
});
