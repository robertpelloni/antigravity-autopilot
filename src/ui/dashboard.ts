import * as vscode from 'vscode';
import { config } from '../utils/config';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private static runtimeStateProvider: (() => Promise<any | null>) | null = null;
    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];

    public static setRuntimeStateProvider(provider: (() => Promise<any | null>) | null): void {
        DashboardPanel.runtimeStateProvider = provider;
    }

    private constructor(panel: vscode.WebviewPanel) {
        this.panel = panel;
        this.update();

        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'updateConfig': {
                    await config.update(message.key, message.value);
                    this.update();
                    return;
                }
                case 'requestRuntimeState': {
                    const provider = DashboardPanel.runtimeStateProvider;
                    const state = provider ? await provider() : null;
                    this.panel.webview.postMessage({ command: 'runtimeStateUpdate', state: state || null });
                    return;
                }
                case 'runCommand': {
                    const commandId = String(message.id || '').trim();
                    if (commandId) {
                        await vscode.commands.executeCommand(commandId);
                    }
                    return;
                }
            }
        }, null, this.disposables);

        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('antigravity') && this.panel.visible) {
                this.update();
            }
        }, null, this.disposables);

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri): void {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'antigravityDashboard',
            'Antigravity Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        DashboardPanel.currentPanel = new DashboardPanel(panel);
    }

    public dispose(): void {
        DashboardPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private update(): void {
        this.panel.title = 'Antigravity Settings';
        this.panel.webview.html = this.getHtml();
    }

    private getHtml(): string {
        const getBool = (key: string, fallback: boolean): boolean => {
            const value = config.get<boolean>(key);
            return typeof value === 'boolean' ? value : fallback;
        };

        const autoContinueEnabled = getBool('autoContinueScriptEnabled', true);
        const bumpEnabled = getBool('actions.bump.enabled', true);
        const clickRun = getBool('automation.actions.clickRun', true);
        const clickExpand = getBool('automation.actions.clickExpand', true);
        const clickAlwaysAllow = getBool('automation.actions.clickAlwaysAllow', true);
        const clickRetry = getBool('automation.actions.clickRetry', true);
        const clickAcceptAll = getBool('automation.actions.clickAcceptAll', true);
        const clickKeep = getBool('automation.actions.clickKeep', true);

        const bumpText = config.get<string>('actions.bump.text') || 'Proceed';
        const pollIntervalMs = config.get<number>('automation.timing.pollIntervalMs') || 800;
        const stallTimeoutSec = config.get<number>('actions.bump.stallTimeout') || 7;
        const bumpCooldownSec = config.get<number>('actions.bump.cooldown') || 30;
        const submitDelayMs = config.get<number>('actions.bump.submitDelayMs') || 120;

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Antigravity Settings</title>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    h1 { margin-top: 0; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--vscode-descriptionForeground); }
    .card { border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 14px; margin-bottom: 12px; background: var(--vscode-editorWidget-background); }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    label { font-weight: 600; }
    input[type="text"], input[type="number"] { min-width: 170px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 4px 8px; }
    input[type="checkbox"] { width: 18px; height: 18px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .runtime { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; border: 1px dashed var(--vscode-widget-border); padding: 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Antigravity Minimal Settings</h1>

  <div class="card">
    <h2>Core</h2>
    <div class="row"><label>Automation Enabled</label><input type="checkbox" ${autoContinueEnabled ? 'checked' : ''} onchange="setCfg('autoContinueScriptEnabled', this.checked)" /></div>
    <div class="row"><label>Bump Enabled</label><input type="checkbox" ${bumpEnabled ? 'checked' : ''} onchange="setCfg('actions.bump.enabled', this.checked)" /></div>
    <div class="row"><label>Bump Text</label><input type="text" value="${escapeHtml(bumpText)}" onchange="setCfg('actions.bump.text', this.value)" /></div>
  </div>

  <div class="card">
    <h2>Required Action Clicks</h2>
    <div class="row"><label>Run</label><input type="checkbox" ${clickRun ? 'checked' : ''} onchange="setCfg('automation.actions.clickRun', this.checked)" /></div>
    <div class="row"><label>Expand</label><input type="checkbox" ${clickExpand ? 'checked' : ''} onchange="setCfg('automation.actions.clickExpand', this.checked)" /></div>
    <div class="row"><label>Always Allow</label><input type="checkbox" ${clickAlwaysAllow ? 'checked' : ''} onchange="setCfg('automation.actions.clickAlwaysAllow', this.checked)" /></div>
    <div class="row"><label>Retry</label><input type="checkbox" ${clickRetry ? 'checked' : ''} onchange="setCfg('automation.actions.clickRetry', this.checked)" /></div>
    <div class="row"><label>Accept all</label><input type="checkbox" ${clickAcceptAll ? 'checked' : ''} onchange="setCfg('automation.actions.clickAcceptAll', this.checked)" /></div>
    <div class="row"><label>Keep</label><input type="checkbox" ${clickKeep ? 'checked' : ''} onchange="setCfg('automation.actions.clickKeep', this.checked)" /></div>
  </div>

  <div class="card">
    <h2>Timing</h2>
    <div class="row"><label>Poll Interval (ms)</label><input type="number" min="150" value="${pollIntervalMs}" onchange="setCfg('automation.timing.pollIntervalMs', Number(this.value) || 800)" /></div>
    <div class="row"><label>Stall Timeout (sec)</label><input type="number" min="1" value="${stallTimeoutSec}" onchange="setCfg('actions.bump.stallTimeout', Number(this.value) || 7)" /></div>
    <div class="row"><label>Bump Cooldown (sec)</label><input type="number" min="1" value="${bumpCooldownSec}" onchange="setCfg('actions.bump.cooldown', Number(this.value) || 30)" /></div>
    <div class="row"><label>Submit Delay (ms)</label><input type="number" min="40" value="${submitDelayMs}" onchange="setCfg('actions.bump.submitDelayMs', Number(this.value) || 120)" /></div>
  </div>

  <div class="card">
    <h2>Diagnostics</h2>
    <div class="row"><button onclick="runCommand('antigravity.checkRuntimeState')">Check Runtime State</button><button onclick="requestRuntimeState()">Refresh Snapshot</button></div>
    <div id="runtime" class="runtime">Loading...</div>
    <p class="muted">This panel only exposes the minimal settings required for fork detect, stall detect, bump type/submit, and required action clicks.</p>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function setCfg(key, value) {
      vscode.postMessage({ command: 'updateConfig', key, value });
    }

    function runCommand(id) {
      vscode.postMessage({ command: 'runCommand', id });
    }

    function requestRuntimeState() {
      vscode.postMessage({ command: 'requestRuntimeState' });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.command !== 'runtimeStateUpdate') return;
      const target = document.getElementById('runtime');
      if (!target) return;
      target.textContent = message.state ? JSON.stringify(message.state, null, 2) : 'Runtime unavailable';
    });

    requestRuntimeState();
  </script>
</body>
</html>`;
    }
}

function escapeHtml(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
