const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GENERATOR_PATH = path.join(ROOT, 'src', 'core', 'test-generator.ts');

test('Test generator quality guards', async (t) => {
    const source = fs.readFileSync(GENERATOR_PATH, 'utf-8');

    await t.test('removes placeholder pass-through assertions', () => {
        assert.ok(!source.includes('expect(true).toBe(true); // Placeholder'));
    });

    await t.test('supports merge-safe generated block markers', () => {
        assert.ok(source.includes('antigravity-generated-tests:start'));
        assert.ok(source.includes('antigravity-generated-tests:end'));
    });

    await t.test('uses deterministic mirrored test paths under configured test directory', () => {
        assert.ok(source.includes('path.relative(this.workspaceRoot, resolvedSource)'));
        assert.ok(source.includes("return path.join(this.config.testDirectory, `${withoutExt}.test${ext}`);"));
    });

    await t.test('uses AST-backed document symbol extraction before regex fallback', () => {
        assert.ok(source.includes("vscode.executeDocumentSymbolProvider"));
        assert.ok(source.includes('extractFunctionsRegex(content)'));
        assert.ok(source.includes('extractClassesRegex(content)'));
    });
});
