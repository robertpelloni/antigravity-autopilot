const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

let mockMaxConsecutiveTestLoops = 3;

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
                    createOutputChannel: () => ({ appendLine: () => undefined })
                },
                workspace: {
                    getConfiguration: () => ({
                        get: (key, fallback) => {
                            if (key === 'maxConsecutiveTestLoops') {
                                return mockMaxConsecutiveTestLoops;
                            }
                            return fallback;
                        },
                        update: async () => undefined
                    })
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

const exitDetectorModule = loadTsModule(path.resolve(__dirname, '../src/core/exit-detector.ts'));
const testLoopDetectorModule = loadTsModule(path.resolve(__dirname, '../src/core/test-loop-detector.ts'));

const ExitDetector = exitDetectorModule.ExitDetector;
const TestLoopDetector = testLoopDetectorModule.TestLoopDetector;

function evaluateScenario(steps) {
    const exitDetector = new ExitDetector();
    const testLoopDetector = new TestLoopDetector();

    let stopIndex = -1;
    let stopSource = 'none';
    let stopReason = '';

    for (let i = 0; i < steps.length; i++) {
        const response = steps[i];

        const completion = exitDetector.checkResponse(response);
        if (completion.shouldExit) {
            stopIndex = i;
            stopSource = 'exit-detector';
            stopReason = completion.reason || '';
            break;
        }

        const loopCheck = testLoopDetector.analyzeResponse(response);
        if (loopCheck.shouldExit) {
            stopIndex = i;
            stopSource = 'test-loop-detector';
            stopReason = loopCheck.reason || '';
            break;
        }
    }

    return { stopIndex, stopSource, stopReason };
}

describe('Completion detection deterministic soak harness', () => {
    it('keeps false-complete rate at zero across replay corpus', () => {
        mockMaxConsecutiveTestLoops = 3;

        const scenarios = [
            {
                name: 'feature-heavy progression should not stop',
                expectedStop: false,
                steps: [
                    'Created new file parser.ts and implemented handlers',
                    'Updated docs and fixed validation issue',
                    'Refactored model selector fallback',
                    'Added tests for parser edge cases'
                ]
            },
            {
                name: 'mixed feature + tests should not stop prematurely',
                expectedStop: false,
                steps: [
                    'Implemented new command flow',
                    'Running tests now; all tests passed',
                    'Updated runtime telemetry with new reason fields',
                    'Running unit tests again after refactor',
                    'Fixed bug in command registration parity check'
                ]
            },
            {
                name: 'genuine completion phrase should stop',
                expectedStop: true,
                expectedSource: 'exit-detector',
                steps: [
                    'Implemented the final integration changes',
                    'All tasks completed successfully. Goal achieved.'
                ]
            },
            {
                name: 'persistent test-only loop should stop via loop detector',
                expectedStop: true,
                expectedSource: 'test-loop-detector',
                steps: [
                    'Running unit tests',
                    'All tests passed',
                    'npm test completed',
                    'test suite green across modules'
                ]
            },
            {
                name: 'partial completion should not stop',
                expectedStop: false,
                steps: [
                    'I have completed the backend implementation.',
                    'Now working on the frontend integration.',
                    'The backend is done, but the UI is pending.'
                ]
            },
            {
                name: 'future tense should not stop',
                expectedStop: false,
                steps: [
                    'I will mark this task as complete once the tests pass.',
                    'When everything is done, I will update the readme.',
                    'Going to verify if all tasks are complete.'
                ]
            },
            {
                name: 'checklist update with pending items should not stop',
                expectedStop: false,
                steps: [
                    '- [x] Task A (completed)',
                    '- [ ] Task B (pending)',
                    'Updated task.md to reflect progress.'
                ]
            },
            {
                name: 'hypothetical statement should not stop',
                expectedStop: false,
                steps: [
                    'If everything is complete, we can ship.',
                    'Check if all tasks are done.',
                    'Assuming implementation is complete, we proceed to verification.'
                ]
            },
            {
                name: 'negative confirmation should not stop',
                expectedStop: false,
                steps: [
                    'This is not complete yet.',
                    'The task is far from done.',
                    'We are not finished with the refactor.'
                ]
            }
        ];

        let falseCompletes = 0;
        let truePositiveStops = 0;

        for (const scenario of scenarios) {
            const result = evaluateScenario(scenario.steps);
            const didStop = result.stopIndex >= 0;

            if (!scenario.expectedStop && didStop) {
                falseCompletes++;
            }

            if (scenario.expectedStop && didStop) {
                truePositiveStops++;
                if (scenario.expectedSource) {
                    assert.strictEqual(
                        result.stopSource,
                        scenario.expectedSource,
                        `Scenario "${scenario.name}" stopped from unexpected source`
                    );
                }
            }

            if (scenario.expectedStop && !didStop) {
                assert.fail(`Expected stop was not triggered for scenario: ${scenario.name}`);
            }
        }

        assert.strictEqual(falseCompletes, 0, `False-complete stops observed: ${falseCompletes}`);
        assert.ok(truePositiveStops >= 2, `Expected at least 2 true-positive stops, got ${truePositiveStops}`);
    });
});
