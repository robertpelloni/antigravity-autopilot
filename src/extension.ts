import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DashboardPanel } from './ui/dashboard';
import { config } from './utils/config';
import { createLogger } from './utils/logger';
import { StatusBarManager } from './ui/status-bar';
import { CDPStrategy } from './strategies/cdp-strategy';
import { ControllerLease } from './core/controller-lease';
import { diagnoseCdp } from './commands/diagnose-cdp';
import { logToOutput } from './utils/output-channel';

/**
 * v8.0.0 — Radically simplified extension entry point.
 *
 * All autopilot logic (button clicking, bump sending, stall detection)
 * lives in CDPStrategy. This file only wires up:
 * 1. Controller lease (leader election)
 * 2. Status bar
 * 3. CDPStrategy start/stop
 * 4. A handful of commands
 */

const log = createLogger('Extension');
let statusBar: StatusBarManager;
let controllerLease: ControllerLease | null = null;
let currentWindowAutomationDisabled = false;

function safeRegisterCommand(commandId: string, callback: (...args: any[]) => any): vscode.Disposable {
    try {
        return vscode.commands.registerCommand(commandId, callback);
    } catch {
        return { dispose: () => { } };
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        const debugDumpPath = path.join(os.homedir() || os.tmpdir(), 'antigravity-activation.log');
        fs.appendFileSync(debugDumpPath, `\n[${new Date().toISOString()}] Extension activate called\n`);

        vscode.window.showInformationMessage('Antigravity Unified: Activation Started!');
        log.info('Antigravity Autopilot (Unified) activating...');

        // ─── STATUS BAR ───
        statusBar = new StatusBarManager(context);

        // ─── CONTROLLER LEASE (leader election) ───
        const getWorkspaceId = (): string =>
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            || vscode.workspace.workspaceFile?.fsPath
            || 'no-workspace';

        const leaseOwnerId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        controllerLease = new ControllerLease(leaseOwnerId, getWorkspaceId());
        controllerLease.start();
        context.subscriptions.push({ dispose: () => { controllerLease?.stop(); controllerLease = null; } });

        const isLeader = () => !!controllerLease?.isLeader();
        const updateLeaderStatus = () => {
            const leader = controllerLease?.getLeaderInfo();
            statusBar.updateControllerRole(isLeader(), leader?.workspace || null);
        };
        updateLeaderStatus();

        // ─── CDP STRATEGY (all autopilot logic lives here) ───
        const cdpStrategy = new CDPStrategy(context);
        context.subscriptions.push({ dispose: () => cdpStrategy.dispose() });

        // Sync leader role to strategy
        const syncLeaderRole = () => {
            updateLeaderStatus();
            const effectiveLeader = isLeader() && !currentWindowAutomationDisabled;
            cdpStrategy.setControllerRole(effectiveLeader);
            cdpStrategy.setWindowAutomationEnabled(!currentWindowAutomationDisabled);
        };

        // Start strategy
        const isEnabled = () =>
            !!config.get<boolean>('autopilotAutoAcceptEnabled')
            || !!config.get<boolean>('autoAllEnabled')
            || !!config.get<boolean>('autoAcceptEnabled');

        if (isEnabled()) {
            void cdpStrategy.start();
            syncLeaderRole();
            log.info('Antigravity Autopilot: Brain ACTIVE as controller leader.');
        }

        DashboardPanel.setRuntimeStateProvider(async () => cdpStrategy.getDashboardSnapshot());

        // Update status bar
        const refreshStatusBar = () => {
            statusBar.update({
                autoAllEnabled: isEnabled(),
                multiTabEnabled: false,
                autonomousEnabled: false,
                loopCount: 0,
                mode: isEnabled() ? 'cdp' : 'off',
            });
        };
        refreshStatusBar();

        // Poll leader role every 5s
        const leaseTimer = setInterval(() => { syncLeaderRole(); refreshStatusBar(); }, 5000);
        context.subscriptions.push({ dispose: () => clearInterval(leaseTimer) });

        // Track window focus for CDP
        const focusDisp = vscode.window.onDidChangeWindowState(e => {
            cdpStrategy.setHostWindowFocused(e.focused);
        });
        context.subscriptions.push(focusDisp);

        // ─── COMMANDS ───

        // Toggle ON/OFF
        context.subscriptions.push(safeRegisterCommand('antigravity.toggleAutoAccept', async () => {
            if (cdpStrategy.isActive) {
                await cdpStrategy.stop();
                vscode.window.showInformationMessage('Antigravity: OFF');
            } else {
                await cdpStrategy.start();
                syncLeaderRole();
                vscode.window.showInformationMessage('Antigravity: ON');
            }
            refreshStatusBar();
        }));

        // Aliases for toggle
        const toggleAlias = async () => vscode.commands.executeCommand('antigravity.toggleAutoAccept');
        context.subscriptions.push(safeRegisterCommand('antigravity.toggleExtension', toggleAlias));
        context.subscriptions.push(safeRegisterCommand('antigravity.toggleAutoAll', toggleAlias));
        context.subscriptions.push(safeRegisterCommand('antigravity.toggleAutonomous', toggleAlias));
        context.subscriptions.push(safeRegisterCommand('antigravity.toggleMasterControl', toggleAlias));
        context.subscriptions.push(safeRegisterCommand('antigravity.enableMaximumAutopilot', async () => {
            if (!cdpStrategy.isActive) await cdpStrategy.start();
            syncLeaderRole();
            refreshStatusBar();
            vscode.window.showInformationMessage('Antigravity: Maximum Autopilot ON');
        }));
        context.subscriptions.push(safeRegisterCommand('antigravity.panicStop', async () => {
            await cdpStrategy.stop();
            refreshStatusBar();
            vscode.window.showInformationMessage('Antigravity: EMERGENCY STOP — All autonomy disabled');
        }));

        // Dashboard
        context.subscriptions.push(safeRegisterCommand('antigravity.openSettings', () => {
            DashboardPanel.createOrShow(context.extensionUri);
        }));

        context.subscriptions.push(safeRegisterCommand('antigravity.toggleCurrentWindowAutomationDisable', async () => {
            currentWindowAutomationDisabled = !currentWindowAutomationDisabled;
            syncLeaderRole();
            refreshStatusBar();
            const stateLabel = currentWindowAutomationDisabled ? 'DISABLED' : 'ENABLED';
            vscode.window.showInformationMessage(`Antigravity: Current window automation ${stateLabel}`);
        }));

        context.subscriptions.push(safeRegisterCommand('antigravity.testMethod', async (payload?: any) => {
            const methodName = typeof payload === 'string'
                ? payload
                : String(payload?.method || payload?.id || '').trim();
            const text = typeof payload === 'object' ? String(payload?.text || '') : '';
            logToOutput(`[TestMethodCmd] request method=${methodName || 'missing'} text="${text}"`);
            if (!methodName) {
                vscode.window.showWarningMessage('Antigravity: Missing test method id.');
                logToOutput('[TestMethodCmd] rejected: missing method id');
                return false;
            }

            const ok = await cdpStrategy.testMethod(methodName, text || undefined);
            logToOutput(`[TestMethodCmd] result method=${methodName} ok=${ok}`);
            vscode.window.showInformationMessage(`Antigravity test ${methodName}: ${ok ? 'OK' : 'MISS'}`);
            return ok;
        }));

        // Native settings
        context.subscriptions.push(safeRegisterCommand('antigravity.openExtensionSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:robertpelloni.antigravity-autopilot');
        }));

        // Force acquire leader
        context.subscriptions.push(safeRegisterCommand('antigravity.forceAcquireLeader', () => {
            controllerLease?.forceAcquire();
            syncLeaderRole();
            vscode.window.showInformationMessage('Antigravity: Forced leader acquisition');
        }));

        // Show controller lease state
        context.subscriptions.push(safeRegisterCommand('antigravity.showControllerLeaseState', () => {
            const debug = controllerLease?.getDebugState();
            vscode.window.showInformationMessage(JSON.stringify(debug, null, 2).substring(0, 500));
        }));

        // Diagnose CDP
        context.subscriptions.push(safeRegisterCommand('antigravity.diagnoseCdp', () => diagnoseCdp()));

        // Status menu (simplified)
        context.subscriptions.push(safeRegisterCommand('antigravity.showStatusMenu', async () => {
            const items = [
                { label: cdpStrategy.isActive ? '$(debug-stop) Turn OFF' : '$(play) Turn ON', id: 'toggle' },
                { label: '$(dashboard) Open Dashboard', id: 'dashboard' },
                { label: '$(gear) Extension Settings', id: 'settings' },
                { label: '$(plug) Diagnose CDP', id: 'cdp' },
                { label: '$(shield) Force Leader', id: 'leader' },
            ];
            const pick = await vscode.window.showQuickPick(items, { title: 'Antigravity Autopilot' });
            if (!pick) return;
            switch (pick.id) {
                case 'toggle': return vscode.commands.executeCommand('antigravity.toggleAutoAccept');
                case 'dashboard': return vscode.commands.executeCommand('antigravity.openSettings');
                case 'settings': return vscode.commands.executeCommand('antigravity.openExtensionSettings');
                case 'cdp': return vscode.commands.executeCommand('antigravity.diagnoseCdp');
                case 'leader': return vscode.commands.executeCommand('antigravity.forceAcquireLeader');
            }
        }));

        // ─── NO-OP stubs for remaining package.json commands (prevents "command not found") ───
        const noop = () => { };
        const noopCommands = [
            'antigravity.clickRun', 'antigravity.clickExpand', 'antigravity.clickAccept',
            'antigravity.resetConnection', 'antigravity.agent.acceptAgentStep',
            'antigravity.terminal.accept',
            'antigravity.checkSettingsSurfacesHealth', 'antigravity.generateTests',
            'antigravity.runCodeReview', 'antigravity.startMultiAgent',
            'antigravity.showMemory', 'antigravity.syncProjectTasks',
            'antigravity.checkRuntimeState', 'antigravity.detectCompletionWaitingState',
            'antigravity.copyRuntimeStateJson', 'antigravity.refreshRuntimeAndReopenStatusMenu',
            'antigravity.resetStatusRefreshCounters', 'antigravity.copyLastResumePayloadReport',
            'antigravity.copyEscalationDiagnosticsReport', 'antigravity.copyEscalationHealthSummary',
            'antigravity.showEscalationMenu', 'antigravity.clearEscalationTimeline',
            'antigravity.clearEscalationTimelineNow', 'antigravity.resumeFromWaitingState',
            'antigravity.validateCrossUiCoverage', 'antigravity.runCrossUiSelfTest',
            'antigravity.explainAutoResumeGuard', 'antigravity.autoFixAutoResumeReadiness',
            'antigravity.testAudio',
        ];
        for (const cmd of noopCommands) {
            context.subscriptions.push(safeRegisterCommand(cmd, noop));
        }

        log.info('Antigravity Autopilot: Activation complete (v8 simplified)');
        fs.appendFileSync(debugDumpPath, `[${new Date().toISOString()}] Activation complete\n`);
    } catch (err: any) {
        log.error('Activation error: ' + (err?.message || err));
        vscode.window.showErrorMessage('Antigravity activation failed: ' + (err?.message || err));
    }
}

export function deactivate() {
    controllerLease?.stop();
    controllerLease = null;
}