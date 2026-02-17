const assert = require('assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const Module = require('module');

function loadTsModule(filePath) {
    const absolutePath = path.resolve(filePath);
    const source = fs.readFileSync(absolutePath, 'utf-8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true,
        },
        fileName: absolutePath,
    }).outputText;

    const mod = new Module(absolutePath, module);
    mod.filename = absolutePath;
    mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

const { calculateAdaptiveBackoff } = loadTsModule(path.join(__dirname, '..', 'src', 'core', 'backoff.ts'));

test('Adaptive Backoff Logic', async (t) => {
    const baseInterval = 30;
    const maxMinutes = 5;

    await t.test('should return base interval for 0 failures', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 0, maxMinutes);
        assert.strictEqual(result, 30);
    });

    await t.test('should double interval for 1 failure', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 1, maxMinutes);
        assert.strictEqual(result, 60);
    });

    await t.test('should be 4x for 2 failures', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 2, maxMinutes);
        assert.strictEqual(result, 120);
    });

    await t.test('should cap exponent at 6 failures (64x)', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 6, 100); // High max to test exponent cap
        assert.strictEqual(result, 30 * 64); // 1920
    });

    await t.test('should not exceed maxMinutes (hard cap)', () => {
        const result = calculateAdaptiveBackoff(baseInterval, 10, 5); // 5 mins = 300s
        assert.strictEqual(result, 300);
    });
});
