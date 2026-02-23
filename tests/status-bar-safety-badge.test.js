const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATUS_BAR_TS_PATH = path.join(ROOT, 'src', 'ui', 'status-bar.ts');

function readStatusBarSource() {
    return fs.readFileSync(STATUS_BAR_TS_PATH, 'utf-8');
}

test('Status bar surfaces runtime safety badge and tooltip', async (t) => {
    const source = readStatusBarSource();

    await t.test('status bar stores safety label and tooltip state', () => {
        assert.match(source, /private runtimeSafetyLabel: string \| null = null;/, 'status bar should track runtime safety label');
        assert.match(source, /private runtimeSafetyTooltip: string \| null = null;/, 'status bar should track runtime safety tooltip');
    });

    await t.test('status text includes safety badge in runtime suffix', () => {
        assert.match(source, /const runtimeParts = \[this\.runtimeStateLabel, this\.runtimeSafetyLabel\]\.filter\(Boolean\);/, 'status text should join runtime and safety labels');
        assert.match(source, /runtimeParts\.join\(' '\)/, 'status suffix should include compact safety badge text');
    });

    await t.test('runtime updater computes safety signal from counters', () => {
        assert.match(source, /const blockedTotal = Math\.max\(this\.toCounter\(runtimeState\.blockedUnsafeActionsTotal\), computedTotal\);/, 'status bar should use explicit blocked total with computed fallback');
        assert.match(source, /const signal = blockedTotal >= 10 \? 'HOT' : blockedTotal > 0 \? 'ACTIVE' : 'QUIET';/, 'status bar should classify safety signal using blocked thresholds');
        assert.match(source, /this\.runtimeSafetyLabel = `SAFE:\$\{signal\}`;/, 'status bar should expose compact safety badge label');
        assert.match(source, /this\.runtimeSafetyTooltip = `Safety \$\{signal\} \| blocked=\$\{blockedTotal\}/, 'status bar tooltip should include blocked totals and breakdown');
    });
});
