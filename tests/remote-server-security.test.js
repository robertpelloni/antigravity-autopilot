const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readFile(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

test('Remote server enforces localhost default and host allowlist checks', () => {
    const serverSource = readFile('src/modules/remote/server.ts');

    assert.match(serverSource, /remoteControlAllowLan/, 'remote server should read remoteControlAllowLan setting');
    assert.match(serverSource, /remoteControlAllowedHosts/, 'remote server should read remoteControlAllowedHosts setting');
    assert.match(serverSource, /listen\(port, bindHost/, 'remote server should bind to computed host, not always 0.0.0.0');
    assert.match(serverSource, /Blocked HTTP remote client/, 'remote server should block disallowed HTTP clients');
    assert.match(serverSource, /Blocked WS remote client/, 'remote server should block disallowed WebSocket clients');
    assert.match(serverSource, /Remote access denied by host allowlist/, 'remote server should provide explicit deny reason');
});

test('Package manifest exposes remote LAN/allowlist security controls', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const props = pkg?.contributes?.configuration?.properties || {};

    assert.ok(props['antigravity.remoteControlAllowLan'], 'manifest should declare antigravity.remoteControlAllowLan');
    assert.ok(props['antigravity.remoteControlAllowedHosts'], 'manifest should declare antigravity.remoteControlAllowedHosts');

    assert.strictEqual(props['antigravity.remoteControlAllowLan'].default, false, 'LAN access should default to disabled');
    assert.ok(Array.isArray(props['antigravity.remoteControlAllowedHosts'].default), 'allowed hosts should default to an array');
    assert.ok(props['antigravity.remoteControlAllowedHosts'].default.includes('127.0.0.1'), 'allowed hosts should include loopback IP by default');
});
