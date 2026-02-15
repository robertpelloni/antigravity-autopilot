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
                    case 'toggleMethod': {
                        const current: string[] = config.get(message.configKey) || [];
                        let updated: string[];
                        if (message.enabled) {
                            updated = current.includes(message.methodId) ? current : [...current, message.methodId];
                        } else {
                            updated = current.filter((m: string) => m !== message.methodId);
                        }
                        await config.update(message.configKey, updated);
                        vscode.window.showInformationMessage(`${message.enabled ? 'Enabled' : 'Disabled'} ${message.methodId}`);
                        return;
                    }
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
                body { font-family: var(--vscode-font-family, sans-serif); padding: 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                h1 { color: var(--vscode-editor-foreground); border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 8px; }
                h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 0; color: var(--vscode-descriptionForeground); }
                .card { background: var(--vscode-editor-widget-background); border: 1px solid var(--vscode-widget-border); padding: 15px; margin-bottom: 12px; border-radius: 6px; }
                .setting { margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
                .setting.vertical { flex-direction: column; align-items: flex-start; }
                label { font-weight: 600; flex-shrink: 0; }
                select, input[type="text"], input[type="number"] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 8px; border-radius: 3px; min-width: 120px; }
                input[type="number"] { width: 80px; }
                input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--vscode-button-background); cursor: pointer; }
                textarea { width: 100%; height: 60px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; resize: vertical; margin-top: 5px; font-family: monospace; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; }
                button:hover { background: var(--vscode-button-hoverBackground); }
                .version { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 16px; text-align: center; }
            </style>
        </head>
        <body>
            <h1>⚡ Antigravity Autopilot</h1>
            
            <!-- STRATEGIES -->
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

            <!-- MODULES -->
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
                <div class="setting">
                    <label>Voice Mode:</label>
                    <select onchange="updateConfig('voiceMode', this.value)">
                        <option value="push-to-talk" ${settings.voiceMode === 'push-to-talk' ? 'selected' : ''}>Push to Talk</option>
                        <option value="always-listening" ${settings.voiceMode === 'always-listening' ? 'selected' : ''}>Always Listening</option>
                    </select>
                </div>
                 <div class="setting">
                    <label>Auto Git Commit:</label>
                    <input type="checkbox" ${settings.autoGitCommit ? 'checked' : ''} onchange="updateConfig('autoGitCommit', this.checked)">
                </div>
            </div>

            <!-- CDP & TIMING -->
            <div class="card">
                <h2>CDP & Automation</h2>
                <div class="setting">
                    <label>CDP Timeout (ms):</label>
                    <input type="number" value="${settings.cdpTimeout}" onchange="updateConfig('cdpTimeout', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>CDP Port:</label>
                    <input type="number" value="${settings.cdpPort}" onchange="updateConfig('cdpPort', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Bump Message:</label>
                    <input type="text" value="${settings.bumpMessage}" onchange="updateConfig('bumpMessage', this.value)">
                </div>
                <div class="setting">
                    <label>Auto-Approve Delay (s):</label>
                    <input type="number" value="${settings.autoApproveDelay}" onchange="updateConfig('autoApproveDelay', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Poll Frequency (ms):</label>
                    <input type="number" value="${settings.pollFrequency}" onchange="updateConfig('pollFrequency', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Loop Interval (s):</label>
                    <input type="number" value="${settings.loopInterval}" onchange="updateConfig('loopInterval', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Thread Wait (s):</label>
                    <input type="number" value="${settings.threadWaitInterval}" onchange="updateConfig('threadWaitInterval', parseInt(this.value))">
                </div>
                 <div class="setting">
                     <label>Max Loops/Session:</label>
                     <input type="number" value="${settings.maxLoopsPerSession}" onchange="updateConfig('maxLoopsPerSession', parseInt(this.value))">
                </div>
                 <div class="setting">
                     <label>Execution Timeout (min):</label>
                     <input type="number" value="${settings.executionTimeout}" onchange="updateConfig('executionTimeout', parseInt(this.value))">
                </div>
            </div>

            <!-- INTERACTION METHODS -->
            <div class="card">
                <h2>🔧 Interaction Methods</h2>
                <p style="font-size:12px;color:var(--vscode-descriptionForeground);margin:0 0 10px;">Select which methods to use for text input, clicking, and submission. Higher priority methods are tried first.</p>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin-bottom:8px;">📝 Text Input Methods</summary>
                    <div class="setting">
                        <label>CDP Key Dispatch (cdp-keys):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('cdp-keys') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'cdp-keys', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Clipboard Paste (clipboard-paste):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('clipboard-paste') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'clipboard-paste', this.checked)">
                    </div>
                    <div class="setting">
                        <label>DOM Value Injection (dom-inject):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('dom-inject') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'dom-inject', this.checked)">
                    </div>
                    <div class="setting">
                        <label>VS Code Type Command (vscode-type):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('vscode-type') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'vscode-type', this.checked)">
                    </div>
                </details>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin:8px 0;">🖱️ Click Methods</summary>
                    <div class="setting">
                        <label>DOM Selector Click (dom-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('dom-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'dom-click', this.checked)">
                    </div>
                    <div class="setting">
                        <label>CDP Mouse Event (cdp-mouse):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('cdp-mouse') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'cdp-mouse', this.checked)">
                    </div>
                    <div class="setting">
                        <label>VS Code Command (vscode-cmd):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('vscode-cmd') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'vscode-cmd', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Script Force Click (script-force):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('script-force') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'script-force', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Coordinate Click (coord-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('coord-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'coord-click', this.checked)">
                    </div>
                </details>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin:8px 0;">🚀 Submit Methods</summary>
                    <div class="setting">
                        <label>VS Code Submit Commands (vscode-submit):</label>
                        <input type="checkbox" ${settings.interactionSubmitMethods.includes('vscode-submit') ? 'checked' : ''} onchange="toggleMethod('interactionSubmitMethods', 'vscode-submit', this.checked)">
                    </div>
                    <div class="setting">
                        <label>CDP Enter Key (cdp-enter):</label>
                        <input type="checkbox" ${settings.interactionSubmitMethods.includes('cdp-enter') ? 'checked' : ''} onchange="toggleMethod('interactionSubmitMethods', 'cdp-enter', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Script Force Submit (script-submit):</label>
                        <input type="checkbox" ${settings.interactionSubmitMethods.includes('script-submit') ? 'checked' : ''} onchange="toggleMethod('interactionSubmitMethods', 'script-submit', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Alt+Enter Shortcut (alt-enter):</label>
                        <input type="checkbox" ${settings.interactionSubmitMethods.includes('alt-enter') ? 'checked' : ''} onchange="toggleMethod('interactionSubmitMethods', 'alt-enter', this.checked)">
                    </div>
                </details>

                <hr style="border-color:var(--vscode-widget-border);margin:12px 0;">
                <div class="setting">
                    <label>Parallel Execution:</label>
                    <input type="checkbox" ${settings.interactionParallel ? 'checked' : ''} onchange="updateConfig('interactionParallel', this.checked)">
                </div>
                <div class="setting">
                    <label>Retry Count:</label>
                    <input type="number" value="${settings.interactionRetryCount}" min="1" max="13" onchange="updateConfig('interactionRetryCount', parseInt(this.value))">
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
                <div class="setting">
                    <label>Frontend Model:</label>
                    <select onchange="updateConfig('preferredModelForFrontend', this.value)">
                         <option value="gemini-3-pro-high" ${settings.preferredModelForFrontend === 'gemini-3-pro-high' ? 'selected' : ''}>Gemini 3 Pro (High)</option>
                         <option value="gemini-3-pro-low" ${settings.preferredModelForFrontend === 'gemini-3-pro-low' ? 'selected' : ''}>Gemini 3 Pro (Low)</option>
                         <option value="gpt-4o" ${settings.preferredModelForFrontend === 'gpt-4o' ? 'selected' : ''}>GPT-4o</option>
                    </select>
                </div>
                <div class="setting">
                    <label>Quick Model:</label>
                    <select onchange="updateConfig('preferredModelForQuick', this.value)">
                         <option value="gemini-3-flash" ${settings.preferredModelForQuick === 'gemini-3-flash' ? 'selected' : ''}>Gemini 3 Flash</option>
                         <option value="gemini-3-pro-low" ${settings.preferredModelForQuick === 'gemini-3-pro-low' ? 'selected' : ''}>Gemini 3 Pro (Low)</option>
                         <option value="gpt-4o-mini" ${settings.preferredModelForQuick === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini</option>
                    </select>
                </div>
            </div>

            <!-- SAFETY & PATTERNS -->
             <div class="card">
                <h2>Safety & Patterns</h2>
                <div class="setting vertical">
                    <label>Banned Commands (one per line):</label>
                    <textarea onchange="updateConfig('bannedCommands', this.value.split('\n'))">${settings.bannedCommands.join('\n')}</textarea>
                </div>
                <div class="setting vertical">
                    <label>Accept Patterns (one per line):</label>
                    <textarea onchange="updateConfig('acceptPatterns', this.value.split('\n'))">${settings.acceptPatterns.join('\n')}</textarea>
                </div>
                 <div class="setting vertical">
                    <label>Reject Patterns (one per line):</label>
                    <textarea onchange="updateConfig('rejectPatterns', this.value.split('\n'))">${settings.rejectPatterns.join('\n')}</textarea>
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
                function toggleMethod(configKey, methodId, enabled) {
                    vscode.postMessage({
                        command: 'toggleMethod',
                        configKey: configKey,
                        methodId: methodId,
                        enabled: enabled
                    });
                }
            </script>
        </body>
        </html>`;
    }
}
