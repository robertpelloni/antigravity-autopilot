const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CDP_SCRIPT_PATH = path.join(ROOT, 'main_scripts', 'full_cdp_script.js');

function readScript() {
    return fs.readFileSync(CDP_SCRIPT_PATH, 'utf-8');
}

test('Injected automation excludes workbench chrome/tab controls from click targets', async (t) => {
    const script = readScript();

    await t.test('isValidInteractionTarget excludes role tab/tablist surfaces', () => {
        assert.match(script, /current\.getAttribute\('role'\)\s*===\s*'tab'/);
        assert.match(script, /current\.getAttribute\('role'\)\s*===\s*'tablist'/);
    });

    await t.test('isValidInteractionTarget excludes panel/chrome containers', () => {
        assert.match(script, /\.pane-header/);
        assert.match(script, /\.panel-header/);
        assert.match(script, /\.view-pane-header/);
        assert.match(script, /\.tabs-and-actions-container/);
        assert.match(script, /\.part\.activitybar/);
        assert.match(script, /\.part\.statusbar/);
        assert.match(script, /\.part\.titlebar/);
    });
});

test('Default click-action patterns avoid broad run token and keep explicit run intents', async (t) => {
    const script = readScript();

    const defaultPatternsMatch = script.match(/const\s+defaultPatterns\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(defaultPatternsMatch, 'defaultPatterns array should exist in full_cdp_script.js');

    const rawList = defaultPatternsMatch[1];

    await t.test('does not include broad standalone run token', () => {
        assert.ok(!/'run'\s*,/.test(rawList), 'defaultPatterns should not include broad "run" token');
    });

    await t.test('includes explicit run intent patterns', () => {
        assert.ok(/'run in terminal'/.test(rawList), 'defaultPatterns should include "run in terminal"');
        assert.ok(/'run command'/.test(rawList), 'defaultPatterns should include "run command"');
        assert.ok(/'execute command'/.test(rawList), 'defaultPatterns should include "execute command"');
    });
});

test('Submit keyboard fallback blocks Alt+Enter and keeps safe input targeting', () => {
    const script = readScript();

    const submitWithKeysBlock = script.match(/async function submitWithKeys\([\s\S]*?return false;[\r\n]+\s*}/);
    assert.ok(submitWithKeysBlock, 'submitWithKeys function should exist');

    const submitWithKeysSource = submitWithKeysBlock[0];
    assert.ok(!/altKey:\s*true/.test(submitWithKeysSource), 'submitWithKeys must not include Alt+Enter combo');
});

test('Antigravity profile avoids broad selectors that can hit workbench chrome', () => {
    const script = readScript();

    const antigravityStart = script.indexOf('antigravity: {');
    const cursorStart = script.indexOf('cursor: {', antigravityStart);
    assert.ok(antigravityStart >= 0 && cursorStart > antigravityStart, 'antigravity selector block should exist');
    const antigravityBlock = script.slice(antigravityStart, cursorStart);

    assert.ok(!/\bbutton\.grow\b/.test(antigravityBlock), 'antigravity click selectors must not include button.grow');
    assert.ok(!/'button'\s*,/.test(antigravityBlock), 'antigravity click selectors must not include broad button selector');
    assert.ok(!/'\[role="button"\]'\s*,/.test(antigravityBlock), 'antigravity click selectors must not include broad role=button selector');
    assert.ok(!/aria-label\*="run"/i.test(antigravityBlock), 'antigravity send selectors must not include run-labeled button selectors');

    assert.ok(/mode === 'antigravity' && category === 'click'/.test(script), 'mergeSelectorSets should harden antigravity click selector merging');
    assert.ok(!/queryAll\('button\.grow'\)/.test(script), 'antigravity loop tab detection must not query button.grow directly');
});

test('Auto-continue submit uses safe chat input helper', () => {
    const autoContinuePath = path.join(ROOT, 'src', 'scripts', 'auto-continue.ts');
    const autoContinue = fs.readFileSync(autoContinuePath, 'utf-8');

    assert.match(autoContinue, /function getSafeChatInput\(\)/, 'auto-continue should define getSafeChatInput helper');
    assert.match(autoContinue, /const input = getSafeChatInput\(\);/, 'submit path should use getSafeChatInput instead of broad document.querySelector');
    assert.match(autoContinue, /Composer is empty\. Suppressing submit key dispatch\./, 'submit path should suppress empty composer Enter dispatches');
    assert.ok(!/actionMethods:\s*\['dom-click',\s*'native-click',\s*'alt-enter'\]/.test(autoContinue), 'run/expand defaults must not include alt-enter fallback');
    assert.ok(!/text === 'run'\s*\|\|\s*label === 'run'/.test(autoContinue), 'run matching must not allow bare "run" labels');
    assert.match(autoContinue, /\[role="menuitem"\]/, 'unsafe context guard should block menuitem surfaces');
});

test('CDP bridge blocks unsafe global Enter relay for submit keys', () => {
    const cdpHandlerPath = path.join(ROOT, 'src', 'services', 'cdp', 'cdp-handler.ts');
    const cdpHandler = fs.readFileSync(cdpHandlerPath, 'utf-8');

    assert.match(cdpHandler, /Blocked unsafe CDP Enter relay for submit\|keys/, 'cdp-handler should explicitly block submit|keys Enter relay');
    assert.ok(!/Fallback CDP Enter Key/.test(cdpHandler), 'cdp-handler should not use global Fallback CDP Enter Key');
});
