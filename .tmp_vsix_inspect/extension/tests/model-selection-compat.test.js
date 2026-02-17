const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONSTANTS_PATH = path.join(ROOT, 'src', 'utils', 'constants.ts');
const MODEL_SELECTOR_PATH = path.join(ROOT, 'src', 'core', 'model-selector.ts');

test('Model selection compatibility guards', async (t) => {
    const constantsSource = fs.readFileSync(CONSTANTS_PATH, 'utf-8');
    const selectorSource = fs.readFileSync(MODEL_SELECTOR_PATH, 'utf-8');

    await t.test('canonical Claude model IDs use dotted version format', () => {
        assert.ok(constantsSource.includes("CLAUDE_SONNET: 'claude-sonnet-4.5'"));
        assert.ok(constantsSource.includes("CLAUDE_SONNET_THINKING: 'claude-sonnet-4.5-thinking'"));
        assert.ok(constantsSource.includes("CLAUDE_OPUS_THINKING: 'claude-opus-4.5-thinking'"));
    });

    await t.test('quick-task typo route guard is fixed', () => {
        assert.ok(!selectorSource.includes('brieft'));
    });

    await t.test('legacy dashed aliases remain supported for backwards compatibility', () => {
        assert.ok(selectorSource.includes("'claude-sonnet-4-5'"));
        assert.ok(selectorSource.includes("'claude-sonnet-4-5-thinking'"));
        assert.ok(selectorSource.includes("'claude-opus-4-5-thinking'"));
    });
});
