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
    assert.ok(!/getUnifiedClickSelectors\('vscode'\),\s*\.\.\.getUnifiedClickSelectors\('antigravity'\),\s*\.\.\.getUnifiedClickSelectors\('cursor'\)/.test(script), 'performClick fallback should not merge cross-profile selectors');
    assert.match(script, /\[role="menuitem"\]/, 'isValidInteractionTarget should block menuitem surfaces');
});

test('Auto-continue submit uses safe chat input helper', () => {
    const autoContinuePath = path.join(ROOT, 'src', 'scripts', 'auto-continue.ts');
    const autoContinue = fs.readFileSync(autoContinuePath, 'utf-8');

    assert.match(autoContinue, /function getSafeChatInput\(\)/, 'auto-continue should define getSafeChatInput helper');
    assert.match(autoContinue, /const input = getSafeChatInput\(\);/, 'submit path should use getSafeChatInput instead of broad document.querySelector');
    assert.match(autoContinue, /Composer is empty\. Suppressing submit key dispatch\./, 'submit path should suppress empty composer Enter dispatches');
    assert.ok(!/actionMethods:\s*\['dom-click',\s*'native-click',\s*'alt-enter'\]/.test(autoContinue), 'run/expand defaults must not include alt-enter fallback');
    assert.ok(!/text === 'run'\s*\|\|\s*label === 'run'/.test(autoContinue), 'run matching must not allow bare "run" labels');
    assert.ok(!/\.codicon-play|\.codicon-run/.test(autoContinue.match(/const runSelectors = \[[\s\S]*?\]\.join\(','\);/)?.[0] || ''), 'run selectors must not include broad run icon classes');
    assert.match(autoContinue, /\[role="menuitem"\]/, 'unsafe context guard should block menuitem surfaces');
    assert.match(autoContinue, /function isChatActionSurface\(el\)/, 'auto-continue should define chat-surface gate helper');
    assert.match(autoContinue, /function isAntigravityRuntime\(\)/, 'auto-continue should define antigravity runtime detector');
    assert.match(autoContinue, /isChatActionSurface\(textMatch\)/, 'run/expand text matches should require chat-surface gating');
    assert.match(autoContinue, /Scoped Selector Match/, 'run/expand selector clicks should use scoped selector flow');
    assert.match(autoContinue, /Blocked non-chat click target/, 'tryClick should log blocked non-chat click targets');
    assert.match(autoContinue, /!isChatActionSurface\(targetToClick\)/, 'tryClick should fail-closed when target is not chat-surface');
    assert.match(autoContinue, /controlName === 'run' \|\| controlName === 'expand'\) && isAntigravityRuntime\(\)/, 'run/expand should be disabled in antigravity runtime');
    assert.match(autoContinue, /AG runtime: enter-key submit fallback disabled for safety\./, 'enter-key fallback should be disabled in antigravity runtime');
    assert.match(autoContinue, /AG runtime: typeAndSubmit enter-key fallback disabled for safety\./, 'typeAndSubmit enter-key fallback should be disabled in antigravity runtime');
    assert.match(autoContinue, /AG runtime: suppressed keys-fallback dispatch in typeAndSubmit\./, 'typeAndSubmit keys fallback should be suppressed in antigravity runtime');
    assert.match(autoContinue, /function getSafetyStats\(\)/, 'auto-continue should define safety stats helper');
    assert.match(autoContinue, /safetyStats: getSafetyStats\(\)/, 'analyzeChatState should expose safetyStats payload');
    assert.match(autoContinue, /blockedRunExpandInAgRuntime/, 'auto-continue should track AG run/expand gate blocks');
    assert.match(autoContinue, /blockedSubmitKeyDispatches/, 'auto-continue should track blocked submit key dispatches');
});

test('Injected click classifier rejects broad generic run labels', () => {
    const script = readScript();

    assert.match(script, /text === 'run'\s*\|\|\s*text === 'execute'/, 'isAcceptButton should reject bare run/execute labels');
    assert.match(script, /text\.includes\('run'\)\s*&&\s*!text\.includes\('run in terminal'\)/, 'isAcceptButton should allow only explicit run intent variants');
    assert.match(script, /function isChatActionSurface\(el\)/, 'injected script should define chat-surface gate helper');
    assert.match(script, /if \(!isChatActionSurface\(el\)\)/, 'performClick should skip non-chat action surfaces');
    assert.match(script, /AG mode: blocked forceAction\(\$\{action\}\) for safety\./, 'forceAction should hard-block run/expand in AG mode');
    assert.match(script, /AG mode: expansion pass disabled for safety\./, 'expand pre-pass should be disabled in AG mode');
    assert.ok(!/triggerKeypressFallback\(el\)/.test(script), 'stuck guard should not invoke undefined keypress fallback handler');
    assert.match(script, /function getSafetyCounters\(\)/, 'injected runtime should define safety counters helper');
    assert.match(script, /safetyCounters,/, 'runtime snapshot should expose safetyCounters');
    assert.match(script, /blockedUnsafeActionsTotal/, 'runtime snapshot should expose blocked unsafe action aggregate');
});

test('CDP bridge blocks unsafe global Enter relay for submit keys', () => {
    const cdpHandlerPath = path.join(ROOT, 'src', 'services', 'cdp', 'cdp-handler.ts');
    const cdpHandler = fs.readFileSync(cdpHandlerPath, 'utf-8');

    assert.match(cdpHandler, /Blocked unsafe CDP Enter relay for submit\|keys/, 'cdp-handler should explicitly block submit|keys Enter relay');
    assert.ok(!/Fallback CDP Enter Key/.test(cdpHandler), 'cdp-handler should not use global Fallback CDP Enter Key');
});
