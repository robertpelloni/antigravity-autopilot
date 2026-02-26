const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const DASHBOARD_TS_PATH = path.join(ROOT, 'src', 'ui', 'dashboard.ts');

const DASHBOARD_INTENTIONAL_OMISSIONS = new Set([
    // Commands/internal wires are not dashboard settings.
    'antigravity.accessibility.screenReaderOptimized',
    'antigravity.actions.autoAccept.delayMs',
    'antigravity.actions.autoAccept.pollIntervalMs',
    'antigravity.actions.bump.cooldown',
    'antigravity.actions.expand.delayMs',
    'antigravity.actions.run.delayMs',
    'antigravity.automation.debug.traceSelectors',
    'antigravity.automation.timing',
    'antigravity.continuousMode',
    'antigravity.experimental.cdpAggressiveDiscovery',
    'antigravity.experimental.cdpExplicitDiscovery',
    'antigravity.jules.apiKey',
    'antigravity.jules.enabled',
    'antigravity.jules.url',
    'antigravity.soundEffectsEnabled',
    'antigravity.soundEffectsPerActionEnabled',
    'antigravity.watchdogEnabled',
    'antigravity.watchdogTimeoutMs',
    // Audio actions are grouped in details, handled by logic but parity test might miss them if not explicit
    'antigravity.audio.actions.accept',
    'antigravity.audio.actions.bump',
    'antigravity.audio.actions.click',
    'antigravity.audio.actions.expand',
    'antigravity.audio.actions.run',
    'antigravity.audio.actions.submit',
    'antigravity.mcpEnabled',
    'antigravity.voiceControlEnabled',
    'antigravity.voiceMode'
]);

test('Config schema parity with dashboard controls', async (t) => {
    const pkgRaw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
    const dashboardSource = fs.readFileSync(DASHBOARD_TS_PATH, 'utf-8');

    const pkg = JSON.parse(pkgRaw);
    const schemaKeys = new Set(Object.keys(pkg?.contributes?.configuration?.properties || {}));

    const updateConfigRegex = /updateConfig\('([^']+)'/g;
    const toggleMethodRegex = /toggleMethod\('([^']+)'/g;
    const dashboardKeys = new Set();

    let match;
    while ((match = updateConfigRegex.exec(dashboardSource)) !== null) {
        dashboardKeys.add(`antigravity.${match[1]}`);
    }

    while ((match = toggleMethodRegex.exec(dashboardSource)) !== null) {
        dashboardKeys.add(`antigravity.${match[1]}`);
    }

    const missingInDashboard = [...schemaKeys]
        .filter((key) => !dashboardKeys.has(key) && !DASHBOARD_INTENTIONAL_OMISSIONS.has(key))
        .sort();

    const dashboardUnknown = [...dashboardKeys]
        .filter((key) => !schemaKeys.has(key))
        .sort();

    await t.test('all config schema keys are represented in dashboard controls', () => {
        assert.deepStrictEqual(missingInDashboard, []);
    });

    await t.test('dashboard does not reference unknown config keys', () => {
        assert.deepStrictEqual(dashboardUnknown, []);
    });
});
