const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(ROOT, 'package.json');
const EXTENSION_TS_PATH = path.join(ROOT, 'src', 'extension.ts');

const INTERNAL_ONLY_COMMANDS = new Set([
    'antigravity.getChromeDevtoolsMcpUrl',
    'antigravity.clearAutoAll',
    'antigravity.writeAndSubmitBump'
]);

test('Command manifest parity', async (t) => {
    const pkgRaw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    const manifestCommands = new Set(
        (pkg?.contributes?.commands || [])
            .map(cmd => cmd?.command)
            .filter(Boolean)
    );

    const extensionSource = fs.readFileSync(EXTENSION_TS_PATH, 'utf-8');
    const registerRegex = /(?:vscode\.commands\.registerCommand|safeRegisterCommand)\(\s*['"]([^'"]+)['"]/g;
    const registeredCommands = new Set();

    let match;
    while ((match = registerRegex.exec(extensionSource)) !== null) {
        registeredCommands.add(match[1]);
    }

    const missingHandlers = [...manifestCommands].filter(cmd => !registeredCommands.has(cmd));
    const unexpectedRegistered = [...registeredCommands].filter(
        cmd => !manifestCommands.has(cmd) && !INTERNAL_ONLY_COMMANDS.has(cmd)
    );
    const missingInternal = [...INTERNAL_ONLY_COMMANDS].filter(cmd => !registeredCommands.has(cmd));

    await t.test('all contributed commands have handlers', () => {
        assert.deepStrictEqual(missingHandlers, []);
    });

    await t.test('registered commands are either contributed or explicitly internal', () => {
        assert.deepStrictEqual(unexpectedRegistered, []);
    });

    await t.test('internal allowlist commands remain registered', () => {
        assert.deepStrictEqual(missingInternal, []);
    });
});
