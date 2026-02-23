const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXTENSION_TS_PATH = path.join(ROOT, 'src', 'extension.ts');

function readExtensionSource() {
    return fs.readFileSync(EXTENSION_TS_PATH, 'utf-8');
}

test('Runtime safety telemetry is surfaced in status/diagnostics paths', async (t) => {
    const source = readExtensionSource();

    await t.test('extension defines safety telemetry summary helper', () => {
        assert.match(source, /const getSafetyTelemetrySummary = \(state\?: any\) =>/, 'extension should define reusable safety telemetry summary helper');
        assert.match(source, /const signal = total >= 10 \? 'HOT' : total > 0 \? 'ACTIVE' : 'QUIET';/, 'helper should classify safety signal severity from blocked totals');
    });

    await t.test('status menu includes safety line item', () => {
        assert.match(source, /label: '\$\(shield\) Safety: ' \+ safety\.signal/, 'status menu should show safety signal item');
        assert.match(source, /blocked=\$\{safety\.total\}/, 'status menu should show blocked safety totals');
    });

    await t.test('runtime check summary includes safety signal and count', () => {
        assert.match(source, /const safety = getSafetyTelemetrySummary\(state\);/, 'runtime check command should read safety telemetry');
        assert.match(source, /safety=\$\{safety\.signal\} blocked=\$\{safety\.total\}/, 'runtime check logs should include safety details');
        assert.match(source, /\| safety: \$\{safety\.signal\} \(\$\{safety\.total\}\)/, 'runtime check info message should include safety details');
    });

    await t.test('diagnostics payloads include safety telemetry object', () => {
        assert.match(source, /const buildLastResumePayloadReport = \(state\?: any\) =>[\s\S]*?safety,/, 'last resume payload report should include safety telemetry');
        assert.match(source, /const buildEscalationDiagnosticsReport = \(state\?: any\) =>[\s\S]*?safety,/, 'escalation diagnostics report should include safety telemetry');
    });
});
