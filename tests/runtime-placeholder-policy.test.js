const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const RUNTIME_POLICY_FILES = [
    'src/modules/mcp/server.ts',
    'src/modules/mcp/federation.ts',
    'src/core/autonomous-loop.ts',
    'src/extension.ts',
];

const FORBIDDEN_PATTERNS = [
    /simulated\s+(startup|connect|connection|server|tool-call|flow)/i,
    /dummy-hash/i,
    /ws:\/\/localhost:9222/i,
    /placeholder\s*(server|value|state|return|response)/i,
];

test('Active runtime files do not contain known placeholder/simulated anti-patterns', async (t) => {
    const violations = [];

    for (const relativePath of RUNTIME_POLICY_FILES) {
        const absolutePath = path.join(ROOT, relativePath);
        const source = fs.readFileSync(absolutePath, 'utf-8');

        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(source)) {
                violations.push({
                    file: relativePath,
                    pattern: pattern.toString(),
                });
            }
        }
    }

    await t.test('no forbidden placeholder/simulated patterns are present', () => {
        assert.deepStrictEqual(violations, []);
    });
});
