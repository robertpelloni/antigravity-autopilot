import * as vscode from 'vscode';
import { config } from '../utils/config';
import { logToOutput } from '../utils/output-channel';

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
                  try {
                    const key = String(message.key || '');
                    const value = message.value;
                    const targetRaw = String(message.target || '').toLowerCase();
                    let target = vscode.ConfigurationTarget.Workspace;
                    if (targetRaw === 'workspace') {
                      target = vscode.ConfigurationTarget.Workspace;
                    } else if (targetRaw === 'workspacefolder') {
                      target = vscode.ConfigurationTarget.WorkspaceFolder;
                    } else if (targetRaw === 'global') {
                      target = vscode.ConfigurationTarget.Global;
                    }

                    if (key === 'cdpPort') {
                        const firstFolder = vscode.workspace.workspaceFolders?.[0];
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) {
              throw new Error('Invalid CDP port: not a finite number.');
            }
            const intPort = Math.trunc(parsed);
            if (intPort < 1 || intPort > 65535) {
              throw new Error('Invalid CDP port: must be in range 1-65535.');
            }
            const writeValue = intPort;

                        if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
                            if (!firstFolder) {
                                throw new Error('No workspace folder is open; cannot write workspace-folder setting.');
                            }
                            const folderCfg = vscode.workspace.getConfiguration('antigravity', firstFolder.uri);
                            await folderCfg.update('cdpPort', writeValue, vscode.ConfigurationTarget.WorkspaceFolder);
                        } else {
                            const workspaceCfg = vscode.workspace.getConfiguration('antigravity');
                            await workspaceCfg.update('cdpPort', writeValue, target);
                        }

                        const inspectCfg = vscode.workspace.getConfiguration('antigravity', firstFolder?.uri);
                        const inspected = inspectCfg.inspect<number>('cdpPort');
                        const workspaceFolderValue = inspected?.workspaceFolderValue;
                        const workspaceValue = inspected?.workspaceValue;
                        const globalValue = inspected?.globalValue;
                        const defaultValue = inspected?.defaultValue;
                        const effective = inspectCfg.get<number>('cdpPort') ?? defaultValue ?? 9222;
                        const source = workspaceFolderValue !== undefined
                            ? 'workspaceFolder'
                            : (workspaceValue !== undefined
                                ? 'workspace'
                                : (globalValue !== undefined ? 'global' : 'default'));

                        this.panel.webview.postMessage({
                          command: 'updateConfigResult',
                          key,
                          ok: true,
                          value: writeValue,
                          effective,
                          source,
                          scopeValues: {
                            workspaceFolder: workspaceFolderValue,
                            workspace: workspaceValue,
                            global: globalValue,
                            default: defaultValue
                          }
                        });
                    } else {
                        await config.update(key, value, target);
                        this.panel.webview.postMessage({
                          command: 'updateConfigResult',
                          key,
                          ok: true,
                          value
                        });
                    }
                    this.update();
                  } catch (error: any) {
                    this.panel.webview.postMessage({
                      command: 'updateConfigResult',
                      key: String(message.key || ''),
                      ok: false,
                      error: String(error?.message || error || 'unknown-error')
                    });
                  }
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
                  const requestId = String(message.requestId || '').trim();
                    if (commandId) {
                    const args = Array.isArray(message.args) ? message.args : [];
                    logToOutput(`[Dashboard] runCommand request id=${requestId || 'none'} command=${commandId} args=${args.length}`);
                    try {
                      const result = await vscode.commands.executeCommand(commandId, ...args);
                      logToOutput(`[Dashboard] runCommand result id=${requestId || 'none'} command=${commandId} ok=true`);
                      if (requestId) {
                        this.panel.webview.postMessage({
                          command: 'runCommandResult',
                          requestId,
                          ok: true,
                          result
                        });
                      }
                    } catch (error: any) {
                      logToOutput(`[Dashboard] runCommand result id=${requestId || 'none'} command=${commandId} ok=false err=${String(error?.message || error || 'unknown-error')}`);
                      if (requestId) {
                        this.panel.webview.postMessage({
                          command: 'runCommandResult',
                          requestId,
                          ok: false,
                          error: String(error?.message || error || 'unknown-error')
                        });
                      }
                    }
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
        const cdpPort = config.get<number>('cdpPort') || 9222;
        const testBumpText = config.get<string>('actions.bump.text') || 'Proceed';

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
    .test-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    .test-table th, .test-table td { border: 1px solid var(--vscode-widget-border); padding: 6px 8px; text-align: left; vertical-align: top; }
    .test-table th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
    .badge-pass { background: color-mix(in srgb, var(--vscode-testing-iconPassed) 20%, transparent); color: var(--vscode-testing-iconPassed); }
    .badge-fail { background: color-mix(in srgb, var(--vscode-testing-iconFailed) 20%, transparent); color: var(--vscode-testing-iconFailed); }
  </style>
</head>
<body>
  <script>
    // Early bootstrap shim: guarantees inline handler symbols exist globally
    // even if the main dashboard script fails during initialization.
    (function () {
      function __agNoop(name) {
        return function () {
          try { console.warn('[Antigravity Dashboard] early handler shim:', name); } catch {}
          return undefined;
        };
      }

      if (typeof window.setCfg !== 'function') window.setCfg = __agNoop('setCfg');
      if (typeof window.setCdpPortImmediate !== 'function') window.setCdpPortImmediate = __agNoop('setCdpPortImmediate');
      if (typeof window.saveCdpPortNow !== 'function') window.saveCdpPortNow = __agNoop('saveCdpPortNow');
      if (typeof window.runCommand !== 'function') window.runCommand = __agNoop('runCommand');
      if (typeof window.runTest !== 'function') window.runTest = __agNoop('runTest');
      if (typeof window.clearTestHistory !== 'function') window.clearTestHistory = __agNoop('clearTestHistory');
      if (typeof window.requestRuntimeState !== 'function') window.requestRuntimeState = __agNoop('requestRuntimeState');

      // Ensure identifier lookups used by inline onclick resolve reliably.
      if (typeof globalThis.setCfg !== 'function') globalThis.setCfg = window.setCfg;
      if (typeof globalThis.setCdpPortImmediate !== 'function') globalThis.setCdpPortImmediate = window.setCdpPortImmediate;
      if (typeof globalThis.saveCdpPortNow !== 'function') globalThis.saveCdpPortNow = window.saveCdpPortNow;
      if (typeof globalThis.runCommand !== 'function') globalThis.runCommand = window.runCommand;
      if (typeof globalThis.runTest !== 'function') globalThis.runTest = window.runTest;
      if (typeof globalThis.clearTestHistory !== 'function') globalThis.clearTestHistory = window.clearTestHistory;
      if (typeof globalThis.requestRuntimeState !== 'function') globalThis.requestRuntimeState = window.requestRuntimeState;
    })();
  </script>

  <h1>Antigravity Minimal Settings</h1>

  <div class="card">
    <h2>Core</h2>
    <div class="row"><label>Automation Enabled</label><input type="checkbox" ${autoContinueEnabled ? 'checked' : ''} onchange="setCfg('autoContinueScriptEnabled', this.checked)" /></div>
    <div class="row"><label>Bump Enabled</label><input type="checkbox" ${bumpEnabled ? 'checked' : ''} onchange="setCfg('actions.bump.enabled', this.checked)" /></div>
    <div class="row"><label>Bump Text</label><input type="text" value="${escapeHtml(bumpText)}" onchange="setCfg('actions.bump.text', this.value)" /></div>
    <div class="row"><label>CDP Port</label><input id="cdpPortInput" type="number" min="1" max="65535" value="${cdpPort}" oninput="setCdpPortImmediate()" /><button onclick="saveCdpPortNow()">Save Port</button></div>
    <div id="saveStatus" class="muted">CDP port saves immediately while typing. Save Port forces write now.</div>
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
    <div class="row"><label>Current Window Automation</label><button onclick="runCommand('antigravity.toggleCurrentWindowAutomationDisable'); setTimeout(requestRuntimeState, 120)">Toggle ON/OFF</button></div>
    <div id="cdpIndicator" class="runtime">CDP status loading...</div>
    <div class="row"><label>Test Bump Text</label><input id="testBumpText" type="text" value="${escapeHtml(testBumpText)}" /></div>

    <h2>Test: Bump Typing Methods</h2>
    <p class="muted">VS Code Insiders + Antigravity (Monaco) priority: <strong>CDP InsertText</strong>, <strong>CDP Key Dispatch</strong>, <strong>VSCode type Command</strong>, <strong>Bridge Type Payload</strong>. DOM setters are still included for legacy experiments.</p>
    <div class="row"><button onclick="runTest('typing:cdp-insert-text')">CDP InsertText</button><button onclick="runTest('typing:dom-set-input')">DOM Set Input</button><button onclick="runTest('typing:vscode-fallback')">VSCode Fallback InputEvent</button></div>
    <div class="row"><button onclick="runTest('typing:cdp-keys')">CDP Key Dispatch</button><button onclick="runTest('typing:exec-command')">ExecCommand InsertText</button><button onclick="runTest('typing:native-setter')">Native Value Setter</button></div>
    <div class="row"><button onclick="runTest('typing:dispatch-events')">Dispatch Events</button><button onclick="runTest('typing:set-range-text')">setRangeText</button><button onclick="runTest('typing:contenteditable-innerhtml')">ContentEditable innerHTML</button></div>
    <div class="row"><button onclick="runTest('typing:clipboard-paste')">Clipboard Paste</button><button onclick="runTest('typing:bridge-type')">Bridge Type Payload</button><button onclick="runTest('typing:vscode-type')">VSCode type Command</button></div>
    <div class="row"><button onclick="runTest('exec-command')">ID: exec-command</button><button onclick="runTest('native-setter')">ID: native-setter</button><button onclick="runTest('dispatch-events')">ID: dispatch-events</button></div>
    <div class="row"><button onclick="runTest('cdp-keys')">ID: cdp-keys</button><button onclick="runTest('dom-inject')">ID: dom-inject</button><button onclick="runTest('clipboard-paste')">ID: clipboard-paste</button></div>
    <div class="row"><button onclick="runTest('bridge-type')">ID: bridge-type</button><button onclick="runTest('vscode-type')">ID: vscode-type</button></div>

    <h2>Test: Stalled Detection Methods</h2>
    <div class="row"><button onclick="runTest('stalled:runtime-stalled')">Runtime Stalled</button><button onclick="runTest('stalled:waiting-for-chat-message')">Waiting For Chat Message</button><button onclick="runTest('stalled:ready-to-resume')">Ready To Resume</button></div>

    <h2>Test: Button Detection Methods</h2>
    <div class="row"><button onclick="runTest('detect:send-button')">Detect Send Button</button><button onclick="runTest('detect:keep-button')">Detect Keep Button</button><button onclick="runTest('detect:run-button')">Detect Run Button</button></div>
    <div class="row"><button onclick="runTest('detect:thumbs-signal')">Detect Thumbs Signal</button></div>

    <h2>Test: Button Clicking Methods</h2>
    <div class="row"><button onclick="runTest('click:send-dom')">DOM Click Send</button><button onclick="runTest('click:send-cdp-mouse')">CDP Mouse Click Send</button><button onclick="runTest('click:enter-key')">CDP Enter Key</button></div>

    <h2>Test: Bump Text Submit Methods</h2>
    <p class="muted">VS Code Insiders + Antigravity (Monaco) priority: <strong>Submit Auto Sequence</strong>, <strong>Submit via Enter Key</strong>, <strong>Submit via CDP Mouse</strong>, <strong>Submit VSCode Commands</strong>.</p>
    <div class="row"><button onclick="runTest('submit:send-button-click')">Submit via Send Button Click</button><button onclick="runTest('submit:send-cdp-mouse')">Submit via CDP Mouse</button></div>
    <div class="row"><button onclick="runTest('submit:enter-key')">Submit via Enter Key</button><button onclick="runTest('submit:auto-sequence')">Submit Auto Sequence</button></div>
    <div class="row"><button onclick="runTest('submit:click-send')">Submit click-send</button><button onclick="runTest('submit:form-request-submit')">Submit form.requestSubmit()</button><button onclick="runTest('submit:keyboard-sequence')">Submit keydown/keypress/keyup</button></div>
    <div class="row"><button onclick="runTest('submit:ctrl-enter')">Submit Ctrl+Enter</button><button onclick="runTest('submit:alt-enter')">Submit Alt+Enter</button><button onclick="runTest('submit:cdp-enter')">Submit cdp-enter Alias</button></div>
    <div class="row"><button onclick="runTest('submit:vscode-submit')">Submit VSCode Commands</button><button onclick="runTest('submit:script-submit')">Submit Script Hook</button></div>
    <div class="row"><button onclick="runTest('click-send')">ID: click-send</button><button onclick="runTest('enter-key')">ID: enter-key</button><button onclick="runTest('cdp-enter')">ID: cdp-enter</button></div>
    <div class="row"><button onclick="runTest('ctrl-enter')">ID: ctrl-enter</button><button onclick="runTest('alt-enter')">ID: alt-enter</button><button onclick="runTest('vscode-submit')">ID: vscode-submit</button></div>
    <div class="row"><button onclick="runTest('script-submit')">ID: script-submit</button></div>

    <h2>Test History</h2>
    <div class="row"><button onclick="clearTestHistory()">Clear History</button></div>
    <table class="test-table" aria-label="Method test history">
      <thead>
        <tr>
          <th style="width: 140px;">Time</th>
          <th style="width: 240px;">Method</th>
          <th style="width: 90px;">Status</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody id="testHistoryBody">
        <tr><td colspan="4" class="muted">No test runs yet.</td></tr>
      </tbody>
    </table>

    <div id="runtime" class="runtime">Loading...</div>
    <p class="muted">This panel only exposes the minimal settings required for fork detect, stall detect, bump type/submit, and required action clicks.</p>
  </div>

  <script>
    const vscode = (typeof acquireVsCodeApi === 'function')
      ? acquireVsCodeApi()
      : { postMessage: () => {} };

    // Fail-safe: define callable globals immediately so inline onclick handlers
    // never throw ReferenceError, even if later initialization is interrupted.
    const __agNoop = (name) => (...args) => {
      try { console.warn('[Antigravity Dashboard] handler not ready:', name, args); } catch {}
      return undefined;
    };
    window.setCfg = __agNoop('setCfg');
    window.setCdpPortImmediate = __agNoop('setCdpPortImmediate');
    window.saveCdpPortNow = __agNoop('saveCdpPortNow');
    window.runCommand = __agNoop('runCommand');
    window.runTest = __agNoop('runTest');
    window.clearTestHistory = __agNoop('clearTestHistory');
    window.requestRuntimeState = __agNoop('requestRuntimeState');

    const pendingCommandResolvers = new Map();
    const testHistory = [];
    let commandCounter = 0;
    const COMMAND_TIMEOUT_MS = 12000;

    function setCfg(key, value, target) {
      vscode.postMessage({ command: 'updateConfig', key, value, target: target || 'global' });
    }

    function normalizePort(value) {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return null;
      const intPort = Math.trunc(parsed);
      if (intPort < 1 || intPort > 65535) return null;
      return intPort;
    }

    function setSaveStatus(text) {
      const el = document.getElementById('saveStatus');
      if (!el) return;
      el.textContent = text;
    }

    function getCdpPortInputValue() {
      const input = document.getElementById('cdpPortInput');
      if (!input) return null;
      return normalizePort(input.value);
    }

    function setCdpPortImmediate() {
      const port = getCdpPortInputValue();
      if (port == null) {
        setSaveStatus('CDP port not saved yet: enter a number in range 1-65535.');
        return;
      }
      setCfg('cdpPort', port, 'workspace');
      setSaveStatus('Saving CDP port...');
    }

    function saveCdpPortNow() {
      const port = getCdpPortInputValue();
      if (port == null) {
        setSaveStatus('Cannot save CDP port: enter a valid number in range 1-65535.');
        return;
      }
      setCfg('cdpPort', port, 'workspace');
      setSaveStatus('Saving CDP port (manual save)...');
    }

    function runCommand(id, args) {
      commandCounter += 1;
      const requestId = 'req-' + String(Date.now()) + '-' + String(commandCounter);
      vscode.postMessage({ command: 'runCommand', id, args: Array.isArray(args) ? args : [], requestId });
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!pendingCommandResolvers.has(requestId)) return;
          pendingCommandResolvers.delete(requestId);
          resolve({ ok: false, error: 'timeout waiting for command response' });
        }, COMMAND_TIMEOUT_MS);

        pendingCommandResolvers.set(requestId, {
          resolve,
          timeout
        });
      });
    }

    function formatResult(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (value == null) return 'null';
      try {
        return JSON.stringify(value);
      } catch {
        return '[unserializable]';
      }
    }

    function escapeHtmlJs(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderTestHistory() {
      const body = document.getElementById('testHistoryBody');
      if (!body) return;
      if (testHistory.length === 0) {
        body.innerHTML = '<tr><td colspan="4" class="muted">No test runs yet.</td></tr>';
        return;
      }

      body.innerHTML = testHistory.map((entry) => {
        const badgeClass = entry.passed ? 'badge badge-pass' : 'badge badge-fail';
        const badgeText = entry.passed ? 'PASS' : 'FAIL';
        return '<tr>'
          + '<td>' + entry.time + '</td>'
          + '<td>' + entry.method + '</td>'
          + '<td><span class="' + badgeClass + '">' + badgeText + '</span></td>'
          + '<td>' + escapeHtmlJs(String(entry.result || '')) + '</td>'
          + '</tr>';
      }).join('');
    }

    async function runTest(method) {
      const textEl = document.getElementById('testBumpText');
      const text = textEl && typeof textEl.value === 'string' ? textEl.value : '';
      const response = await runCommand('antigravity.testMethod', [{ method, text }]);
      const passed = !!(response && response.ok === true && response.result === true);
      const resultText = response && response.ok === true
        ? formatResult(response.result)
        : ('error: ' + formatResult(response ? response.error : 'no-response'));

      testHistory.unshift({
        time: new Date().toLocaleTimeString(),
        method,
        passed,
        result: resultText
      });
      if (testHistory.length > 100) {
        testHistory.length = 100;
      }
      renderTestHistory();
      requestRuntimeState();
    }

    function clearTestHistory() {
      testHistory.length = 0;
      renderTestHistory();
    }

    function requestRuntimeState() {
      vscode.postMessage({ command: 'requestRuntimeState' });
    }

    // Ensure inline onclick handlers always resolve in webview global scope.
    window.setCfg = setCfg;
    window.setCdpPortImmediate = setCdpPortImmediate;
    window.saveCdpPortNow = saveCdpPortNow;
    window.runCommand = runCommand;
    window.runTest = runTest;
    window.clearTestHistory = clearTestHistory;
    window.requestRuntimeState = requestRuntimeState;

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message) return;

      if (message.command === 'updateConfigResult') {
        const key = String(message.key || '');
        if (key === 'cdpPort') {
          if (message.ok === true) {
            const src = String(message.source || 'unknown');
            const scopes = message.scopeValues || {};
            const details = 'src=' + src
              + ' wf=' + String(scopes.workspaceFolder)
              + ' ws=' + String(scopes.workspace)
              + ' g=' + String(scopes.global);
            setSaveStatus('CDP port saved: ' + String(message.value) + ' (effective: ' + String(message.effective) + '; ' + details + ')');
          } else {
            setSaveStatus('Failed to save CDP port: ' + String(message.error || 'unknown error'));
          }
        }
        return;
      }

      if (message.command === 'runCommandResult') {
        const requestId = String(message.requestId || '');
        const pending = pendingCommandResolvers.get(requestId);
        if (pending && typeof pending.resolve === 'function') {
          pendingCommandResolvers.delete(requestId);
          try { clearTimeout(pending.timeout); } catch {}
          pending.resolve({ ok: message.ok === true, result: message.result, error: message.error });
        }
        return;
      }

      if (message.command !== 'runtimeStateUpdate') return;
      const target = document.getElementById('runtime');
      const cdpTarget = document.getElementById('cdpIndicator');
      if (!target) return;
      if (!message.state) {
        target.textContent = 'Runtime unavailable';
        if (cdpTarget) cdpTarget.textContent = 'CDP: unavailable';
        return;
      }

      const cdp = message.state.cdp || {};
      const wc = message.state.windowControl || {};
      const primary = cdp.primaryWindow;
      const primaryLabel = primary
        ? (String(primary.id || '') + ' • ' + String(primary.title || ''))
        : 'none';
      if (cdpTarget) {
        cdpTarget.textContent = [
          'CDP Port: ' + (cdp.port ?? 'unknown'),
          'Connected: ' + (cdp.connected ? 'YES' : 'NO') + ' (' + (cdp.connectionCount ?? 0) + ')',
          'Primary Window: ' + primaryLabel,
          'Current Window Automation: ' + (wc.enabled === false ? 'OFF' : 'ON')
        ].join('\\n');
      }

      const runtimePayload = message.state.runtime ?? null;
      target.textContent = runtimePayload ? JSON.stringify(runtimePayload, null, 2) : 'Runtime unavailable';
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
