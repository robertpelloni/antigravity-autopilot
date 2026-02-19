const Module = require('module');

const registeredCommands = [];

const vscodeMock = {
    window: {
        createStatusBarItem: () => ({ show: () => { }, dispose: () => { } }),
        createOutputChannel: () => ({ appendLine: () => { }, show: () => { }, clear: () => { } }),
        showInformationMessage: async () => { },
        showWarningMessage: async () => { },
        showErrorMessage: async () => { }
    },
    workspace: {
        getConfiguration: () => ({ get: () => null, update: async () => { } }),
        onDidChangeConfiguration: () => ({ dispose: () => { } })
    },
    commands: {
        registerCommand: (cmdId, callback) => {
            registeredCommands.push(cmdId);
            return { dispose: () => { } };
        },
        executeCommand: async () => { }
    },
    languages: {
        registerHoverProvider: () => ({ dispose: () => { } })
    },
    ThemeColor: class { },
    StatusBarAlignment: { Right: 2, Left: 1 },
    ExtensionContext: class { },
    env: { clipboard: { writeText: async () => { } } }
};

const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') return 'vscode';
    return origResolveFilename.call(this, request, parent, isMain, options);
};
require.cache['vscode'] = {
    id: 'vscode',
    filename: 'vscode',
    loaded: true,
    exports: vscodeMock
};

try {
    const ext = require('./dist/extension.js');
    console.log('✅ Module loaded successfully.');

    const context = {
        subscriptions: { push: (...items) => { } },
        globalState: { get: () => null, update: async () => { } },
        extensionUri: { fsPath: __dirname }
    };

    Promise.resolve(ext.activate(context))
        .then(() => {
            console.log('✅ Extension activated successfully.');
            console.log('\n--- Registered Commands ---');
            registeredCommands.sort().forEach(c => console.log(c));

            if (!registeredCommands.includes('antigravity.openSettings')) {
                console.error('❌ BUG: antigravity.openSettings is NOT registered!');
            }
            if (!registeredCommands.includes('antigravity.showStatusMenu')) {
                console.error('❌ BUG: antigravity.showStatusMenu is NOT registered!');
            }
        })
        .catch(err => {
            console.error('❌ Async error during activation:', err);
        });

} catch (err) {
    console.error('❌ Synchronous error loading or activating extension:', err);
}
