const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');
const ts = require('typescript');

function createLoggerMock() {
    const noop = () => { };
    return { debug: noop, info: noop, warn: noop, error: noop };
}

function createResponse({ ok = true, status = 200, statusText = 'OK', body = [], headers = {} }) {
    return {
        ok,
        status,
        statusText,
        headers: {
            get: (key) => headers[String(key).toLowerCase()] ?? null
        },
        json: async () => body
    };
}

function loadTsModule(filePath, workspaceRoot, cache = new Map()) {
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
        if (request === 'vscode') {
            return {
                workspace: {
                    workspaceFolders: [{ uri: { fsPath: workspaceRoot } }]
                }
            };
        }

        if (request === '../utils/logger' || request.endsWith('/utils/logger')) {
            return { createLogger: () => createLoggerMock() };
        }

        if (request.startsWith('.')) {
            const base = path.resolve(path.dirname(absolutePath), request);
            const candidates = [`${base}.ts`, path.join(base, 'index.ts')];
            for (const candidate of candidates) {
                if (fs.existsSync(candidate)) {
                    return loadTsModule(candidate, workspaceRoot, cache);
                }
            }
        }

        return originalRequire(request);
    };

    mod._compile(transpiled, absolutePath);
    return mod.exports;
}

describe('ProjectManager GitHub integration hardening', () => {
    let tmpRoot;
    let originalFetch;
    let ProjectManager;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-pm-'));
        originalFetch = global.fetch;
        const moduleExports = loadTsModule(path.resolve(__dirname, '../src/providers/project-manager.ts'), tmpRoot);
        ProjectManager = moduleExports.ProjectManager;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('fetchGitHubIssues paginates across multiple pages and records sync snapshot', async () => {
        const manager = new ProjectManager();
        manager.config = {
            github: { owner: 'octo', repo: 'repo', token: 'token' }
        };

        let callCount = 0;
        global.fetch = async () => {
            callCount += 1;
            if (callCount === 1) {
                return createResponse({
                    body: [
                        { id: 1, number: 11, title: 'Issue 1', body: 'A', state: 'open', html_url: 'u1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', assignee: null },
                        { id: 2, number: 12, title: 'PR masquerade', body: 'B', state: 'open', html_url: 'u2', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', assignee: null, pull_request: { url: 'x' } }
                    ],
                    headers: {
                        link: '<https://api.github.com/repos/octo/repo/issues?state=all&per_page=100&page=2>; rel="next"'
                    }
                });
            }

            return createResponse({
                body: [
                    { id: 3, number: 13, title: 'Issue 2', body: 'C', state: 'closed', html_url: 'u3', created_at: '2025-01-02T00:00:00Z', updated_at: '2025-01-02T00:00:00Z', assignee: { login: 'dev' } }
                ]
            });
        };

        const issues = await manager.fetchGitHubIssues();
        assert.strictEqual(issues.length, 2);
        assert.deepStrictEqual(issues.map((i) => i.key), ['#11', '#13']);

        const snapshot = manager.getLastSyncSnapshot();
        assert.ok(snapshot);
        assert.strictEqual(snapshot.pagesFetched, 2);
        assert.strictEqual(snapshot.totalItems, 2);
        assert.strictEqual(snapshot.rateLimited, false);
    });

    it('fetchGitHubIssues captures rate-limit metadata and returns empty list', async () => {
        const manager = new ProjectManager();
        manager.config = {
            github: { owner: 'octo', repo: 'repo', token: 'token' }
        };

        global.fetch = async () => createResponse({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            headers: {
                'x-ratelimit-remaining': '0',
                'retry-after': '60'
            }
        });

        const issues = await manager.fetchGitHubIssues();
        assert.deepStrictEqual(issues, []);

        const snapshot = manager.getLastSyncSnapshot();
        assert.ok(snapshot);
        assert.strictEqual(snapshot.rateLimited, true);
        assert.strictEqual(snapshot.retryAfterSec, 60);
        assert.ok(String(snapshot.error || '').includes('rate limit'));
    });
});
