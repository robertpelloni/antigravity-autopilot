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
                .runtime-chip.escalation-armed { background: rgba(245,158,11,0.28); color: #fde68a; }
                .runtime-chip.escalation-idle { background: rgba(107,114,128,0.25); color: #d1d5db; }
                .runtime-chip.watchdog-running { background: rgba(59,130,246,0.28); color: #bfdbfe; }
                .runtime-chip.watchdog-idle { background: rgba(107,114,128,0.25); color: #d1d5db; }
                .runtime-chip.event-armed { background: rgba(245,158,11,0.28); color: #fde68a; }
                .runtime-chip.event-suppressed { background: rgba(239,68,68,0.25); color: #fecaca; }
                .runtime-chip.event-reset { background: rgba(107,114,128,0.25); color: #d1d5db; }
                .runtime-chip.event-consumed { background: rgba(34,197,94,0.25); color: #86efac; }
                .runtime-chip.event-none { background: rgba(75,85,99,0.25); color: #e5e7eb; }
                .runtime-chip.telemetry-fresh { background: rgba(34,197,94,0.25); color: #86efac; }
                .runtime-chip.telemetry-stale { background: rgba(239,68,68,0.25); color: #fecaca; }
                .runtime-legend { margin-top: 8px; display:flex; flex-wrap: wrap; gap: 8px; align-items: center; }
                .runtime-legend .runtime-chip { font-size: 11px; }
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
                    <div><strong>Telemetry:</strong> <span id="runtimeTelemetryFreshness" class="runtime-chip telemetry-fresh" title="Freshness is computed from current time minus runtime state timestamp">FRESH</span></div>
                    <div><strong>Tabs:</strong> <span id="runtimeTabs" class="muted">-</span></div>
                    <div><strong>Pending Accept:</strong> <span id="runtimePending" class="muted">-</span></div>
                    <div><strong>Waiting Chat:</strong> <span id="runtimeWaiting" class="muted">-</span></div>
                    <div><strong>Updated:</strong> <span id="runtimeUpdated" class="muted">-</span></div>
                    <div><strong>Telemetry Age:</strong> <span id="runtimeTelemetryAge" class="muted">-</span></div>
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
                    <div><strong>Next Eligible:</strong> <span id="runtimeNextEligible" class="muted">-</span></div>
                    <div><strong>Cooldown Left:</strong> <span id="runtimeCooldownLeft" class="muted">-</span></div>
                    <div><strong>Delay Left:</strong> <span id="runtimeDelayLeft" class="muted">-</span></div>
                    <div><strong>Last Resume Outcome:</strong> <span id="runtimeLastResumeOutcome" class="muted">-</span></div>
                    <div><strong>Recommended Next:</strong> <span id="runtimeRecommendedNext" class="muted">-</span></div>
                    <div><strong>Ready To Resume:</strong> <span id="runtimeReadyToResume" class="muted">-</span></div>
                    <div><strong>Completion Confidence:</strong> <span id="runtimeCompletionConfidence" class="muted">-</span></div>
                    <div><strong>Completion Reasoning:</strong> <span id="runtimeCompletionReasoning" class="muted">-</span></div>
                    <div><strong>Ready Streak:</strong> <span id="runtimeReadyStreak" class="muted">-</span></div>
                    <div><strong>Last Message Kind:</strong> <span id="runtimeLastMessageKind" class="muted">-</span></div>
                    <div><strong>Last Message Profile:</strong> <span id="runtimeLastMessageProfile" class="muted">-</span></div>
                    <div><strong>Last Message Preview:</strong> <span id="runtimeLastMessagePreview" class="muted">-</span></div>
                    <div><strong>Watchdog State:</strong> <span id="runtimeWatchdogState" class="runtime-chip watchdog-idle">IDLE</span></div>
                    <div><strong>Watchdog Last Run:</strong> <span id="runtimeWatchdogLastRun" class="muted">-</span></div>
                    <div><strong>Watchdog Outcome:</strong> <span id="runtimeWatchdogOutcome" class="muted">-</span></div>
                    <div><strong>Escalation State:</strong> <span id="runtimeWatchdogEscalationArmed" class="runtime-chip escalation-idle">IDLE</span></div>
                    <div><strong>Escalation Fail Streak:</strong> <span id="runtimeWatchdogEscalationStreak" class="muted">-</span></div>
                    <div><strong>Escalation Cooldown Left:</strong> <span id="runtimeWatchdogEscalationCooldownLeft" class="muted">-</span></div>
                    <div><strong>Escalation Next Eligible:</strong> <span id="runtimeWatchdogEscalationNextEligible" class="muted">-</span></div>
                    <div><strong>Last Escalation Event:</strong> <span id="runtimeWatchdogEscalationLastEvent" class="runtime-chip event-none">NONE</span></div>
                    <div><strong>Escalation Last Trigger:</strong> <span id="runtimeWatchdogEscalationLast" class="muted">-</span></div>
                    <div><strong>Escalation Reason:</strong> <span id="runtimeWatchdogEscalationReason" class="muted">-</span></div>
                    <div><strong>Escalation Events:</strong> <span id="runtimeWatchdogEscalationEvents" class="muted">-</span></div>
                </div>
                <div style="margin-top:10px;display:flex;gap:8px;">
                    <button onclick="requestRuntimeState()">Refresh Runtime State</button>
                    <button onclick="runCommand('antigravity.detectCompletionWaitingState')">Detect Completion + Waiting</button>
                    <button onclick="runCommand('antigravity.runCrossUiSelfTest')">Run Cross-UI Self-Test</button>
                    <button onclick="runCommand('antigravity.autoFixAutoResumeReadiness')">Auto-Fix Resume Readiness</button>
                    <button onclick="runCommand('antigravity.copyLastResumePayloadReport')">Copy Last Resume Payload</button>
                    <button onclick="runCommand('antigravity.copyEscalationDiagnosticsReport')">Copy Escalation Diagnostics</button>
                    <button onclick="runCommand('antigravity.copyEscalationHealthSummary')">Copy Escalation Health</button>
                    <button onclick="runCommand('antigravity.clearEscalationTimeline')">Clear Escalation Timeline</button>
                </div>
                <div class="runtime-legend">
                    <span class="muted">Legend:</span>
                    <span class="runtime-chip escalation-armed">Escalation ARMED</span>
                    <span class="runtime-chip escalation-idle">Escalation IDLE</span>
                    <span class="runtime-chip watchdog-running">Watchdog RUNNING</span>
                    <span class="runtime-chip watchdog-idle">Watchdog IDLE</span>
                    <span class="runtime-chip event-armed">Event ARMED</span>
                    <span class="runtime-chip event-suppressed">Event SUPPRESSED</span>
                    <span class="runtime-chip event-consumed">Event CONSUMED</span>
                    <span class="runtime-chip event-reset">Event RESET</span>
                    <span class="runtime-chip telemetry-fresh">Telemetry FRESH</span>
                    <span class="runtime-chip telemetry-stale">Telemetry STALE</span>
                </div>
                <p class="muted" title="Computed from Date.now() - runtime timestamp">Telemetry is marked <strong>STALE</strong> when telemetry age exceeds the configured stale threshold.</p>
                <div class="runtime-history" id="runtimeHistory"></div>
            </div>
            
            <!-- STRATEGIES -->
            <div class="card">
                <h2>Unified Autopilot Controls</h2>
                <div class="setting">
                    <label>Current Strategy:</label>
                    <select onchange="updateConfig('strategy', this.value)">
                        <option value="simple" ${settings.strategy === 'simple' ? 'selected' : ''}>Simple (Commands)</option>
                        <option value="cdp" ${settings.strategy === 'cdp' ? 'selected' : ''}>CDP (Browser Protocol)</option>
                    </select>
                </div>
                <div class="setting">
                    <label>Auto Accept:</label>
                    <input type="checkbox" ${settings.autopilotAutoAcceptEnabled ? 'checked' : ''} onchange="updateUnifiedAutoAccept(this.checked)">
                </div>
                <div class="setting">
                    <label>Auto Bump:</label>
                    <input type="checkbox" ${settings.autopilotAutoBumpEnabled ? 'checked' : ''} onchange="updateConfig('autopilotAutoBumpEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Run / Expand / Continue:</label>
                    <input type="checkbox" ${settings.autopilotRunExpandContinueEnabled ? 'checked' : ''} onchange="updateConfig('autopilotRunExpandContinueEnabled', this.checked)">
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
                <div class="setting">
                    <label>Max Calls/Hour:</label>
                    <input type="number" value="${settings.maxCallsPerHour}" min="1" onchange="updateConfig('maxCallsPerHour', parseInt(this.value))">
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
                    <label>Auto-Accept Poll (ms):</label>
                    <input type="number" value="${settings.autoAcceptPollIntervalMs}" min="100" max="10000" onchange="updateUnifiedPollInterval(parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Auto-Bump Cooldown (s):</label>
                    <input type="number" value="${settings.autoBumpCooldownSec}" min="1" max="3600" onchange="updateUnifiedBumpCooldown(parseInt(this.value))">
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
                    <label>Legacy Poll Frequency (ms):</label>
                    <input type="number" value="${settings.pollFrequency}" onchange="updateConfig('pollFrequency', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Legacy Auto-Approve Delay (s):</label>
                    <input type="number" value="${settings.autoApproveDelay}" onchange="updateConfig('autoApproveDelay', parseInt(this.value))">
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
                    <label>Use Minimal Continue:</label>
                    <input type="checkbox" ${settings.runtimeAutoResumeUseMinimalContinue ? 'checked' : ''} onchange="updateConfig('runtimeAutoResumeUseMinimalContinue', this.checked)">
                </div>
                <div class="setting">
                    <label>Auto Resume Cooldown (s):</label>
                    <input type="number" value="${settings.runtimeAutoResumeCooldownSec}" min="5" max="7200" onchange="updateConfig('runtimeAutoResumeCooldownSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Auto Resume Stability Polls:</label>
                    <input type="number" value="${settings.runtimeAutoResumeStabilityPolls}" min="1" max="10" onchange="updateConfig('runtimeAutoResumeStabilityPolls', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Waiting Watchdog:</label>
                    <input type="checkbox" ${settings.runtimeAutoFixWaitingEnabled ? 'checked' : ''} onchange="updateConfig('runtimeAutoFixWaitingEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Watchdog Delay (s):</label>
                    <input type="number" value="${settings.runtimeAutoFixWaitingDelaySec}" min="5" max="7200" onchange="updateConfig('runtimeAutoFixWaitingDelaySec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Watchdog Cooldown (s):</label>
                    <input type="number" value="${settings.runtimeAutoFixWaitingCooldownSec}" min="5" max="7200" onchange="updateConfig('runtimeAutoFixWaitingCooldownSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Watchdog Escalation:</label>
                    <input type="checkbox" ${settings.runtimeAutoFixWaitingEscalationEnabled ? 'checked' : ''} onchange="updateConfig('runtimeAutoFixWaitingEscalationEnabled', this.checked)">
                </div>
                <div class="setting">
                    <label>Escalation Threshold:</label>
                    <input type="number" value="${settings.runtimeAutoFixWaitingEscalationThreshold}" min="1" max="10" onchange="updateConfig('runtimeAutoFixWaitingEscalationThreshold', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Escalation Cooldown (s):</label>
                    <input type="number" value="${settings.runtimeAutoFixWaitingEscalationCooldownSec}" min="5" max="14400" onchange="updateConfig('runtimeAutoFixWaitingEscalationCooldownSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Escalation Max Events:</label>
                    <input type="number" value="${settings.runtimeAutoFixWaitingEscalationMaxEvents}" min="3" max="100" onchange="updateConfig('runtimeAutoFixWaitingEscalationMaxEvents', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Confirm Timeline Clear:</label>
                    <input type="checkbox" ${settings.runtimeEscalationClearRequireConfirm ? 'checked' : ''} onchange="updateConfig('runtimeEscalationClearRequireConfirm', this.checked)">
                </div>
                <div class="setting">
                    <label>Telemetry Stale Threshold (s):</label>
                    <input type="number" value="${settings.runtimeTelemetryStaleSec}" min="3" max="300" onchange="updateConfig('runtimeTelemetryStaleSec', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Status Refresh Debounce (ms):</label>
                    <input type="number" value="${settings.runtimeStatusMenuRefreshDebounceMs}" min="100" max="5000" onchange="updateConfig('runtimeStatusMenuRefreshDebounceMs', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Status Refresh Debug Logs:</label>
                    <input type="checkbox" ${settings.runtimeStatusMenuRefreshDebugLogs ? 'checked' : ''} onchange="updateConfig('runtimeStatusMenuRefreshDebugLogs', this.checked)">
                </div>
                <p class="muted" style="margin-top:-6px;">Stale logic: <code>telemetryAgeSec &gt; runtimeTelemetryStaleSec</code> using runtime state <code>timestamp</code>.</p>
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
                <div class="setting vertical">
                    <label>Minimal Continue Message:</label>
                    <textarea onchange="updateConfig('runtimeAutoResumeMinimalMessage', this.value)">${settings.runtimeAutoResumeMinimalMessage || ''}</textarea>
                </div>
                <div class="setting vertical">
                    <label>Minimal Continue (VS Code):</label>
                    <textarea onchange="updateConfig('runtimeAutoResumeMinimalMessageVSCode', this.value)">${settings.runtimeAutoResumeMinimalMessageVSCode || ''}</textarea>
                </div>
                <div class="setting vertical">
                    <label>Minimal Continue (Antigravity):</label>
                    <textarea onchange="updateConfig('runtimeAutoResumeMinimalMessageAntigravity', this.value)">${settings.runtimeAutoResumeMinimalMessageAntigravity || ''}</textarea>
                </div>
                <div class="setting vertical">
                    <label>Minimal Continue (Cursor):</label>
                    <textarea onchange="updateConfig('runtimeAutoResumeMinimalMessageCursor', this.value)">${settings.runtimeAutoResumeMinimalMessageCursor || ''}</textarea>
                </div>
                 <div class="setting">
                     <label>Max Loops/Session:</label>
                     <input type="number" value="${settings.maxLoopsPerSession}" onchange="updateConfig('maxLoopsPerSession', parseInt(this.value))">
                </div>
                 <div class="setting">
                     <label>Execution Timeout (min):</label>
                     <input type="number" value="${settings.executionTimeout}" onchange="updateConfig('executionTimeout', parseInt(this.value))">
                </div>
                <div class="setting">
                    <label>Max Consecutive Test Loops:</label>
                    <input type="number" value="${settings.maxConsecutiveTestLoops}" min="1" max="10" onchange="updateConfig('maxConsecutiveTestLoops', parseInt(this.value))">
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
                <div class="setting vertical">
                    <label>Interaction Timings (JSON):</label>
                    <textarea onchange="updateConfig('interactionTimings', parseInteractionTimings(this.value))">${JSON.stringify(settings.interactionTimings || {}, null, 2)}</textarea>
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

                function updateUnifiedAutoAccept(enabled) {
                    updateConfig('autopilotAutoAcceptEnabled', enabled);
                    updateConfig('autoAcceptEnabled', enabled);
                    updateConfig('autoAllEnabled', enabled);
                }

                function updateUnifiedPollInterval(value) {
                    const sanitized = Number.isFinite(value) ? Math.max(100, Math.min(10000, value)) : 1000;
                    updateConfig('autoAcceptPollIntervalMs', sanitized);
                    updateConfig('pollFrequency', sanitized);
                }

                function updateUnifiedBumpCooldown(value) {
                    const sanitized = Number.isFinite(value) ? Math.max(1, Math.min(3600, value)) : 30;
                    updateConfig('autoBumpCooldownSec', sanitized);
                    updateConfig('autoApproveDelay', sanitized);
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

                function parseInteractionTimings(raw) {
                    try {
                        if (!raw || !raw.trim()) return {};
                        const parsed = JSON.parse(raw);
                        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
                    } catch {
                        return {};
                    }
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
                const telemetryStaleSec = Number(${settings.runtimeTelemetryStaleSec ?? 12});
                const autoResumeMinScore = Number(${settings.runtimeAutoResumeMinScore ?? 70});
                const autoResumeRequireStrict = ${settings.runtimeAutoResumeRequireStrictPrimary ? 'true' : 'false'};

                function formatDurationMs(ms) {
                    if (ms === null || ms === undefined || ms < 0) return '-';
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

                function escalationEventChipClass(eventName) {
                    const normalized = String(eventName || '').toLowerCase();
                    if (normalized === 'armed') return 'event-armed';
                    if (normalized === 'suppressed') return 'event-suppressed';
                    if (normalized === 'consumed') return 'event-consumed';
                    if (normalized === 'reset') return 'event-reset';
                    return 'event-none';
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
                    const telemetryFreshness = document.getElementById('runtimeTelemetryFreshness');
                    const tabs = document.getElementById('runtimeTabs');
                    const pending = document.getElementById('runtimePending');
                    const waiting = document.getElementById('runtimeWaiting');
                    const updated = document.getElementById('runtimeUpdated');
                    const telemetryAge = document.getElementById('runtimeTelemetryAge');
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
                    const nextEligible = document.getElementById('runtimeNextEligible');
                    const cooldownLeft = document.getElementById('runtimeCooldownLeft');
                    const delayLeft = document.getElementById('runtimeDelayLeft');
                    const lastResumeOutcome = document.getElementById('runtimeLastResumeOutcome');
                    const recommendedNext = document.getElementById('runtimeRecommendedNext');
                    const readyToResume = document.getElementById('runtimeReadyToResume');
                    const completionConfidence = document.getElementById('runtimeCompletionConfidence');
                    const completionReasoning = document.getElementById('runtimeCompletionReasoning');
                    const readyStreak = document.getElementById('runtimeReadyStreak');
                    const lastMessageKind = document.getElementById('runtimeLastMessageKind');
                    const lastMessageProfile = document.getElementById('runtimeLastMessageProfile');
                    const lastMessagePreview = document.getElementById('runtimeLastMessagePreview');
                    const watchdogState = document.getElementById('runtimeWatchdogState');
                    const watchdogLastRun = document.getElementById('runtimeWatchdogLastRun');
                    const watchdogOutcome = document.getElementById('runtimeWatchdogOutcome');
                    const watchdogEscalationArmed = document.getElementById('runtimeWatchdogEscalationArmed');
                    const watchdogEscalationStreak = document.getElementById('runtimeWatchdogEscalationStreak');
                    const watchdogEscalationCooldownLeft = document.getElementById('runtimeWatchdogEscalationCooldownLeft');
                    const watchdogEscalationNextEligible = document.getElementById('runtimeWatchdogEscalationNextEligible');
                    const watchdogEscalationLastEvent = document.getElementById('runtimeWatchdogEscalationLastEvent');
                    const watchdogEscalationLast = document.getElementById('runtimeWatchdogEscalationLast');
                    const watchdogEscalationReason = document.getElementById('runtimeWatchdogEscalationReason');
                    const watchdogEscalationEvents = document.getElementById('runtimeWatchdogEscalationEvents');

                    function coverageText(cov) {
                        if (!cov) return '-';
                        return 'input:' + yesNo(!!cov.hasVisibleInput) + ', send:' + yesNo(!!cov.hasVisibleSendButton) + ', pending:' + (cov.pendingAcceptButtons ?? 0);
                    }

                    if (!state) {
                        chip.className = 'runtime-chip unknown';
                        chip.textContent = 'UNAVAILABLE';
                        mode.textContent = '-';
                        idle.textContent = '-';
                        telemetryFreshness.textContent = 'STALE';
                        telemetryFreshness.className = 'runtime-chip telemetry-stale';
                        tabs.textContent = '-';
                        pending.textContent = '-';
                        waiting.textContent = '-';
                        updated.textContent = new Date().toLocaleTimeString();
                        telemetryAge.textContent = '-';
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
                        nextEligible.textContent = '-';
                        cooldownLeft.textContent = '-';
                        delayLeft.textContent = '-';
                        lastResumeOutcome.textContent = '-';
                        recommendedNext.textContent = '-';
                        readyToResume.textContent = '-';
                        completionConfidence.textContent = '-';
                        completionReasoning.textContent = '-';
                        readyStreak.textContent = '-';
                        lastMessageKind.textContent = '-';
                        lastMessageProfile.textContent = '-';
                        lastMessagePreview.textContent = '-';
                        watchdogState.textContent = 'IDLE';
                        watchdogState.className = 'runtime-chip watchdog-idle';
                        watchdogLastRun.textContent = '-';
                        watchdogOutcome.textContent = '-';
                        watchdogEscalationArmed.textContent = '-';
                        watchdogEscalationArmed.className = 'runtime-chip escalation-idle';
                        watchdogEscalationStreak.textContent = '-';
                        watchdogEscalationCooldownLeft.textContent = '-';
                        watchdogEscalationNextEligible.textContent = '-';
                        watchdogEscalationLastEvent.textContent = 'NONE';
                        watchdogEscalationLastEvent.className = 'runtime-chip event-none';
                        watchdogEscalationLast.textContent = '-';
                        watchdogEscalationReason.textContent = '-';
                        watchdogEscalationEvents.textContent = '-';
                        renderRuntimeHistory();
                        return;
                    }

                    const status = String(state.status || 'unknown');
                    const ts = state.timestamp || Date.now();
                    const telemetryAgeMs = Math.max(0, Date.now() - ts);
                    const isTelemetryStale = telemetryAgeMs > (Math.max(3, telemetryStaleSec) * 1000);

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
                    telemetryFreshness.textContent = isTelemetryStale ? 'STALE' : 'FRESH';
                    telemetryFreshness.className = 'runtime-chip ' + (isTelemetryStale ? 'telemetry-stale' : 'telemetry-fresh');
                    tabs.textContent = (state.doneTabs ?? 0) + ' / ' + (state.totalTabs ?? 0);
                    pending.textContent = String(state.pendingAcceptButtons ?? 0);
                    waiting.textContent = yesNo(!!state.waitingForChatMessage);
                    updated.textContent = new Date(ts).toLocaleTimeString();
                    telemetryAge.textContent = formatDurationMs(telemetryAgeMs);
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

                    const host = state.hostTelemetry || null;
                    const timing = host && host.timing ? host.timing : null;
                    nextEligible.textContent = timing && timing.nextEligibleAt ? new Date(timing.nextEligibleAt).toLocaleTimeString() : '-';
                    cooldownLeft.textContent = timing ? formatDurationMs(timing.cooldownRemainingMs || 0) : '-';
                    delayLeft.textContent = timing ? formatDurationMs(timing.waitingDelayRemainingMs || 0) : '-';
                    lastResumeOutcome.textContent = host ? ((host.lastAutoResumeOutcome || 'none') + (host.lastAutoResumeBlockedReason && host.lastAutoResumeBlockedReason !== 'none' ? ' (' + host.lastAutoResumeBlockedReason + ')' : '')) : '-';
                    recommendedNext.textContent = (host && host.guard && host.guard.recommendedNextAction)
                        ? ('(' + (host.guard.recommendedNextActionConfidence || 'n/a') + ') ' + host.guard.recommendedNextAction)
                        : '-';

                    const completion = state.completionWaiting || null;
                    readyToResume.textContent = completion ? yesNo(!!completion.readyToResume) : '-';
                    completionConfidence.textContent = completion
                        ? ((completion.confidence ?? '-') + ' (' + (completion.confidenceLabel || 'n/a') + ')')
                        : '-';
                    completionReasoning.textContent = completion && Array.isArray(completion.reasons)
                        ? completion.reasons.slice(0, 2).join('; ')
                        : '-';
                    readyStreak.textContent = host
                        ? ((host.readyToResumeStreak ?? 0) + ' / ' + (host.stablePollsRequired ?? '-'))
                        : '-';
                    lastMessageKind.textContent = host?.lastAutoResumeMessageKind || '-';
                    lastMessageProfile.textContent = host?.lastAutoResumeMessageProfile || '-';
                    lastMessagePreview.textContent = host?.lastAutoResumeMessagePreview || '-';
                    const watchdogRunning = !!host?.autoFixWatchdogInProgress;
                    watchdogState.textContent = watchdogRunning ? 'RUNNING' : 'IDLE';
                    watchdogState.className = 'runtime-chip ' + (watchdogRunning ? 'watchdog-running' : 'watchdog-idle');
                    watchdogLastRun.textContent = host?.lastAutoFixWatchdogAt ? new Date(host.lastAutoFixWatchdogAt).toLocaleTimeString() : '-';
                    watchdogOutcome.textContent = host?.lastAutoFixWatchdogOutcome || '-';
                    const escalationArmed = !!host?.watchdogEscalationForceFullNext;
                    watchdogEscalationArmed.textContent = escalationArmed ? 'ARMED' : 'IDLE';
                    watchdogEscalationArmed.className = 'runtime-chip ' + (escalationArmed ? 'escalation-armed' : 'escalation-idle');
                    watchdogEscalationStreak.textContent = host ? String(host.watchdogEscalationConsecutiveFailures ?? 0) : '-';
                    watchdogEscalationCooldownLeft.textContent = host ? formatDurationMs(host.escalationCooldownRemainingMs || 0) : '-';
                    watchdogEscalationNextEligible.textContent = host?.escalationNextEligibleAt ? new Date(host.escalationNextEligibleAt).toLocaleTimeString() : '-';
                    const lastEscalationEventName = Array.isArray(host?.watchdogEscalationEvents) && host.watchdogEscalationEvents.length > 0
                        ? String(host.watchdogEscalationEvents[0].event || 'none').toUpperCase()
                        : 'NONE';
                    watchdogEscalationLastEvent.textContent = lastEscalationEventName;
                    watchdogEscalationLastEvent.className = 'runtime-chip ' + escalationEventChipClass(lastEscalationEventName);
                    watchdogEscalationLast.textContent = host?.lastWatchdogEscalationAt ? new Date(host.lastWatchdogEscalationAt).toLocaleTimeString() : '-';
                    watchdogEscalationReason.textContent = host?.lastWatchdogEscalationReason || '-';
                    watchdogEscalationEvents.textContent = Array.isArray(host?.watchdogEscalationEvents) && host.watchdogEscalationEvents.length > 0
                        ? host.watchdogEscalationEvents
                            .slice(0, 4)
                            .map(e => (new Date(e.at).toLocaleTimeString() + ' ' + String(e.event || 'event') + ': ' + String(e.detail || '')))
                            .join(' | ')
                        : '-';
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
