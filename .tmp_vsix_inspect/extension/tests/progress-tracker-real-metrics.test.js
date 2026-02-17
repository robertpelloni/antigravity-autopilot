const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TRACKER_PATH = path.join(ROOT, 'src', 'core', 'progress-tracker.ts');

test('Progress tracker real metrics guards', async (t) => {
    const source = fs.readFileSync(TRACKER_PATH, 'utf-8');

    await t.test('uses git diff for filesChanged computation', () => {
        assert.ok(source.includes("git diff --name-only"));
    });

    await t.test('uses crypto hash instead of placeholder hash', () => {
        assert.ok(source.includes("createHash('sha256')"));
        assert.ok(!source.includes('dummy-hash'));
    });

    await t.test('tracks error taxonomy fields', () => {
        assert.ok(source.includes('errorTaxonomy'));
        assert.ok(source.includes('transport'));
        assert.ok(source.includes('parse'));
        assert.ok(source.includes('timeout'));
        assert.ok(source.includes('policy'));
        assert.ok(source.includes('unknown'));
    });
});
