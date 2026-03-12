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

        if (request === 'vscode') {
            return createVscodeMock();
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

function createVscodeMock() {
    return {
        StatusBarAlignment: { Right: 1 },
        ThemeColor: class ThemeColor {
            constructor(id) {
                this.id = id;
            }
        },
        commands: {
            executeCommand: async () => undefined
        },
        window: {
            createStatusBarItem: () => ({
                show() { },
                dispose() { }
            }),
            showInformationMessage: async () => undefined
        }
    };
}

function createStrategyHarness({ broadcastToAll = false, pages = {} } = {}) {
    const logs = [];
    const connections = new Map();
    for (const [pageId, pageConfig] of Object.entries(pages)) {
        const sessions = Array.isArray(pageConfig.sessions) ? pageConfig.sessions : [];
        connections.set(pageId, { sessions: new Set(sessions) });
    }

    const handler = {
        connections,
        setControllerRole() { },
        setHostWindowFocused() { },
        isConnected() { return connections.size > 0; },
        connect: async () => true,
        disconnectAll() { },
        removeAllListeners() { },
        on() { },
        getTrackedSessions() {
            return Array.from(connections.keys()).map((id) => ({ id, title: id, url: `vscode:///${id}` }));
        },
        executeInFirstTruthySession: async () => null,
        async sendCommand(pageId, method, params, _unused, sessionId) {
            assert.strictEqual(method, 'Runtime.evaluate');
            const pageConfig = pages[pageId] || {};
            const contextKey = sessionId ? `${pageId}:${sessionId}` : pageId;
            if (params.expression.includes('readyToResume') && params.expression.includes('completeStopSignal')) {
                const value = pageConfig.readyByContext?.[contextKey] || { ready: false, reason: 'not-configured' };
                return { result: { value } };
            }

            if (params.expression.includes('activeComposer') && params.expression.includes('composerCount')) {
                const value = pageConfig.scoreByContext?.[contextKey] || {
                    visible: false,
                    focused: false,
                    hasRuntime: false,
                    hasComposer: false,
                    composerCount: 0,
                    activeComposer: false,
                    activeTag: 'none',
                    isGenerating: false,
                    isStalled: false
                };
                return { result: { value } };
            }

            throw new Error(`Unexpected Runtime.evaluate expression for ${contextKey}`);
        }
    };

    const strategyModule = loadTsModule(path.resolve(__dirname, '../src/strategies/cdp-strategy.ts'), {
        vscode: createVscodeMock(),
        '../providers/cdp-client': {
            cdpClient: {
                getHandler: () => handler
            }
        },
        '../utils/config': {
            config: {
                get(key) {
                    if (key === 'automation.bump.broadcastToAllPages') {
                        return broadcastToAll;
                    }
                    return undefined;
                }
            }
        },
        '../services/cdp/cdp-handler': {
            CDPHandler: class CDPHandler { }
        },
        '../utils/output-channel': {
            logToOutput(message) {
                logs.push(String(message));
            }
        }
    });

    const strategy = new strategyModule.CDPStrategy({ subscriptions: [] });
    return { strategy, logs };
}

describe('CDP Strategy stalled-window targeting', () => {
    it('returns all stalled windows regardless of focus or last bump target', async () => {
        const { strategy } = createStrategyHarness({
            pages: {
                'page-a': {
                    readyByContext: {
                        'page-a': { ready: true, reason: 'focused-ready' }
                    }
                },
                'page-b': {
                    readyByContext: {
                        'page-b': { ready: true, reason: 'background-ready' }
                    }
                }
            }
        });

        strategy.lastBumpTargetPageId = 'page-a';
        const result = await strategy.getReadyStopSignalTargets();

        assert.deepStrictEqual(result.readyTargets, ['page-a', 'page-b']);
    });

    it('returns all stalled windows even when broadcast mode is disabled', async () => {
        const { strategy } = createStrategyHarness({
            broadcastToAll: false,
            pages: {
                'page-a': {
                    readyByContext: {
                        'page-a': { ready: true, reason: 'ready-a' }
                    }
                },
                'page-b': {
                    readyByContext: {
                        'page-b': { ready: true, reason: 'ready-b' }
                    }
                }
            }
        });

        const result = await strategy.getReadyStopSignalTargets();
        assert.deepStrictEqual(result.readyTargets, ['page-a', 'page-b']);
    });

    it('skips windows that do not report an explicit stalled-chat stop signal', async () => {
        const { strategy } = createStrategyHarness({
            pages: {
                'page-a': {
                    readyByContext: {
                        'page-a': { ready: true, reason: 'explicit-stop-signal' }
                    }
                },
                'page-b': {
                    readyByContext: {
                        'page-b': { ready: false, reason: 'runtime-missing-vscode-stop-cue' }
                    }
                }
            }
        });

        const result = await strategy.getReadyStopSignalTargets();
        assert.deepStrictEqual(result.readyTargets, ['page-a']);
        assert.deepStrictEqual(result.skipped, ['page-b:runtime-missing-vscode-stop-cue']);
    });
});
