const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRAPER_PATH = path.join(ROOT, 'src', 'core', 'model-scraper.ts');

test('Model scraper reliability guards', async (t) => {
    const source = fs.readFileSync(SCRAPER_PATH, 'utf-8');

    await t.test('does not use asynchronous setTimeout inside injected evaluate script', () => {
        assert.ok(!source.includes('setTimeout(() => {'));
    });

    await t.test('uses bounded retry attempts for deterministic scraping retries', () => {
        assert.ok(source.includes('MODEL_SCRAPE_ATTEMPTS'));
        assert.ok(source.includes('for (let attempt = 1; attempt <= MODEL_SCRAPE_ATTEMPTS; attempt++)'));
    });

    await t.test('includes retry delay between scrape attempts', () => {
        assert.ok(source.includes('MODEL_SCRAPE_RETRY_DELAY_MS'));
        assert.ok(source.includes('await new Promise(resolve => setTimeout(resolve, MODEL_SCRAPE_RETRY_DELAY_MS));'));
    });
});
