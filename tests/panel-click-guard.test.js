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
        assert.match(script, /role\s*=\s*\(el\.getAttribute[^\n]*\|\|\s*''\)\.toLowerCase\(\)/);
        assert.match(script, /role\s*===\s*'tab'\s*\|\|\s*el\.closest\('\[role="tablist"\]'\)/);
    });

    await t.test('isValidInteractionTarget excludes panel/chrome containers', () => {
        assert.match(script, /\.pane-header/);
        assert.match(script, /\.panel-header/);
        assert.match(script, /\.view-pane-header/);
        assert.match(script, /\.tabs-and-actions-container/);
        assert.match(script, /\.part\.activitybar/);
        assert.match(script, /\.part\.statusbar/);
        assert.match(script, /\.part\.sidebar/);
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
