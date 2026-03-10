const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AUTO_CONTINUE_PATH = path.join(ROOT, 'src', 'scripts', 'auto-continue.ts');
const CDP_HANDLER_PATH = path.join(ROOT, 'src', 'services', 'cdp', 'cdp-handler.ts');

function read(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}

test('auto-continue runtime uses fork-aware waiting signals and avoids local focus-stealing bump typing', () => {
    const source = read(AUTO_CONTINUE_PATH);

    assert.match(source, /function detectFork\(\)/, 'runtime should detect host fork on load');
    assert.match(source, /hasThumbsStopSignal/, 'runtime state should expose thumbs stop signal');
    assert.match(source, /thumbsSignal\(fork\)/, 'runtime should use thumbs up\/down for stopped-chat detection');
    assert.match(source, /if \(fork === 'vscode'\)/, 'runtime should use a dedicated VS Code waiting branch');
    assert.match(source, /if \(fork === 'cursor'\)/, 'runtime should keep a separate cursor waiting branch');
    assert.match(source, /actions\.indexOf\('clickExpand'\)/, 'runtime should use explicit Antigravity action buttons for waiting detection');
    assert.ok(!/el\.focus\(\{preventScroll:true\}\)/.test(source), 'runtime button clicking must not explicitly focus controls');
    assert.ok(!/function typeBumpDom\(/.test(source), 'runtime should not DOM-type bump text locally');
    assert.ok(!/emit\('__AUTOPILOT_HYBRID_BUMP__:' \+ bumpText\)/.test(source), 'runtime should not emit local hybrid bump requests directly');
});

test('VS Code runtime does not look for Antigravity-style action labels', () => {
    const source = read(AUTO_CONTINUE_PATH);

    const vscodeProfile = source.match(/vscode:\s*\{[\s\S]*?actionAllow:\s*\{([\s\S]*?)\}\s*\}/);
    assert.ok(vscodeProfile, 'vscode fork profile should exist');

    assert.match(vscodeProfile[1], /clickKeep: true/, 'vscode should still allow Keep');
    assert.match(vscodeProfile[1], /clickAllow: true/, 'vscode should still allow Allow');
    assert.match(vscodeProfile[1], /clickAlwaysAllow: true/, 'vscode should still allow Always Allow');
    assert.ok(!/clickProceed: true/.test(vscodeProfile[1]), 'vscode should not look for Proceed');
    assert.ok(!/clickRetry: true/.test(vscodeProfile[1]), 'vscode should not look for Retry');
    assert.ok(!/clickAcceptAll: true/.test(vscodeProfile[1]), 'vscode should not look for Accept all');
    assert.ok(!/clickExpand: true/.test(vscodeProfile[1]), 'vscode should not look for Expand');
    assert.ok(!/clickRun: true/.test(vscodeProfile[1]), 'vscode should not look for Run by default in the passive runtime');
});

test('cdp handler provides calmer default action throttle', () => {
    const source = read(CDP_HANDLER_PATH);
    assert.match(source, /actionThrottleMs: Math\.max\(1500, config\.get<number>\('automation\.timing\.actionThrottleMs'\) \|\| 2500\)/, 'host config should default action throttling to multi-second cadence');
});
