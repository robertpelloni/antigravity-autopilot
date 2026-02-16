import * as vscode from 'vscode';
import { config } from '../utils/config';

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private static runtimeStateProvider: (() => Promise<any | null>) | null = null;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static setRuntimeStateProvider(provider: (() => Promise<any | null>) | null) {
        DashboardPanel.runtimeStateProvider = provider;
    }

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
                    case 'applyInteractionPreset': {
                        const profile = String(message.profile || 'vscode') as 'vscode' | 'antigravity' | 'cursor';
                        const preset = String(message.preset || 'balanced') as 'conservative' | 'balanced' | 'aggressive';
                        await this._applyInteractionPreset(profile, preset);
                        vscode.window.showInformationMessage(`Applied ${preset} preset to ${profile} profile`);
                        return;
                    }
                    case 'requestRuntimeState': {
                        const provider = DashboardPanel.runtimeStateProvider;
                        if (!provider) {
                            this._panel.webview.postMessage({
                                command: 'runtimeStateUpdate',
                                state: null
                            });
                            return;
                        }

                        const state = await provider();
                        this._panel.webview.postMessage({
                            command: 'runtimeStateUpdate',
                            state: state || null
                        });
                        return;
                    }
                    case 'runCommand': {
                        if (typeof message.id === 'string' && message.id.trim().length > 0) {
                            await vscode.commands.executeCommand(message.id);
                        }
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

    private async _applyInteractionPreset(
        profile: 'vscode' | 'antigravity' | 'cursor',
        preset: 'conservative' | 'balanced' | 'aggressive'
    ) {
        const mapping = this._getPreset(profile, preset);

        const methodKey = profile === 'vscode'
            ? 'interactionClickMethodsVSCode'
            : profile === 'antigravity'
                ? 'interactionClickMethodsAntigravity'
                : 'interactionClickMethodsCursor';

        const selectorKey = profile === 'vscode'
            ? 'interactionClickSelectorsVSCode'
            : profile === 'antigravity'
                ? 'interactionClickSelectorsAntigravity'
                : 'interactionClickSelectorsCursor';

        await config.update(methodKey as any, mapping.methods);
        await config.update(selectorKey as any, mapping.selectors);
        await config.update('interactionParallel', mapping.parallel);
        await config.update('interactionRetryCount', mapping.retryCount);
    }

    private _getPreset(
        profile: 'vscode' | 'antigravity' | 'cursor',
        preset: 'conservative' | 'balanced' | 'aggressive'
    ): { methods: string[]; selectors: string[]; parallel: boolean; retryCount: number } {
        const vscodeSelectors = [
            'button[aria-label*="Accept"]',
            'button[title*="Accept"]',
            'button[aria-label*="Apply"]',
            'button[title*="Apply"]',
            '.monaco-dialog-box button',
            '.monaco-notification-list button',
            '.monaco-button'
        ];

        const antigravitySelectors = [
            '#antigravity\\.agentPanel button',
            '#antigravity\\.agentPanel [role="button"]',
            '.bg-ide-button-background',
            'button.grow',
            '.monaco-button'
        ];

        const cursorSelectors = [
            '#workbench\\.parts\\.auxiliarybar button',
            '#workbench\\.parts\\.auxiliarybar [role="button"]',
            '.chat-session-item [role="button"]',
            '.monaco-button'
        ];

        const selectors = profile === 'vscode'
            ? vscodeSelectors
            : profile === 'antigravity'
                ? antigravitySelectors
                : cursorSelectors;

        if (preset === 'conservative') {
            return {
                methods: ['native-accept', 'vscode-cmd', 'dom-scan-click'],
                selectors,
                parallel: false,
                retryCount: 2
            };
        }

        if (preset === 'aggressive') {
            return {
                methods: ['dom-scan-click', 'dom-click', 'bridge-click', 'cdp-mouse', 'native-accept', 'vscode-cmd', 'script-force', 'process-peek', 'visual-verify-click', 'coord-click'],
                selectors,
                parallel: true,
                retryCount: 8
            };
        }

        return {
            methods: ['dom-scan-click', 'dom-click', 'bridge-click', 'cdp-mouse', 'native-accept', 'vscode-cmd', 'script-force', 'process-peek'],
            selectors,
            parallel: false,
            retryCount: 4
        };
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
                .runtime-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 8px; }
                .runtime-chip { display:inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 700; font-size: 12px; }
                .runtime-chip.active { background: rgba(59,130,246,0.25); color: #93c5fd; }
                .runtime-chip.pending { background: rgba(245,158,11,0.25); color: #fcd34d; }
                .runtime-chip.complete { background: rgba(34,197,94,0.25); color: #86efac; }
                .runtime-chip.waiting { background: rgba(168,85,247,0.25); color: #d8b4fe; }
                .runtime-chip.idle { background: rgba(107,114,128,0.25); color: #d1d5db; }
                .runtime-chip.unknown { background: rgba(75,85,99,0.25); color: #e5e7eb; }
                .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
                .runtime-history { margin-top: 10px; max-height: 120px; overflow-y: auto; border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 6px; }
                .runtime-history-item { font-size: 12px; padding: 2px 0; color: var(--vscode-descriptionForeground); border-bottom: 1px dashed var(--vscode-widget-border); }
                .runtime-history-item:last-child { border-bottom: none; }
            </style>
        </head>
        <body>
            <h1>⚡ Antigravity Autopilot</h1>

            <div class="card">
                <h2>Runtime State</h2>
                <div class="setting">
                    <label>Status:</label>
                    <span id="runtimeStatusChip" class="runtime-chip unknown">UNKNOWN</span>
                </div>
                <div class="runtime-grid">
                    <div><strong>Mode:</strong> <span id="runtimeMode" class="muted">-</span></div>
                    <div><strong>Idle:</strong> <span id="runtimeIdle" class="muted">-</span></div>
                    <div><strong>Tabs:</strong> <span id="runtimeTabs" class="muted">-</span></div>
                    <div><strong>Pending Accept:</strong> <span id="runtimePending" class="muted">-</span></div>
                    <div><strong>Waiting Chat:</strong> <span id="runtimeWaiting" class="muted">-</span></div>
                    <div><strong>Updated:</strong> <span id="runtimeUpdated" class="muted">-</span></div>
                    <div><strong>State Duration:</strong> <span id="runtimeStateDuration" class="muted">-</span></div>
                    <div><strong>Waiting Since:</strong> <span id="runtimeWaitingSince" class="muted">-</span></div>
                    <div><strong>Active Coverage:</strong> <span id="runtimeCoverageActive" class="muted">-</span></div>
                    <div><strong>VS Code Coverage:</strong> <span id="runtimeCoverageVSCode" class="muted">-</span></div>
                    <div><strong>Antigravity Coverage:</strong> <span id="runtimeCoverageAntigravity" class="muted">-</span></div>
                    <div><strong>Cursor Coverage:</strong> <span id="runtimeCoverageCursor" class="muted">-</span></div>
                    <div><strong>Guard Score:</strong> <span id="runtimeGuardScore" class="muted">-</span></div>
                    <div><strong>Strict Primary:</strong> <span id="runtimeGuardStrict" class="muted">-</span></div>
                    <div><strong>Auto-Resume Gate:</strong> <span id="runtimeGuardAllowed" class="muted">-</span></div>
                    <div><strong>Gate Reason:</strong> <span id="runtimeGuardReason" class="muted">-</span></div>
                </div>
                <div style="margin-top:10px;display:flex;gap:8px;">
                    <button onclick="requestRuntimeState()">Refresh Runtime State</button>
                    <button onclick="runCommand('antigravity.runCrossUiSelfTest')">Run Cross-UI Self-Test</button>
                </div>
                <div class="runtime-history" id="runtimeHistory"></div>
            </div>
            
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
                    <label>Waiting Reminder:</label>
                    <input type="checkbox" ${settings.runtimeWaitingReminderEnabled ? 'checked' : ''} onchange="updateConfig('runtimeWaitingReminderEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Reminder Delay (s):</label>
                    <input type="number" value="${settings.runtimeWaitingReminderDelaySec}" min="5" max="3600" onchange="updateConfig('runtimeWaitingReminderDelaySec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Reminder Cooldown (s):</label>
                    <input type="number" value="${settings.runtimeWaitingReminderCooldownSec}" min="5" max="7200" onchange="updateConfig('runtimeWaitingReminderCooldownSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Auto Resume:</label>
                    <input type="checkbox" ${settings.runtimeAutoResumeEnabled ? 'checked' : ''} onchange="updateConfig('runtimeAutoResumeEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Auto Resume Cooldown (s):</label>
                    <input type="number" value="${settings.runtimeAutoResumeCooldownSec}" min="5" max="7200" onchange="updateConfig('runtimeAutoResumeCooldownSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Auto Resume Min Score:</label>
                    <input type="number" value="${settings.runtimeAutoResumeMinScore}" min="0" max="100" onchange="updateConfig('runtimeAutoResumeMinScore', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Require Strict Primary:</label>
                    <input type="checkbox" ${settings.runtimeAutoResumeRequireStrictPrimary ? 'checked' : ''} onchange="updateConfig('runtimeAutoResumeRequireStrictPrimary', this.checked)">
                </div>
                <div class="setting vertical">
                    <label>Auto Resume Message:</label>
                    <textarea onchange="updateConfig('runtimeAutoResumeMessage', this.value)">${settings.runtimeAutoResumeMessage || ''}</textarea>
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

                <div class="setting">
                    <label>UI Profile:</label>
                    <select onchange="updateConfig('interactionUiProfile', this.value)">
                        <option value="auto" ${settings.interactionUiProfile === 'auto' ? 'selected' : ''}>Auto Detect</option>
                        <option value="vscode" ${settings.interactionUiProfile === 'vscode' ? 'selected' : ''}>VS Code</option>
                        <option value="antigravity" ${settings.interactionUiProfile === 'antigravity' ? 'selected' : ''}>Antigravity</option>
                        <option value="cursor" ${settings.interactionUiProfile === 'cursor' ? 'selected' : ''}>Cursor</option>
                    </select>
                </div>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin:8px 0;">🎛️ Quick Presets</summary>
                    <div class="setting">
                        <label>Preset Profile:</label>
                        <select id="presetProfileSelect">
                            <option value="vscode">VS Code</option>
                            <option value="antigravity">Antigravity</option>
                            <option value="cursor">Cursor</option>
                        </select>
                    </div>
                    <div class="setting" style="justify-content:flex-start;gap:8px;">
                        <button onclick="applyInteractionPreset('conservative')">Apply Conservative</button>
                        <button onclick="applyInteractionPreset('balanced')">Apply Balanced</button>
                        <button onclick="applyInteractionPreset('aggressive')">Apply Aggressive</button>
                    </div>
                    <p style="font-size:12px;color:var(--vscode-descriptionForeground);margin-top:6px;">
                        Conservative = safer command-first; Balanced = mixed defaults; Aggressive = broad methods + parallel.
                    </p>
                </details>

                <details>
                    <summary style="cursor:pointer;font-weight:600;margin:8px 0;">🧭 Profile Selector Bundles</summary>
                    <div class="setting vertical">
                        <label>VS Code Click Methods (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickMethodsVSCode', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickMethodsVSCode || []).join('\n')}</textarea>
                    </div>
                    <div class="setting vertical">
                        <label>Antigravity Click Methods (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickMethodsAntigravity', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickMethodsAntigravity || []).join('\n')}</textarea>
                    </div>
                    <div class="setting vertical">
                        <label>Cursor Click Methods (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickMethodsCursor', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickMethodsCursor || []).join('\n')}</textarea>
                    </div>
                    <div class="setting vertical">
                        <label>VS Code Click Selectors (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickSelectorsVSCode', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickSelectorsVSCode || []).join('\n')}</textarea>
                    </div>
                    <div class="setting vertical">
                        <label>Antigravity Click Selectors (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickSelectorsAntigravity', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickSelectorsAntigravity || []).join('\n')}</textarea>
                    </div>
                    <div class="setting vertical">
                        <label>Cursor Click Selectors (one per line):</label>
                        <textarea onchange="updateConfig('interactionClickSelectorsCursor', this.value.split('\n').map(v=>v.trim()).filter(Boolean))">${(settings.interactionClickSelectorsCursor || []).join('\n')}</textarea>
                    </div>
                </details>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin-bottom:8px;">📝 Text Input Methods</summary>
                    <div class="setting">
                        <label>CDP Key Dispatch (cdp-keys):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('cdp-keys') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'cdp-keys', this.checked)">
                    </div>
                    <div class="setting">
                        <label>CDP Insert Text (cdp-insert-text):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('cdp-insert-text') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'cdp-insert-text', this.checked)">
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
                        <label>Bridge Type Injection (bridge-type):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('bridge-type') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'bridge-type', this.checked)">
                    </div>
                    <div class="setting">
                        <label>VS Code Type Command (vscode-type):</label>
                        <input type="checkbox" ${settings.interactionTextMethods.includes('vscode-type') ? 'checked' : ''} onchange="toggleMethod('interactionTextMethods', 'vscode-type', this.checked)">
                    </div>
                </details>

                <details open>
                    <summary style="cursor:pointer;font-weight:600;margin:8px 0;">🖱️ Click Methods</summary>
                    <div class="setting">
                        <label>DOM Scan + Click (dom-scan-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('dom-scan-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'dom-scan-click', this.checked)">
                    </div>
                    <div class="setting">
                        <label>DOM Selector Click (dom-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('dom-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'dom-click', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Bridge Coordinate Click (bridge-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('bridge-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'bridge-click', this.checked)">
                    </div>
                    <div class="setting">
                        <label>CDP Mouse Event (cdp-mouse):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('cdp-mouse') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'cdp-mouse', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Native Accept Commands (native-accept):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('native-accept') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'native-accept', this.checked)">
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
                        <label>Process Peek + Command (process-peek):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('process-peek') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'process-peek', this.checked)">
                    </div>
                    <div class="setting">
                        <label>Visual Verify Click (visual-verify-click):</label>
                        <input type="checkbox" ${settings.interactionClickMethods.includes('visual-verify-click') ? 'checked' : ''} onchange="toggleMethod('interactionClickMethods', 'visual-verify-click', this.checked)">
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
                    <div class="setting">
                        <label>Ctrl+Enter Shortcut (ctrl-enter):</label>
                        <input type="checkbox" ${settings.interactionSubmitMethods.includes('ctrl-enter') ? 'checked' : ''} onchange="toggleMethod('interactionSubmitMethods', 'ctrl-enter', this.checked)">
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
                <div class="setting">
                    <label>Visual Diff Threshold:</label>
                    <input type="number" value="${settings.interactionVisualDiffThreshold}" min="0" max="1" step="0.001" onchange="updateConfig('interactionVisualDiffThreshold', parseFloat(this.value))">
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
                function applyInteractionPreset(preset) {
                    const profileEl = document.getElementById('presetProfileSelect');
                    const profile = profileEl ? profileEl.value : 'vscode';
                    vscode.postMessage({
                        command: 'applyInteractionPreset',
                        profile: profile,
                        preset: preset
                    });
                }

                function runtimeClassForStatus(status) {
                    if (status === 'processing') return 'active';
                    if (status === 'pending_accept_actions') return 'pending';
                    if (status === 'all_tasks_complete') return 'complete';
                    if (status === 'waiting_for_chat_message') return 'waiting';
                    if (status === 'idle') return 'idle';
                    return 'unknown';
                }

                const runtimeHistory = [];
                const MAX_RUNTIME_HISTORY = 20;
                let currentStatus = null;
                let currentStatusSince = null;
                let waitingSince = null;
                const autoResumeMinScore = Number(${settings.runtimeAutoResumeMinScore ?? 70});
                const autoResumeRequireStrict = ${settings.runtimeAutoResumeRequireStrictPrimary ? 'true' : 'false'};

                function formatDurationMs(ms) {
                    if (!ms || ms < 0) return '-';
                    const totalSec = Math.floor(ms / 1000);
                    const mins = Math.floor(totalSec / 60);
                    const secs = totalSec % 60;
                    return mins > 0 ? (mins + 'm ' + secs + 's') : (secs + 's');
                }

                function pushRuntimeHistory(status, timestamp) {
                    const at = new Date(timestamp || Date.now()).toLocaleTimeString();
                    runtimeHistory.unshift({ status, at });
                    if (runtimeHistory.length > MAX_RUNTIME_HISTORY) {
                        runtimeHistory.length = MAX_RUNTIME_HISTORY;
                    }
                }

                function renderRuntimeHistory() {
                    const root = document.getElementById('runtimeHistory');
                    if (!root) return;

                    if (runtimeHistory.length === 0) {
                        root.innerHTML = '<div class="runtime-history-item">No runtime transitions yet.</div>';
                        return;
                    }

                    root.innerHTML = runtimeHistory
                        .map(item => '<div class="runtime-history-item">' + item.at + ' → ' + item.status.toUpperCase() + '</div>')
                        .join('');
                }

                function yesNo(value) {
                    return value ? 'yes' : 'no';
                }

                function evaluateCrossUiHealth(state) {
                    const coverage = state && state.profileCoverage ? state.profileCoverage : {};
                    const evaluate = (cov) => {
                        const hasInput = !!(cov && cov.hasVisibleInput);
                        const hasSend = !!(cov && cov.hasVisibleSendButton);
                        const pending = Number((cov && cov.pendingAcceptButtons) || 0);
                        const ready = hasInput || hasSend || pending > 0;
                        return { ready, hasInput, hasSend, pending };
                    };

                    const profiles = {
                        vscode: evaluate(coverage.vscode),
                        antigravity: evaluate(coverage.antigravity),
                        cursor: evaluate(coverage.cursor)
                    };

                    const strict = {
                        vscodeTextReady: !!profiles.vscode.hasInput,
                        vscodeButtonReady: !!profiles.vscode.hasSend || profiles.vscode.pending > 0,
                        antigravityTextReady: !!profiles.antigravity.hasInput,
                        antigravityButtonReady: !!profiles.antigravity.hasSend || profiles.antigravity.pending > 0
                    };

                    const scoreParts = {
                        vscodeCoverage: profiles.vscode.ready ? 30 : 0,
                        antigravityCoverage: profiles.antigravity.ready ? 30 : 0,
                        activeRuntimeSignal: (state && state.status && state.status !== 'unknown' && state.status !== 'stopped') ? 20 : 0,
                        waitingDetection: (state && typeof state.waitingForChatMessage === 'boolean') ? 10 : 0,
                        cursorBonus: profiles.cursor.ready ? 10 : 0
                    };

                    const score = Object.values(scoreParts).reduce((a, b) => a + b, 0);
                    const strictPass = strict.vscodeTextReady && strict.vscodeButtonReady && strict.antigravityTextReady && strict.antigravityButtonReady;
                    const scorePass = score >= autoResumeMinScore;
                    const allowed = scorePass && (!autoResumeRequireStrict || strictPass);
                    const reasons = [];
                    if (!scorePass) reasons.push('score below min');
                    if (autoResumeRequireStrict && !strictPass) reasons.push('strict primary not ready');

                    return {
                        score,
                        strictPass,
                        allowed,
                        reason: reasons.length ? reasons.join('; ') : 'ready',
                        minScore: autoResumeMinScore,
                        requireStrict: autoResumeRequireStrict
                    };
                }

                function updateRuntimeUi(state) {
                    const chip = document.getElementById('runtimeStatusChip');
                    const mode = document.getElementById('runtimeMode');
                    const idle = document.getElementById('runtimeIdle');
                    const tabs = document.getElementById('runtimeTabs');
                    const pending = document.getElementById('runtimePending');
                    const waiting = document.getElementById('runtimeWaiting');
                    const updated = document.getElementById('runtimeUpdated');
                    const stateDuration = document.getElementById('runtimeStateDuration');
                    const waitingSinceEl = document.getElementById('runtimeWaitingSince');
                    const coverageActive = document.getElementById('runtimeCoverageActive');
                    const coverageVSCode = document.getElementById('runtimeCoverageVSCode');
                    const coverageAntigravity = document.getElementById('runtimeCoverageAntigravity');
                    const coverageCursor = document.getElementById('runtimeCoverageCursor');
                    const guardScore = document.getElementById('runtimeGuardScore');
                    const guardStrict = document.getElementById('runtimeGuardStrict');
                    const guardAllowed = document.getElementById('runtimeGuardAllowed');
                    const guardReason = document.getElementById('runtimeGuardReason');

                    function coverageText(cov) {
                        if (!cov) return '-';
                        return 'input:' + yesNo(!!cov.hasVisibleInput) + ', send:' + yesNo(!!cov.hasVisibleSendButton) + ', pending:' + (cov.pendingAcceptButtons ?? 0);
                    }

                    if (!state) {
                        chip.className = 'runtime-chip unknown';
                        chip.textContent = 'UNAVAILABLE';
                        mode.textContent = '-';
                        idle.textContent = '-';
                        tabs.textContent = '-';
                        pending.textContent = '-';
                        waiting.textContent = '-';
                        updated.textContent = new Date().toLocaleTimeString();
                        stateDuration.textContent = '-';
                        waitingSinceEl.textContent = '-';
                        coverageActive.textContent = '-';
                        coverageVSCode.textContent = '-';
                        coverageAntigravity.textContent = '-';
                        coverageCursor.textContent = '-';
                        guardScore.textContent = '-';
                        guardStrict.textContent = '-';
                        guardAllowed.textContent = '-';
                        guardReason.textContent = '-';
                        renderRuntimeHistory();
                        return;
                    }

                    const status = String(state.status || 'unknown');
                    const ts = state.timestamp || Date.now();

                    if (currentStatus !== status) {
                        currentStatus = status;
                        currentStatusSince = ts;
                        pushRuntimeHistory(status, ts);
                    }

                    if (status === 'waiting_for_chat_message') {
                        if (!waitingSince) waitingSince = ts;
                    } else {
                        waitingSince = null;
                    }

                    chip.className = 'runtime-chip ' + runtimeClassForStatus(status);
                    chip.textContent = status.toUpperCase();
                    mode.textContent = state.mode || '-';
                    idle.textContent = yesNo(!!state.isIdle);
                    tabs.textContent = (state.doneTabs ?? 0) + ' / ' + (state.totalTabs ?? 0);
                    pending.textContent = String(state.pendingAcceptButtons ?? 0);
                    waiting.textContent = yesNo(!!state.waitingForChatMessage);
                    updated.textContent = new Date(ts).toLocaleTimeString();
                    stateDuration.textContent = formatDurationMs(ts - (currentStatusSince || ts));
                    waitingSinceEl.textContent = waitingSince ? new Date(waitingSince).toLocaleTimeString() : '-';
                    const profileCoverage = state.profileCoverage || {};
                    coverageActive.textContent = coverageText(profileCoverage[state.mode || ''] || null);
                    coverageVSCode.textContent = coverageText(profileCoverage.vscode || null);
                    coverageAntigravity.textContent = coverageText(profileCoverage.antigravity || null);
                    coverageCursor.textContent = coverageText(profileCoverage.cursor || null);
                    const guard = evaluateCrossUiHealth(state);
                    guardScore.textContent = guard.score + ' / 100 (min ' + guard.minScore + ')';
                    guardStrict.textContent = yesNo(guard.strictPass) + (guard.requireStrict ? ' (required)' : ' (optional)');
                    guardAllowed.textContent = guard.allowed ? 'allow' : 'block';
                    guardReason.textContent = guard.reason;
                    renderRuntimeHistory();
                }

                function requestRuntimeState() {
                    vscode.postMessage({ command: 'requestRuntimeState' });
                }

                function runCommand(id) {
                    vscode.postMessage({ command: 'runCommand', id });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (!message || message.command !== 'runtimeStateUpdate') return;
                    updateRuntimeUi(message.state || null);
                });

                requestRuntimeState();
                setInterval(requestRuntimeState, 3000);
            </script>
        </body>
        </html>`;
    }
}
