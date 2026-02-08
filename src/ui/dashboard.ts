import * as vscode from 'vscode';
import { config } from '../utils/config';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        // Listen for messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'updateConfig':
                        await config.update(message.key, message.value);
                        vscode.window.showInformationMessage(`Updated ${message.key} to ${message.value}`);
                        return;
                }
            },
            null,
            this._disposables
        );

        // Listen for configuration changes to update the webview
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity') && this._panel.visible) {
                this._update();
            }
        }, null, this._disposables);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'antigravityDashboard',
            'Antigravity Dashboard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri);
    }

    public dispose() {
        DashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Antigravity Settings';
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const settings = config.getAll();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Antigravity Dashboard</title>
            <style>
                body { font-family: sans-serif; padding: 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                h1 { color: var(--vscode-editor-foreground); }
                .card { background: var(--vscode-editor-widget-background); border: 1px solid var(--vscode-widget-border); padding: 15px; margin-bottom: 10px; border-radius: 5px; }
                .setting { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
                label { font-weight: bold; }
                select, input[type="text"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
                button:hover { background: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
            <h1>Antigravity Autopilot</h1>
            <div class="card">
                <h2>Strategies</h2>
                <div class="setting">
                    <label>Current Strategy:</label>
                    <select onchange="updateConfig('strategy', this.value)">
                        <option value="simple" ${settings.strategy === 'simple' ? 'selected' : ''}>Simple (Commands)</option>
                        <option value="cdp" ${settings.strategy === 'cdp' ? 'selected' : ''}>CDP (Browser Protocol)</option>
                    </select>
                </div>
                <div class="setting">
                    <label>Auto-Accept:</label>
                    <input type="checkbox" ${settings.autoAcceptEnabled ? 'checked' : ''} onchange="updateConfig('autoAcceptEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Auto-All (CDP):</label>
                    <input type="checkbox" ${settings.autoAllEnabled ? 'checked' : ''} onchange="updateConfig('autoAllEnabled', this.checked)">
                </div>
                 <div class="setting">
                    <label>Multi-Tab Mode:</label>
                    <input type="checkbox" ${settings.multiTabEnabled ? 'checked' : ''} onchange="updateConfig('multiTabEnabled', this.checked)">
                </div>
            </div>

             <div class="card">
                <h2>Modules</h2>
                <div class="setting">
                    <label>Autonomous Mode:</label>
                    <input type="checkbox" ${settings.autonomousEnabled ? 'checked' : ''} onchange="updateConfig('autonomousEnabled', this.checked)">
                </div>
                 <div class="setting">
                    <label>MCP Server:</label>
                    <input type="checkbox" ${settings.mcpEnabled ? 'checked' : ''} onchange="updateConfig('mcpEnabled', this.checked)">
                </div>
                 <div class="setting">
                    <label>Voice Control:</label>
                    <input type="checkbox" ${settings.voiceControlEnabled ? 'checked' : ''} onchange="updateConfig('voiceControlEnabled', this.checked)">
                </div>
            </div>

            <div class="card">
                <h2>Models</h2>
                <div class="setting">
                    <label>Auto-Switch Models:</label>
                    <input type="checkbox" ${settings.autoSwitchModels ? 'checked' : ''} onchange="updateConfig('autoSwitchModels', this.checked)">
                </div>
                 <div class="setting">
                    <label>Reasoning Model:</label>
                    <select onchange="updateConfig('preferredModelForReasoning', this.value)">
                         <option value="claude-opus-4.5-thinking" ${settings.preferredModelForReasoning === 'claude-opus-4.5-thinking' ? 'selected' : ''}>Claude Opus 4.5 (Thinking)</option>
                         <option value="claude-sonnet-4.5-thinking" ${settings.preferredModelForReasoning === 'claude-sonnet-4.5-thinking' ? 'selected' : ''}>Claude Sonnet 4.5 (Thinking)</option>
                         <option value="claude-sonnet-3.5" ${settings.preferredModelForReasoning === 'claude-sonnet-3.5' ? 'selected' : ''}>Claude Sonnet 3.5</option>
                    </select>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                function updateConfig(key, value) {
                    vscode.postMessage({
                        command: 'updateConfig',
                        key: key,
                        value: value
                    });
                }
            </script>
        </body>
        </html>`;
    }
}
