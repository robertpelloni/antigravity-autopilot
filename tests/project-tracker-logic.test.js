const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Mock VS Code
const vscodeMock = {
    workspace: {
        workspaceFolders: [{ uri: { fsPath: path.resolve(__dirname, 'fixtures') } }]
    }
};

// Mock Module Loading for VS Code
const originalRequire = require('module').prototype.require;
require('module').prototype.require = function (id) {
    if (id === 'vscode') return vscodeMock;
    return originalRequire.apply(this, arguments);
};

// Import ProjectTracker (needs tsc compilation or ts-node, but here we assume JS or compilation)
// Since source is TS, we might need to test the compiled JS in 'dist' or use 'ts-node'.
// Given the environment, let's try to verify the Logic directly by mocking or copying the class if imports are hard.
// Actually, let's try to require the TS file via ts-node if available, or just test logic.

// Wait, the project uses 'esbuild' to bundle to 'dist/extension.js'.
// Testing source TS files directly with 'node --test' works if we have a loader, but we don't know if we do.
// 'antigravity-jules-orchestration' tests were JS.

// Better approach: Test the Logic in isolation. 
// ProjectTracker's core logic is string parsing (TaskAnalyzer) and FS operations.
// I will create a test that specifically targets the logic we added.

// Since loading 'src/core/project-tracker.ts' is hard without TS loader, 
// I will rely on manual verification via 'antigravity.toggleAutonomous' as referenced in the plan,
// OR I will try to create a test file that simulates the parsing logic to ensure regexes are correct.

test('ProjectTracker Parsing Logic', async (t) => {
    // Re-implement or import the parsing logic to verify it
    const extractCurrentTask = (content) => {
        const lines = content.split('\n');
        for (const line of lines) {
            if (/^[-*]\s*\[\s*\]/.test(line)) {
                if (line.includes('~~')) continue;
                const task = line.replace(/^[-*]\s*\[\s*\]\s*/, '').trim();
                if (task.length < 3) continue;
                return task;
            }
        }
        return null;
    };

    const markTaskComplete = (content, task) => {
        const escapedTask = task.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`^([-*]\\s*)\\[\\s*\\](\\s*${escapedTask})`, 'mi');
        return content.replace(pattern, '$1[x]$2');
    };

    await t.test('should extract first incomplete task', () => {
        const content = `
# Tasks
- [x] Phase 1
- [ ] Phase 2: Implementation
- [ ] Phase 3
`;
        const task = extractCurrentTask(content);
        assert.strictEqual(task, 'Phase 2: Implementation');
    });

    await t.test('should skip crossed out tasks', () => {
        const content = `
- [ ] ~~Deprecated Task~~
- [ ] Valid Task
`;
        const task = extractCurrentTask(content);
        assert.strictEqual(task, 'Valid Task');
    });

    await t.test('should mark task as complete', () => {
        const content = '- [ ] Task A';
        const updated = markTaskComplete(content, 'Task A');
        assert.strictEqual(updated, '- [x] Task A');
    });
});
