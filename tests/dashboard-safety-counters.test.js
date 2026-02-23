const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_TS_PATH = path.join(ROOT, 'src', 'ui', 'dashboard.ts');

function readDashboardSource() {
    return fs.readFileSync(DASHBOARD_TS_PATH, 'utf-8');
}

test('Dashboard runtime card surfaces safety counter telemetry', async (t) => {
    const source = readDashboardSource();

    await t.test('runtime grid includes safety counter fields', () => {
        assert.match(source, /id="runtimeBlockedUnsafeTotal"/, 'runtime card should include blocked unsafe total field');
        assert.match(source, /id="runtimeSafetySignal"/, 'runtime card should include safety signal chip');
        assert.match(source, /id="runtimeSafetyBlockedRunExpand"/, 'runtime card should include run/expand blocked counter');
        assert.match(source, /id="runtimeSafetyBlockedNonChat"/, 'runtime card should include non-chat blocked counter');
        assert.match(source, /id="runtimeSafetyBlockedSubmitKeys"/, 'runtime card should include submit-key blocked counter');
        assert.match(source, /id="runtimeSafetyBlockedFocusLoss"/, 'runtime card should include focus-loss blocked counter');
    });

    await t.test('runtime updater computes safety counter aggregate and severity chip', () => {
        assert.match(source, /const safetyCounters = \(state\.safetyCounters/, 'runtime updater should read injected runtime safetyCounters');
        assert.match(source, /const safetyStats = \(state\.safetyStats/, 'runtime updater should read host/runtime safetyStats');
        assert.match(source, /blockedUnsafeTotalComputed/, 'runtime updater should compute fallback aggregate total');
        assert.match(source, /Math\.max\(toCounter\(state\.blockedUnsafeActionsTotal\), blockedUnsafeTotalComputed\)/, 'runtime updater should prefer explicit total while preserving computed fallback');
        assert.match(source, /blockedUnsafeTotal >= 10/, 'runtime updater should set HOT threshold for high suppression spikes');
        assert.match(source, /safetySignal\.textContent = 'ACTIVE'/, 'runtime updater should label non-zero counters as ACTIVE');
        assert.match(source, /safetySignal\.textContent = 'QUIET'/, 'runtime updater should label zero counters as QUIET');
    });
});
