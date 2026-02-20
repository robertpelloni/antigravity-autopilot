
const { describe, it } = require('node:test');



const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

function loadTsModule(filePath, cache = new Map()) {
    const absolutePath = path.resolve(filePath);
    if (cache.has(absolutePath)) {
        return cache.get(absolutePath).exports;
    }

    const source = fs.readFileSync(absolutePath, 'utf-8');
    const transpiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        },
        fileName: absolutePath
    }).outputText;

    const mod = new Module(absolutePath, module);
    cache.set(absolutePath, mod);
    mod.filename = absolutePath;
    mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

    const originalRequire = mod.require.bind(mod);
    mod.require = (request) => {
        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, cache);
                }
            }
        }
        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

const { ControllerLease } = loadTsModule(path.resolve(__dirname, '../src/core/controller-lease.ts'));

describe('ControllerLease coordination', () => {
    it('acquires leadership when lease is empty', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-controller-lease-'));
        const leasePath = path.join(tempRoot, 'lease.json');

        const lease = new ControllerLease('owner-a', 'ws-a', {
            leasePath,
            staleMs: 10_000,
            heartbeatMs: 60_000
        });

        const acquired = lease.tryAcquire();
        assert.strictEqual(acquired, true);
        assert.strictEqual(lease.isLeader(), true);

        const payload = JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
        assert.strictEqual(payload.ownerId, 'owner-a');
        assert.strictEqual(payload.workspace, 'ws-a');

        lease.stop();
    });

    it('prevents takeover while a fresh leader lease exists', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-controller-lease-'));
        const leasePath = path.join(tempRoot, 'lease.json');

        const leader = new ControllerLease('owner-leader', 'ws-main', {
            leasePath,
            staleMs: 30_000,
            heartbeatMs: 60_000
        });
        assert.strictEqual(leader.tryAcquire(), true);

        const follower = new ControllerLease('owner-follower', 'ws-secondary', {
            leasePath,
            staleMs: 30_000,
            heartbeatMs: 60_000
        });

        assert.strictEqual(follower.tryAcquire(), false);
        assert.strictEqual(follower.isLeader(), false);

        const leaderInfo = follower.getLeaderInfo();
        assert.ok(leaderInfo);
        assert.strictEqual(leaderInfo.ownerId, 'owner-leader');

        follower.stop();
        leader.stop();
    });

    it('allows takeover when existing lease is stale', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-controller-lease-'));
        const leasePath = path.join(tempRoot, 'lease.json');

        const now = Date.now();
        const stalePayload = {
            ownerId: 'owner-old',
            pid: 99999,
            workspace: 'ws-old',
            createdAt: now - 120_000,
            updatedAt: now - 120_000
        };
        fs.writeFileSync(leasePath, JSON.stringify(stalePayload, null, 2), 'utf-8');

        const contender = new ControllerLease('owner-new', 'ws-new', {
            leasePath,
            staleMs: 5_000,
            heartbeatMs: 60_000
        });

        assert.strictEqual(contender.tryAcquire(), true);
        assert.strictEqual(contender.isLeader(), true);

        const payload = JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
        assert.strictEqual(payload.ownerId, 'owner-new');
        assert.strictEqual(payload.workspace, 'ws-new');

        contender.stop();
    });

    it('removes lease file only when stopping owner instance', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-controller-lease-'));
        const leasePath = path.join(tempRoot, 'lease.json');

        const owner = new ControllerLease('owner-main', 'ws-main', {
            leasePath,
            staleMs: 30_000,
            heartbeatMs: 60_000
        });
        assert.strictEqual(owner.tryAcquire(), true);
        assert.strictEqual(fs.existsSync(leasePath), true);

        const nonOwner = new ControllerLease('owner-other', 'ws-other', {
            leasePath,
            staleMs: 30_000,
            heartbeatMs: 60_000
        });
        nonOwner.stop();
        assert.strictEqual(fs.existsSync(leasePath), true);

        owner.stop();
        assert.strictEqual(fs.existsSync(leasePath), false);
    });
});
