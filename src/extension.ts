import * as vscode from 'vscode';
import * as path from 'path';
import { DashboardPanel } from './ui/dashboard';
import { config } from './utils/config';
import { createLogger } from './utils/logger';
import { autonomousLoop } from './core/autonomous-loop';
// import { circuitBreaker } from './core/circuit-breaker'; // Removed unused import
import { progressTracker } from './core/progress-tracker';
import { mcpServer } from './modules/mcp/server';
import { activateRemoteServer, RemoteServer } from './modules/remote';
import { voiceControl } from './modules/voice/control';
import { CDPHandler } from './services/cdp/cdp-handler';
import { diagnoseCdp } from './commands/diagnose-cdp';

import { StrategyManager } from './strategies/manager';
import { testGenerator } from './core/test-generator';
import { codeReviewer } from './core/code-reviewer';
import { agentOrchestrator } from './core/agent-orchestrator';
import { memoryManager } from './core/memory-manager';
import { buildAutoResumeGuardReport, evaluateEscalationArming, evaluateCrossUiHealth } from './core/runtime-auto-resume-guard';
import { runAutoResumeReadinessFix, sendAutoResumeMessage } from './core/runtime-auto-resume-guard-effects';
import { projectManager } from './providers/project-manager';
import { ControllerLease } from './core/controller-lease';

import { StatusBarManager } from './ui/status-bar';
import { CDPStrategy, CDPRuntimeState } from './strategies/cdp-strategy';

import { SoundEffects, SOUND_EFFECTS } from './utils/sound-effects';

import * as fs from 'fs';
import * as os from 'os';

const log = createLogger('Extension');
let statusBar: StatusBarManager;
let controllerLease: ControllerLease | null = null;

function safeRegisterCommand(commandId: string, callback: (...args: any[]) => any): vscode.Disposable {
    try {
        return vscode.commands.registerCommand(commandId, callback);
    } catch (error: any) {
        log.warn(`[SafeRegister] Ignored duplicate command: ${commandId}`);
        return { dispose: () => { } };
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        const debugDumpPath = path.join(os.homedir() || os.tmpdir(), 'antigravity-activation.log');
        fs.appendFileSync(debugDumpPath, `\n[${new Date().toISOString()}] Extension activate called\n`);

        vscode.window.showInformationMessage('Antigravity Unified: Activation Started!');
        console.log('Antigravity Unified: Activation Started!');
        log.info('Antigravity Autopilot (Unified) activating...');

        // Initialize UI
        statusBar = new StatusBarManager(context);

        const isUnifiedAutoAcceptEnabled = () => {
            return !!config.get<boolean>('autopilotAutoAcceptEnabled')
                || !!config.get<boolean>('autoAllEnabled')
                || !!config.get<boolean>('autoAcceptEnabled');
        };

        // Initialize Managers
        const strategyManager = new StrategyManager(context);
        fs.appendFileSync(debugDumpPath, `[${new Date().toISOString()}] Strategy Manager init success\n`);
        const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        const leaseOwnerId = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
        controllerLease = new ControllerLease(leaseOwnerId, workspaceId);
        controllerLease.start();
        context.subscriptions.push({
            dispose: () => {
                controllerLease?.stop();
                controllerLease = null;
            }
        });

        const isControllerLeader = () => !!controllerLease?.isLeader();
        const updateControllerRoleStatus = () => {
            const leader = controllerLease?.getLeaderInfo();
            statusBar.updateControllerRole(isControllerLeader(), leader?.workspace || null);
        };
        const ensureControllerLeader = (reason: string, notify: boolean = false): boolean => {
            updateControllerRoleStatus();
            if (isControllerLeader()) {
                return true;
            }

            const leader = controllerLease?.getLeaderInfo();
            const leaderWorkspace = leader?.workspace ? ` | leader workspace: ${leader.workspace}` : '';
            log.info(`[ControllerLease] Follower mode in this window; skipping ${reason}.${leaderWorkspace}`);
            if (notify) {
                vscode.window.showInformationMessage('Antigravity is in follower mode in this window. Another window is the active controller.');
            }
            return false;
        };
        let latestRuntimeState: CDPRuntimeState | null = null;
        let waitingStateSince: number | null = null;
        let lastWaitingReminderAt = 0;
        let lastAutoResumeAt = 0;
        let readyToResumeStreak = 0;
        let remoteServer: RemoteServer | null = null;
        let lastAutoResumeOutcome: 'none' | 'sent' | 'blocked' | 'send-failed' = 'none';
        let lastAutoResumeBlockedReason = 'not evaluated';
        let lastAutoResumeMessageKind: 'none' | 'full' | 'minimal' = 'none';
        let lastAutoResumeMessageProfile: 'unknown' | 'vscode' | 'antigravity' | 'cursor' = 'unknown';
        let lastAutoResumeMessagePreview = '';
        let autoFixWatchdogInProgress = false;
        let lastAutoFixWatchdogAt = 0;
        let lastAutoFixWatchdogOutcome = 'never-run';
        let watchdogEscalationConsecutiveFailures = 0;
        let watchdogEscalationForceFullNext = false;
        let lastWatchdogEscalationAt = 0;
        let lastWatchdogEscalationReason = 'none';
        let watchdogEscalationEvents: Array<{ at: number; event: string; detail: string }> = [];
        let refreshStatusMenuInFlight = false;
        let lastRefreshStatusMenuAt = 0;
        let refreshStatusMenuDroppedTotal = 0;
        let refreshStatusMenuDroppedInFlight = 0;
        let refreshStatusMenuDroppedDebounce = 0;

        updateControllerRoleStatus();

        const pushWatchdogEscalationEvent = (event: string, detail: string) => {
            const maxEvents = Math.max(3, Math.min(100, config.get<number>('runtimeAutoFixWaitingEscalationMaxEvents') || 10));
            watchdogEscalationEvents.unshift({
                at: Date.now(),
                event,
                detail
            });
            if (watchdogEscalationEvents.length > maxEvents) {
                watchdogEscalationEvents = watchdogEscalationEvents.slice(0, maxEvents);
            }
        };

        const resolveCDPStrategy = (): CDPStrategy | null => {
            const strategy = strategyManager.getStrategy('cdp') as any;
            if (strategy && typeof strategy.getRuntimeState === 'function') {
                return strategy as CDPStrategy;
            }
            return null;
        };

        const refreshRuntimeState = async () => {
            try {
                updateControllerRoleStatus();
                const cdp = resolveCDPStrategy();
                if (!cdp || !cdp.isConnected()) {
                    latestRuntimeState = null;
                    waitingStateSince = null;
                    readyToResumeStreak = 0;
                    statusBar.updateRuntimeState(null);
                    return;
                }

                const runtimeState = await cdp.getRuntimeState();
                latestRuntimeState = runtimeState;
                statusBar.updateRuntimeState(runtimeState);

                const waitingEnabled = config.get<boolean>('runtimeWaitingReminderEnabled');
                const waitingDelayMs = Math.max(5, config.get<number>('runtimeWaitingReminderDelaySec') || 60) * 1000;
                const waitingCooldownMs = Math.max(5, config.get<number>('runtimeWaitingReminderCooldownSec') || 180) * 1000;
                const autoResumeEnabled = config.get<boolean>('runtimeAutoResumeEnabled');
                const autoResumeCooldownMs = Math.max(5, config.get<number>('runtimeAutoResumeCooldownSec') || 300) * 1000;
                const stablePollsRequired = Math.max(1, Math.min(10, config.get<number>('runtimeAutoResumeStabilityPolls') || 2));
                const autoFixWaitingEnabled = config.get<boolean>('runtimeAutoFixWaitingEnabled');
                const autoFixWaitingDelayMs = Math.max(5, config.get<number>('runtimeAutoFixWaitingDelaySec') || 180) * 1000;
                const autoFixWaitingCooldownMs = Math.max(5, config.get<number>('runtimeAutoFixWaitingCooldownSec') || 300) * 1000;
                const escalationEnabled = config.get<boolean>('runtimeAutoFixWaitingEscalationEnabled');
                const escalationThreshold = Math.max(1, Math.min(10, config.get<number>('runtimeAutoFixWaitingEscalationThreshold') || 2));
                const escalationCooldownMs = Math.max(5, config.get<number>('runtimeAutoFixWaitingEscalationCooldownSec') || 900) * 1000;
                const now = Date.now();
                const isWaiting = runtimeState?.completionWaiting?.readyToResume === true
                    || runtimeState?.status === 'waiting_for_chat_message'
                    || runtimeState?.waitingForChatMessage === true;

                const tryArmEscalation = (triggerReason: string) => {
                    const decision = evaluateEscalationArming({
                        enabled: escalationEnabled,
                        consecutiveFailures: watchdogEscalationConsecutiveFailures,
                        threshold: escalationThreshold,
                        now,
                        lastEscalationAt: lastWatchdogEscalationAt,
                        cooldownMs: escalationCooldownMs
                    });

                    if (!decision.arm) {
                        if (decision.cooldownRemainingMs > 0) {
                            lastWatchdogEscalationReason = `threshold reached but ${decision.reason}`;
                        }
                        pushWatchdogEscalationEvent('suppressed', lastWatchdogEscalationReason);
                        return;
                    }

                    watchdogEscalationForceFullNext = true;
                    lastWatchdogEscalationAt = Date.now();
                    lastWatchdogEscalationReason = triggerReason;
                    pushWatchdogEscalationEvent('armed', triggerReason);
                    log.info(`[AutoResume Watchdog] Escalation armed: forcing full resume prompt on next auto-resume attempt (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}).`);
                };

                if (isWaiting) {
                    readyToResumeStreak += 1;
                } else {
                    readyToResumeStreak = 0;
                }

                if (!isWaiting) {
                    waitingStateSince = null;
                    const hadEscalationState = watchdogEscalationConsecutiveFailures > 0 || watchdogEscalationForceFullNext;
                    watchdogEscalationConsecutiveFailures = 0;
                    watchdogEscalationForceFullNext = false;
                    lastWatchdogEscalationReason = 'reset: not waiting';
                    if (hadEscalationState) {
                        pushWatchdogEscalationEvent('reset', 'waiting state cleared');
                    }
                    return;
                }

                if (waitingStateSince === null) {
                    waitingStateSince = now;
                    return;
                }

                const waitingElapsed = now - waitingStateSince;
                const completionReadyToResume = runtimeState?.completionWaiting?.readyToResume === true;
                const autoResumeDelayMs = completionReadyToResume
                    ? Math.min(waitingDelayMs, 15000)
                    : waitingDelayMs;

                if (autoFixWaitingEnabled
                    && waitingElapsed >= autoFixWaitingDelayMs
                    && (now - lastAutoFixWatchdogAt) >= autoFixWaitingCooldownMs
                    && !autoFixWatchdogInProgress) {
                    autoFixWatchdogInProgress = true;
                    try {
                        const report = await runAutoResumeReadinessFix({ skipRefresh: true });
                        lastAutoFixWatchdogAt = Date.now();
                        const outcome = report.improved
                            ? 'improved'
                            : report.immediateRetry?.sent
                                ? 'retry-sent'
                                : report.immediateRetry?.attempted
                                    ? 'retry-failed'
                                    : 'no-change';
                        lastAutoFixWatchdogOutcome = outcome;

                        if (outcome === 'improved' || outcome === 'retry-sent') {
                            watchdogEscalationConsecutiveFailures = 0;
                            watchdogEscalationForceFullNext = false;
                            lastWatchdogEscalationReason = `reset: ${outcome}`;
                            pushWatchdogEscalationEvent('reset', `watchdog recovered (${outcome})`);
                        } else {
                            watchdogEscalationConsecutiveFailures += 1;
                            tryArmEscalation(`threshold reached (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}) after ${outcome}`);
                        }
                    } catch (e: any) {
                        lastAutoFixWatchdogAt = Date.now();
                        lastAutoFixWatchdogOutcome = `error: ${String(e?.message || e || 'unknown')}`;
                        watchdogEscalationConsecutiveFailures += 1;
                        tryArmEscalation(`threshold reached (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}) after watchdog error`);
                    } finally {
                        autoFixWatchdogInProgress = false;
                    }
                }

                if (waitingEnabled) {
                    const cooldownElapsed = now - lastWaitingReminderAt;
                    if (waitingElapsed >= waitingDelayMs && cooldownElapsed >= waitingCooldownMs) {
                        lastWaitingReminderAt = now;
                        const done = runtimeState?.doneTabs ?? 0;
                        const total = runtimeState?.totalTabs ?? 0;
                        const pending = runtimeState?.pendingAcceptButtons ?? 0;
                        vscode.window.showInformationMessage(
                            `Antigravity is waiting for a new chat message (${done}/${total} tabs complete, pending actions: ${pending}).`,
                            'Check Runtime State',
                            'Open Dashboard'
                        ).then(selection => {
                            if (selection === 'Check Runtime State') {
                                vscode.commands.executeCommand('antigravity.checkRuntimeState');
                            } else if (selection === 'Open Dashboard') {
                                vscode.commands.executeCommand('antigravity.openSettings');
                            }
                        });
                    }
                }

                if (autoResumeEnabled && waitingElapsed >= autoResumeDelayMs && (now - lastAutoResumeAt) >= autoResumeCooldownMs && readyToResumeStreak >= stablePollsRequired) {
                    const guard = getAutoResumeGuardReport(runtimeState);

                    if (guard.allowed) {
                        const sent = await sendAutoResumeMessage('automatic', runtimeState, {
                            forceFull: watchdogEscalationForceFullNext,
                            escalationReason: watchdogEscalationForceFullNext ? lastWatchdogEscalationReason : undefined
                        });
                        if (sent) {
                            lastAutoResumeAt = now;
                            lastAutoResumeOutcome = 'sent';
                            lastAutoResumeBlockedReason = 'none';
                            if (watchdogEscalationForceFullNext) {
                                watchdogEscalationForceFullNext = false;
                                watchdogEscalationConsecutiveFailures = 0;
                                lastWatchdogEscalationReason = 'consumed: full prompt sent';
                                pushWatchdogEscalationEvent('consumed', 'forced full prompt sent successfully');
                            }
                        } else {
                            lastAutoResumeOutcome = 'send-failed';
                            lastAutoResumeBlockedReason = 'message dispatch failed';
                        }
                    } else {
                        lastAutoResumeOutcome = 'blocked';
                        lastAutoResumeBlockedReason = guard.reason;
                        log.info(`[AutoResume] Guard blocked auto-resume: score=${guard.health.score}/${guard.minScore}, strictPass=${guard.health.strictPass}, requireStrict=${guard.requireStrict}, reason=${guard.reason}`);
                    }
                } else if (autoResumeEnabled && waitingElapsed >= autoResumeDelayMs && (now - lastAutoResumeAt) >= autoResumeCooldownMs && readyToResumeStreak < stablePollsRequired) {
                    lastAutoResumeOutcome = 'blocked';
                    lastAutoResumeBlockedReason = `awaiting stable waiting signal (${readyToResumeStreak}/${stablePollsRequired})`;
                }
            } catch {
                latestRuntimeState = null;
                waitingStateSince = null;
                readyToResumeStreak = 0;
                statusBar.updateRuntimeState(null);
            }
        };

        const emergencyDisableAllAutonomy = async (source: string = 'manual panic stop') => {
            try {
                autonomousLoop.stop(`Emergency stop: ${source}`);
            } catch { }

            try {
                await strategyManager.stop();
            } catch { }

            try {
                await mcpServer.stop();
            } catch { }

            try {
                await voiceControl.stop();
            } catch { }

            // Persist hard-off state across all known autonomy controls.
            const updates: Array<[string, any]> = [
                ['autonomousEnabled', false],
                ['autopilotAutoAcceptEnabled', false],
                ['autoAcceptEnabled', false],
                ['autoAllEnabled', false],
                ['actions.autoAccept.enabled', false],
                ['actions.bump.enabled', false],
                ['actions.run.enabled', false],
                ['actions.expand.enabled', false],
                ['mcpEnabled', false],
                ['voiceControlEnabled', false],
                ['autoContinueScriptEnabled', false]
            ];

            for (const [key, value] of updates) {
                try {
                    await config.update(key, value);
                } catch { }
            }

            await refreshRuntimeState().catch(() => { });
            log.warn(`[EmergencyStop] All autonomy disabled (${source}).`);
            vscode.window.showWarningMessage('Antigravity Emergency Stop: all autonomy systems disabled. Re-enable manually from Dashboard/commands when ready.');
        };

        const enableAllAutonomy = async (source: string = 'master toggle on') => {
            if (!ensureControllerLeader(`enableAllAutonomy (${source})`, true)) {
                return;
            }

            const updates: Array<[string, any]> = [
                ['strategy', 'cdp'],
                ['autonomousEnabled', true],
                ['autopilotAutoAcceptEnabled', true],
                ['autoAcceptEnabled', true],
                ['autoAllEnabled', true],
                ['actions.autoAccept.enabled', true],
                ['actions.bump.enabled', true],
                ['actions.run.enabled', true],
                ['actions.expand.enabled', true],
                ['autoContinueScriptEnabled', true]
            ];

            for (const [key, value] of updates) {
                try {
                    await config.update(key, value);
                } catch { }
            }

            try {
                await strategyManager.start();
            } catch { }

            if (!autonomousLoop.isRunning()) {
                try {
                    await autonomousLoop.start();
                } catch { }
            }

            await refreshRuntimeState().catch(() => { });
            log.info(`[MasterToggle] All core autonomy enabled (${source}).`);
            vscode.window.showInformationMessage('Antigravity Master Toggle: core autonomy enabled (CDP + Auto-All + Autonomous Loop).');
        };

        const enableMaximumAutopilot = async (source: string = 'maximum autopilot') => {
            if (!ensureControllerLeader(`enableMaximumAutopilot (${source})`, true)) {
                return;
            }

            const updates: Array<[string, any]> = [
                ['strategy', 'cdp'],
                ['autonomousEnabled', true],
                ['autopilotAutoAcceptEnabled', true],
                ['autopilotAutoBumpEnabled', true],
                ['autopilotRunExpandContinueEnabled', true],
                ['autoAcceptEnabled', true],
                ['autoAllEnabled', true],
                ['actions.autoAccept.enabled', true],
                ['actions.bump.enabled', true],
                ['actions.run.enabled', true],
                ['actions.expand.enabled', true],
                ['autoContinueScriptEnabled', true],
                ['automation.actions.clickRun', true],
                ['automation.actions.clickExpand', true],
                ['automation.actions.clickAccept', true],
                ['automation.actions.clickAcceptAll', true],
                ['automation.actions.clickContinue', true],
                ['automation.actions.clickSubmit', true],
                ['automation.actions.autoReply', true],
                ['automation.debug.logAllActions', true],
                ['automation.debug.logToExtension', true],
                ['automation.debug.verboseLogging', true],
                ['automation.timing.pollIntervalMs', Math.max(100, config.get<number>('automation.timing.pollIntervalMs') || 800)],
                ['experimental.cdpAggressiveDiscovery', false],
                ['experimental.cdpExplicitDiscovery', false]
            ];

            for (const [key, value] of updates) {
                try {
                    await config.update(key, value);
                } catch { }
            }

            try {
                await strategyManager.start();
            } catch { }

            if (!autonomousLoop.isRunning()) {
                try {
                    await autonomousLoop.start();
                } catch { }
            }

            await refreshRuntimeState().catch(() => { });
            log.info(`[MaxAutopilot] Maximum autopilot preset enabled (${source}).`);
            vscode.window.showInformationMessage('Antigravity: Maximum Autopilot enabled (CDP + Run/Expand/Accept/Continue/Submit + Bump + verbose debug telemetry).');
        };

        const toggleMasterControl = async () => {
            const isEnabled = !!config.get<boolean>('autonomousEnabled')
                || !!config.get<boolean>('autopilotAutoAcceptEnabled')
                || !!config.get<boolean>('autoAllEnabled')
                || !!config.get<boolean>('actions.autoAccept.enabled')
                || !!config.get<boolean>('actions.bump.enabled')
                || !!config.get<boolean>('autoContinueScriptEnabled');

            if (isEnabled) {
                await emergencyDisableAllAutonomy('master toggle off');
                return;
            }

            await enableAllAutonomy('master toggle on');
        };

        const runtimeSummary = (state: CDPRuntimeState | null): string => {
            if (!state) return 'state unavailable';
            const status = state.status || 'unknown';
            const done = state.doneTabs ?? 0;
            const total = state.totalTabs ?? 0;
            const pending = state.pendingAcceptButtons ?? 0;
            const waiting = state.waitingForChatMessage ? 'yes' : 'no';
            return `${status} | tabs ${done}/${total} | pending ${pending} | waiting chat ${waiting}`;
        };

        const openNativeExtensionSettings = async () => {
            const extensionId = context.extension?.id || 'ai-dev-2024.antigravity-autopilot';
            const candidateFilters = [
                `@ext:${extensionId}`,
                '@ext:ai-dev-2024.antigravity-autopilot',
                '@ext:antigravity-autopilot',
                'antigravity.'
            ];

            for (const query of candidateFilters) {
                try {
                    await vscode.commands.executeCommand('workbench.action.openSettings', query);
                    return;
                } catch {
                    // Try next fallback query.
                }
            }

            await vscode.commands.executeCommand('workbench.action.openSettings');
            vscode.window.showInformationMessage(`Antigravity: opened Settings. Try filtering by @ext:${extensionId} or antigravity.`);
        };

        const runSettingsSurfaceHealthCheck = async () => {
            const extensionId = context.extension?.id || 'ai-dev-2024.antigravity-autopilot';
            const packageJson = (context.extension?.packageJSON || {}) as any;
            const contributedCommands: string[] = Array.isArray(packageJson?.contributes?.commands)
                ? packageJson.contributes.commands.map((c: any) => String(c?.command || '')).filter(Boolean)
                : [];
            const contributedSettings: string[] = Object.keys(packageJson?.contributes?.configuration?.properties || {});

            const availableCommands = await vscode.commands.getCommands(true);
            const expectedCommands = [
                'antigravity.openSettings',
                'antigravity.openExtensionSettings',
                'antigravity.showStatusMenu',
                'antigravity.showControllerLeaseState'
            ];
            const missingExpectedCommands = expectedCommands.filter(cmd => !availableCommands.includes(cmd));

            const dashboardWasOpen = !!DashboardPanel.currentPanel;
            let dashboardOpenAttempted = false;
            let dashboardOpenResult = false;
            let dashboardOpenError: string | null = null;

            try {
                dashboardOpenAttempted = true;
                DashboardPanel.createOrShow(context.extensionUri);
                dashboardOpenResult = !!DashboardPanel.currentPanel;
            } catch (error: any) {
                dashboardOpenError = String(error?.message || error || 'unknown error');
            }

            let nativeSettingsAttempted = false;
            let nativeSettingsResult = false;
            let nativeSettingsError: string | null = null;
            try {
                nativeSettingsAttempted = true;
                await openNativeExtensionSettings();
                nativeSettingsResult = true;
            } catch (error: any) {
                nativeSettingsError = String(error?.message || error || 'unknown error');
            }

            const configSnapshot = config.getAll() as unknown as Record<string, unknown>;
            const topLevelConfigKeys = Object.keys(configSnapshot || {});

            const report = {
                timestamp: new Date().toISOString(),
                extension: {
                    id: extensionId,
                    version: String(packageJson?.version || 'unknown')
                },
                surfaces: {
                    dashboard: {
                        wasOpenBeforeCheck: dashboardWasOpen,
                        attemptedOpen: dashboardOpenAttempted,
                        openResult: dashboardOpenResult,
                        error: dashboardOpenError
                    },
                    nativeSettings: {
                        attemptedOpen: nativeSettingsAttempted,
                        openResult: nativeSettingsResult,
                        error: nativeSettingsError
                    }
                },
                paritySummary: {
                    contributedCommandCount: contributedCommands.length,
                    contributedSettingsCount: contributedSettings.length,
                    topLevelConfigKeyCount: topLevelConfigKeys.length,
                    missingExpectedCommands,
                    notes: [
                        'CI parity checks remain authoritative: tests/command-parity.test.js and tests/schema-parity.test.js',
                        'Runtime health check validates command availability and settings/dashboard navigation surfaces.'
                    ]
                }
            };

            const serialized = JSON.stringify(report, null, 2);
            await vscode.env.clipboard.writeText(serialized);
            const doc = await vscode.workspace.openTextDocument({ content: serialized, language: 'json' });
            await vscode.window.showTextDocument(doc, { preview: false });

            const passed = dashboardOpenResult && nativeSettingsResult && missingExpectedCommands.length === 0;
            vscode.window.showInformationMessage(
                `Antigravity Settings Health Check: ${passed ? 'PASS' : 'WARN'} | dashboard=${dashboardOpenResult ? 'ok' : 'fail'} | native=${nativeSettingsResult ? 'ok' : 'fail'} | missingCommands=${missingExpectedCommands.length}`
            );
        };

        const confirmDestructiveVoiceIntent = async (command: { intent: string; raw: string }): Promise<boolean> => {
            const destructiveIntents = new Set(['reject', 'pause', 'deploy']);
            if (!destructiveIntents.has(command.intent)) {
                return true;
            }

            const decision = await vscode.window.showWarningMessage(
                `Voice command "${command.intent}" is potentially destructive. Confirm execution?\nTranscript: ${command.raw}`,
                { modal: true },
                'Confirm',
                'Cancel'
            );

            return decision === 'Confirm';
        };

        context.subscriptions.push(
            safeRegisterCommand('antigravity.diagnoseCdp', diagnoseCdp),
            safeRegisterCommand('antigravity.testMethod', async (methodId: string, text: string) => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showErrorMessage('Antigravity: CDP Strategy is not active.');
                    return false;
                }
                return cdp.testMethod(methodId, text);
            })
        );


        voiceControl.setIntentExecutor(async (command) => {
            if (!await confirmDestructiveVoiceIntent(command)) {
                return { handled: false, detail: 'user cancelled destructive action' };
            }

            switch (command.intent) {
                case 'status':
                    await vscode.commands.executeCommand('antigravity.checkRuntimeState');
                    return { handled: true };
                case 'diagnose':
                    await vscode.commands.executeCommand('antigravity.diagnoseCdp');
                    return { handled: true };
                case 'pause':
                    if (autonomousLoop.isRunning()) {
                        autonomousLoop.stop('Voice command: pause');
                        await config.update('autonomousEnabled', false);
                    }
                    return { handled: true };
                case 'resume':
                    if (!autonomousLoop.isRunning()) {
                        await autonomousLoop.start();
                        await config.update('autonomousEnabled', true);
                    }
                    return { handled: true };
                case 'open_dashboard':
                    await vscode.commands.executeCommand('antigravity.openSettings');
                    return { handled: true };
                case 'run_tests':
                    try {
                        await vscode.commands.executeCommand('workbench.action.tasks.test');
                    } catch {
                        // Fallback command path
                        await vscode.commands.executeCommand('testing.runAll');
                    }
                    return { handled: true };
                case 'switch_model':
                    if (command.params?.model) {
                        await config.update('preferredModelForQuick', command.params.model);
                        return { handled: true };
                    }
                    return { handled: false, detail: 'missing model parameter' };
                case 'approve':
                    // Check if we have an active chat session to accept
                    await vscode.commands.executeCommand('interactive.acceptChanges');
                    return { handled: true };
                case 'bump':
                    // Attempt to send a bump via CDP
                    const cdp = resolveCDPStrategy() as any;
                    if (cdp && typeof cdp.sendHybridBump === 'function') {
                        await cdp.sendHybridBump('continue');
                        return { handled: true };
                    }
                    return { handled: false, detail: 'CDP strategy not active' };
                case 'reject':
                    return { handled: false, detail: 'reject intent not mapped to a safe runtime action' };
                case 'deploy':
                    return { handled: false, detail: 'deploy intent confirmed but no direct deploy action is configured' };
                default:
                    return { handled: false, detail: 'intent not supported' };
            }
        });

        const formatDurationShort = (ms: number) => {
            if (!Number.isFinite(ms) || ms < 0) return '-';
            const totalSec = Math.floor(ms / 1000);
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        };

        const toSafePreview = (text: string, max = 120): string => {
            const normalized = (text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return '';
            return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
        };

        const getAutoResumeGuardReport = (state: any) => {
            const minScore = Math.max(0, Math.min(100, config.get<number>('runtimeAutoResumeMinScore') || 70));
            const requireStrict = config.get<boolean>('runtimeAutoResumeRequireStrictPrimary');
            return buildAutoResumeGuardReport(state, {
                minScore,
                requireStrict
            });
        };

        const getAutoResumeTimingReport = (isWaiting: boolean, now = Date.now()) => {
            const waitingDelayMs = Math.max(5, config.get<number>('runtimeWaitingReminderDelaySec') || 60) * 1000;
            const autoResumeCooldownMs = Math.max(5, config.get<number>('runtimeAutoResumeCooldownSec') || 300) * 1000;
            const waitingElapsedMs = waitingStateSince ? Math.max(0, now - waitingStateSince) : 0;
            const waitingDelayRemainingMs = isWaiting ? Math.max(0, waitingDelayMs - waitingElapsedMs) : waitingDelayMs;
            const cooldownElapsedMs = Math.max(0, now - lastAutoResumeAt);
            const cooldownRemainingMs = Math.max(0, autoResumeCooldownMs - cooldownElapsedMs);
            const nextEligibilityDelayMs = isWaiting ? Math.max(waitingDelayRemainingMs, cooldownRemainingMs) : waitingDelayMs;
            const nextEligibleAt = now + nextEligibilityDelayMs;

            return {
                now,
                waitingDelayMs,
                autoResumeCooldownMs,
                waitingElapsedMs,
                waitingDelayRemainingMs,
                cooldownElapsedMs,
                cooldownRemainingMs,
                nextEligibleAt,
                eligibleNow: isWaiting && waitingDelayRemainingMs === 0 && cooldownRemainingMs === 0
            };
        };

        const sendAutoResumeMessage = async (
            reason: 'automatic' | 'manual',
            runtimeState?: any,
            options?: { forceFull?: boolean; escalationReason?: string; messageOverride?: string }
        ) => {
            const fullMessage = (config.get<string>('runtimeAutoResumeMessage') || '').trim();
            const minimalMessage = (config.get<string>('runtimeAutoResumeMinimalMessage') || '').trim();
            const minimalVSCode = (config.get<string>('runtimeAutoResumeMinimalMessageVSCode') || '').trim();
            const minimalAntigravity = (config.get<string>('runtimeAutoResumeMinimalMessageAntigravity') || '').trim();
            const minimalCursor = (config.get<string>('runtimeAutoResumeMinimalMessageCursor') || '').trim();
            const activeMode = String(runtimeState?.mode || '').toLowerCase();
            const profileMinimalMessage = activeMode === 'vscode'
                ? minimalVSCode
                : activeMode === 'antigravity'
                    ? minimalAntigravity
                    : activeMode === 'cursor'
                        ? minimalCursor
                        : '';
            const useMinimal = !options?.forceFull
                && !!config.get<boolean>('runtimeAutoResumeUseMinimalContinue')
                && !!runtimeState?.completionWaiting?.readyToResume;
            const message = (options?.messageOverride || (useMinimal ? (profileMinimalMessage || minimalMessage || fullMessage) : fullMessage)).trim();
            const messageKind: 'full' | 'minimal' = useMinimal ? 'minimal' : 'full';
            const messageProfile: 'unknown' | 'vscode' | 'antigravity' | 'cursor' = activeMode === 'vscode'
                ? 'vscode'
                : activeMode === 'antigravity'
                    ? 'antigravity'
                    : activeMode === 'cursor'
                        ? 'cursor'
                        : 'unknown';

            if (!message) {
                if (reason === 'manual') {
                    vscode.window.showWarningMessage('Antigravity: selected resume message is empty (check runtimeAutoResumeMessage/runtimeAutoResumeMinimalMessage).');
                }
                return false;
            }

            const sendViaCommands = async (): Promise<boolean> => {
                try {
                    await vscode.env.clipboard.writeText(message);
                    const commands = [
                        'workbench.action.chat.open',
                        'workbench.action.chat.focusInput',
                        'editor.action.clipboardPasteAction',
                        'workbench.action.chat.submit',
                        'workbench.action.chat.send',
                        'interactive.acceptChanges',
                        'workbench.action.terminal.chat.accept',
                        'inlineChat.accept'
                    ];

                    for (const cmd of commands) {
                        try { await vscode.commands.executeCommand(cmd); } catch { }
                    }
                    return true;
                } catch {
                    return false;
                }
            };

            const cdp = resolveCDPStrategy() as any;
            if (cdp && typeof cdp.sendHybridBump === 'function') {
                try {
                    const sent = await cdp.sendHybridBump(message);
                    if (sent) {
                        lastAutoResumeMessageKind = messageKind;
                        lastAutoResumeMessageProfile = messageProfile;
                        lastAutoResumeMessagePreview = toSafePreview(message);
                        log.info(`[AutoResume] Sent ${reason} ${useMinimal ? 'minimal-continue' : 'resume'} message via CDP bridge.`);
                        if (options?.forceFull) {
                            log.info(`[AutoResume] Full-prompt escalation applied${options.escalationReason ? `: ${options.escalationReason}` : ''}.`);
                        }
                        if (reason === 'manual') {
                            vscode.window.showInformationMessage('Antigravity: resume message sent.');
                        }
                        return true;
                    }
                } catch { }
            }

            const fallbackSent = await sendViaCommands();
            if (fallbackSent) {
                lastAutoResumeMessageKind = messageKind;
                lastAutoResumeMessageProfile = messageProfile;
                lastAutoResumeMessagePreview = toSafePreview(message);
                log.info(`[AutoResume] Sent ${reason} ${useMinimal ? 'minimal-continue' : 'resume'} message via VS Code fallback commands.`);
                if (options?.forceFull) {
                    log.info(`[AutoResume] Full-prompt escalation applied via fallback${options.escalationReason ? `: ${options.escalationReason}` : ''}.`);
                }
                if (reason === 'manual') {
                    vscode.window.showInformationMessage('Antigravity: resume message sent via fallback commands.');
                }
                return true;
            }

            if (reason === 'manual') {
                vscode.window.showWarningMessage('Antigravity: failed to send resume message (CDP and command fallback both failed).');
            }
            return false;
        };

        const runAutoResumeReadinessFix = async (options?: { skipRefresh?: boolean }) => {
            const attemptedCommands = [
                'workbench.action.chat.open',
                'workbench.action.chat.focusInput',
                'workbench.panel.chat.view.copilot.focus',
                'workbench.action.chat.openInSideBar'
            ];

            const commandResults: Array<{ command: string; ok: boolean; error?: string }> = [];
            for (const command of attemptedCommands) {
                try {
                    await vscode.commands.executeCommand(command);
                    commandResults.push({ command, ok: true });
                } catch (error: any) {
                    commandResults.push({ command, ok: false, error: String(error?.message || error || 'unknown error') });
                }
            }

            await new Promise(resolve => setTimeout(resolve, 350));

            const cdp = resolveCDPStrategy();
            const beforeState = latestRuntimeState;
            const beforeGuard = beforeState ? getAutoResumeGuardReport(beforeState) : null;

            if (!options?.skipRefresh) {
                await refreshRuntimeState();
            }

            const afterState = cdp && cdp.isConnected() ? await cdp.getRuntimeState() : latestRuntimeState;
            if (afterState) {
                latestRuntimeState = afterState;
                statusBar.updateRuntimeState(afterState);
            }
            const afterGuard = afterState ? getAutoResumeGuardReport(afterState) : null;

            const improved = !!beforeGuard && !!afterGuard
                ? ((!beforeGuard.allowed && afterGuard.allowed) || (afterGuard.health.score > beforeGuard.health.score))
                : false;

            const isWaitingAfter = afterState?.status === 'waiting_for_chat_message' || afterState?.waitingForChatMessage === true;
            const autoResumeEnabled = config.get<boolean>('runtimeAutoResumeEnabled');
            const canRetryNow = !!afterGuard && afterGuard.allowed && isWaitingAfter && autoResumeEnabled;
            let immediateRetryAttempted = false;
            let immediateRetrySent = false;
            let immediateRetryReason = 'not attempted';

            if (canRetryNow) {
                immediateRetryAttempted = true;
                const sent = await sendAutoResumeMessage('automatic', afterState || latestRuntimeState);
                if (sent) {
                    immediateRetrySent = true;
                    immediateRetryReason = 'guard passed in waiting state; resume message sent';
                    lastAutoResumeAt = Date.now();
                    lastAutoResumeOutcome = 'sent';
                    lastAutoResumeBlockedReason = 'none';
                } else {
                    immediateRetryReason = 'dispatch failed';
                    lastAutoResumeOutcome = 'send-failed';
                    lastAutoResumeBlockedReason = 'message dispatch failed';
                }
            } else if (!autoResumeEnabled) {
                immediateRetryReason = 'runtimeAutoResumeEnabled is false';
            } else if (!isWaitingAfter) {
                immediateRetryReason = 'runtime is not in waiting_for_chat_message state';
            } else if (afterGuard && !afterGuard.allowed) {
                immediateRetryReason = `guard blocked: ${afterGuard.reason}`;
            }

            return {
                timestamp: new Date().toISOString(),
                attemptedCommands,
                commandResults,
                before: beforeGuard ? {
                    status: beforeState?.status || 'unknown',
                    allowed: beforeGuard.allowed,
                    reason: beforeGuard.reason,
                    recommendedNextAction: beforeGuard.recommendedNextAction,
                    recommendedNextActionConfidence: beforeGuard.recommendedNextActionConfidence,
                    score: beforeGuard.health.score,
                    strictPass: beforeGuard.health.strictPass
                } : null,
                after: afterGuard ? {
                    status: afterState?.status || 'unknown',
                    allowed: afterGuard.allowed,
                    reason: afterGuard.reason,
                    recommendedNextAction: afterGuard.recommendedNextAction,
                    recommendedNextActionConfidence: afterGuard.recommendedNextActionConfidence,
                    score: afterGuard.health.score,
                    strictPass: afterGuard.health.strictPass
                } : null,
                improved,
                immediateRetry: {
                    attempted: immediateRetryAttempted,
                    sent: immediateRetrySent,
                    reason: immediateRetryReason,
                    autoResumeEnabled,
                    isWaitingAfter
                }
            };
        };

        const buildLastResumePayloadReport = (state?: any) => {
            const runtime = state || latestRuntimeState || null;
            const completionWaiting = runtime?.completionWaiting || null;
            const hostTiming = runtime
                ? getAutoResumeTimingReport(!!completionWaiting?.readyToResume || runtime?.status === 'waiting_for_chat_message' || runtime?.waitingForChatMessage === true)
                : null;

            return {
                timestamp: new Date().toISOString(),
                runtimeStatus: runtime?.status || 'unknown',
                runtimeMode: runtime?.mode || 'unknown',
                completionWaiting,
                lastResume: {
                    outcome: lastAutoResumeOutcome,
                    blockedReason: lastAutoResumeBlockedReason,
                    messageKind: lastAutoResumeMessageKind,
                    messageProfile: lastAutoResumeMessageProfile,
                    messagePreview: lastAutoResumeMessagePreview,
                    sentAt: lastAutoResumeAt || null
                },
                watchdogEscalation: {
                    consecutiveFailures: watchdogEscalationConsecutiveFailures,
                    forceFullNext: watchdogEscalationForceFullNext,
                    lastTriggeredAt: lastWatchdogEscalationAt || null,
                    reason: lastWatchdogEscalationReason,
                    events: watchdogEscalationEvents
                },
                readiness: {
                    readyToResumeStreak,
                    stablePollsRequired: Math.max(1, Math.min(10, config.get<number>('runtimeAutoResumeStabilityPolls') || 2))
                },
                timing: hostTiming,
                configSnapshot: {
                    autoResumeEnabled: config.get<boolean>('runtimeAutoResumeEnabled'),
                    useMinimalContinue: config.get<boolean>('runtimeAutoResumeUseMinimalContinue'),
                    minScore: config.get<number>('runtimeAutoResumeMinScore'),
                    requireStrictPrimary: config.get<boolean>('runtimeAutoResumeRequireStrictPrimary')
                }
            };
        };

        const buildEscalationDiagnosticsReport = (state?: any) => {
            const runtime = state || latestRuntimeState || null;
            const isWaiting = !!runtime?.completionWaiting?.readyToResume
                || runtime?.status === 'waiting_for_chat_message'
                || runtime?.waitingForChatMessage === true;
            const timing = runtime ? getAutoResumeTimingReport(isWaiting) : null;

            return {
                timestamp: new Date().toISOString(),
                runtimeStatus: runtime?.status || 'unknown',
                runtimeMode: runtime?.mode || 'unknown',
                waiting: {
                    isWaiting,
                    readyToResume: !!runtime?.completionWaiting?.readyToResume,
                    confidence: runtime?.completionWaiting?.confidence ?? null,
                    confidenceLabel: runtime?.completionWaiting?.confidenceLabel || null
                },
                escalation: {
                    consecutiveFailures: watchdogEscalationConsecutiveFailures,
                    forceFullNext: watchdogEscalationForceFullNext,
                    lastTriggeredAt: lastWatchdogEscalationAt || null,
                    reason: lastWatchdogEscalationReason,
                    events: watchdogEscalationEvents
                },
                watchdog: {
                    inProgress: autoFixWatchdogInProgress,
                    lastRunAt: lastAutoFixWatchdogAt || null,
                    lastOutcome: lastAutoFixWatchdogOutcome
                },
                autoResume: {
                    enabled: config.get<boolean>('runtimeAutoResumeEnabled'),
                    useMinimalContinue: config.get<boolean>('runtimeAutoResumeUseMinimalContinue'),
                    lastOutcome: lastAutoResumeOutcome,
                    lastBlockedReason: lastAutoResumeBlockedReason,
                    lastMessageKind: lastAutoResumeMessageKind,
                    lastMessageProfile: lastAutoResumeMessageProfile,
                    lastSentAt: lastAutoResumeAt || null
                },
                timing,
                configSnapshot: {
                    escalationEnabled: config.get<boolean>('runtimeAutoFixWaitingEscalationEnabled'),
                    escalationThreshold: config.get<number>('runtimeAutoFixWaitingEscalationThreshold'),
                    escalationCooldownSec: config.get<number>('runtimeAutoFixWaitingEscalationCooldownSec'),
                    clearRequireConfirm: config.get<boolean>('runtimeEscalationClearRequireConfirm'),
                    watchdogDelaySec: config.get<number>('runtimeAutoFixWaitingDelaySec'),
                    watchdogCooldownSec: config.get<number>('runtimeAutoFixWaitingCooldownSec')
                }
            };
        };

        const buildEscalationHealthSummaryLine = () => {
            const escalationCooldownMs = Math.max(5, config.get<number>('runtimeAutoFixWaitingEscalationCooldownSec') || 900) * 1000;
            const escalationCooldownRemainingMs = lastWatchdogEscalationAt > 0
                ? Math.max(0, escalationCooldownMs - (Date.now() - lastWatchdogEscalationAt))
                : 0;
            const escalationNextEligibleAt = lastWatchdogEscalationAt > 0
                ? (lastWatchdogEscalationAt + escalationCooldownMs)
                : null;
            const escalationStateLabel = watchdogEscalationForceFullNext ? 'ARMED' : 'IDLE';
            const latestEvent = watchdogEscalationEvents[0];
            const latestEventText = latestEvent
                ? `${latestEvent.event}@${new Date(latestEvent.at).toLocaleTimeString()}`
                : 'none';
            const nextEligibleText = escalationNextEligibleAt ? new Date(escalationNextEligibleAt).toLocaleTimeString() : '-';
            return `Escalation ${escalationStateLabel} | streak ${watchdogEscalationConsecutiveFailures} | last watchdog ${lastAutoFixWatchdogOutcome || 'n/a'} | cooldown ${formatDurationShort(escalationCooldownRemainingMs)} | next ${nextEligibleText} | reason ${lastWatchdogEscalationReason} | latest event ${latestEventText}`;
        };

        const clearEscalationTimelineState = async (source: string) => {
            watchdogEscalationEvents = [];
            watchdogEscalationConsecutiveFailures = 0;
            watchdogEscalationForceFullNext = false;
            lastWatchdogEscalationReason = 'reset: manual clear';
            pushWatchdogEscalationEvent('reset', `manual clear (${source})`);

            await refreshRuntimeState().catch(() => { });
        };

        DashboardPanel.setRuntimeStateProvider(async () => {
            const cdp = resolveCDPStrategy();
            if (!cdp || !cdp.isConnected()) {
                return null;
            }
            const state = await cdp.getRuntimeState();
            if (!state) {
                return null;
            }

            const isWaiting = state?.completionWaiting?.readyToResume === true
                || state?.status === 'waiting_for_chat_message'
                || state?.waitingForChatMessage === true;
            const guard = getAutoResumeGuardReport(state);
            const timing = getAutoResumeTimingReport(isWaiting);
            const escalationCooldownMs = Math.max(5, config.get<number>('runtimeAutoFixWaitingEscalationCooldownSec') || 900) * 1000;
            const escalationCooldownRemainingMs = lastWatchdogEscalationAt > 0
                ? Math.max(0, escalationCooldownMs - (Date.now() - lastWatchdogEscalationAt))
                : 0;
            const escalationNextEligibleAt = lastWatchdogEscalationAt > 0
                ? (lastWatchdogEscalationAt + escalationCooldownMs)
                : null;
            const stablePollsRequired = Math.max(1, Math.min(10, config.get<number>('runtimeAutoResumeStabilityPolls') || 2));

            return {
                ...state,
                hostTelemetry: {
                    autoResumeEnabled: config.get<boolean>('runtimeAutoResumeEnabled'),
                    waitingStateSince,
                    lastAutoResumeAt,
                    lastAutoResumeOutcome,
                    lastAutoResumeBlockedReason,
                    lastAutoResumeMessageKind,
                    lastAutoResumeMessageProfile,
                    lastAutoResumeMessagePreview,
                    autoFixWatchdogInProgress,
                    lastAutoFixWatchdogAt,
                    lastAutoFixWatchdogOutcome,
                    watchdogEscalationConsecutiveFailures,
                    watchdogEscalationForceFullNext,
                    lastWatchdogEscalationAt,
                    lastWatchdogEscalationReason,
                    escalationCooldownMs,
                    escalationCooldownRemainingMs,
                    escalationNextEligibleAt,
                    watchdogEscalationEvents,
                    readyToResumeStreak,
                    stablePollsRequired,
                    timing,
                    guard: {
                        allowed: guard.allowed,
                        reason: guard.reason,
                        recommendedNextAction: guard.recommendedNextAction,
                        recommendedNextActionConfidence: guard.recommendedNextActionConfidence,
                        minScore: guard.minScore,
                        requireStrict: guard.requireStrict,
                        score: guard.health.score,
                        grade: guard.health.grade,
                        strictPass: guard.health.strictPass
                    }
                }
            };
        });

        // Wire up Status Bar to Autonomous Loop
        autonomousLoop.setStatusCallback(status => {
            statusBar.update({
                autonomousEnabled: status.running,
                loopCount: status.loopCount,
                autoAllEnabled: config.get('autoAllEnabled'),
                multiTabEnabled: config.get('multiTabEnabled'),
                mode: config.get('strategy')
            });
        });

        // Update Status Bar on Config Change
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity')) {
                statusBar.update({
                    autonomousEnabled: autonomousLoop.isRunning(),
                    loopCount: 0, // We assume loop count preserves or resets? 
                    autoAllEnabled: config.get('autoAllEnabled'),
                    multiTabEnabled: config.get('multiTabEnabled'),
                    mode: config.get('strategy')
                });
            }
        });

        // Initial Status Update
        statusBar.update({
            autonomousEnabled: autonomousLoop.isRunning(),
            loopCount: 0,
            autoAllEnabled: config.get('autoAllEnabled'),
            multiTabEnabled: config.get('multiTabEnabled'),
            mode: config.get('strategy')
        });
        updateControllerRoleStatus();

        // Phase 39: Manual Triggers & Error Suppression
        // Note: cdpStrategy is expected to be defined elsewhere or passed into this scope.
        // For now, it's left as potentially undefined, which TypeScript will flag.
        // Assuming `cdpStrategy` refers to an instance of CDPHandler or similar.
        context.subscriptions.push(
            safeRegisterCommand('antigravity.getChromeDevtoolsMcpUrl', async () => {
                try {
                    const probePort = config.get<number>('cdpPort');
                    if (!probePort) {
                        return undefined;
                    }
                    const probe = new CDPHandler(probePort, probePort);
                    const instances = await probe.scanForInstances();
                    for (const instance of instances) {
                        const wsTarget = instance.pages.find((p: any) => typeof p?.webSocketDebuggerUrl === 'string' && p.webSocketDebuggerUrl.length > 0);
                        if (wsTarget?.webSocketDebuggerUrl) {
                            return wsTarget.webSocketDebuggerUrl as string;
                        }
                    }
                } catch (error: any) {
                    log.warn(`DevTools URL probe failed: ${String(error?.message || error || 'unknown error')}`);
                }

                const fallbackPort = config.get<number>('cdpPort');
                return `ws://127.0.0.1:${fallbackPort}`;
            }),
            safeRegisterCommand('antigravity.clickExpand', () => resolveCDPStrategy()?.executeAction('expand')),
            safeRegisterCommand('antigravity.resetConnection', async () => {
                const cdpStrategy = resolveCDPStrategy();
                if (cdpStrategy) {
                    vscode.window.showInformationMessage('Restoring Anti-Gravity...');
                    try {
                        if (!ensureControllerLeader('resetConnection', true)) {
                            return;
                        }
                        await strategyManager.stop();
                        await strategyManager.start();
                        vscode.window.showInformationMessage('Anti-Gravity Reset Complete.');
                    } catch (e) { vscode.window.showErrorMessage(`Reset Failed: ${e}`); }
                }
            })
        );

        // Register Commands
        // Internal-only commands are intentionally not contributed in package.json.
        // Current internal command policy allowlist: antigravity.getChromeDevtoolsMcpUrl
        context.subscriptions.push(
            safeRegisterCommand('antigravity.toggleExtension', async () => {
                await strategyManager.toggle();
                // Status bar update triggered by config listener or loop callback
            }),
            safeRegisterCommand('antigravity.toggleMasterControl', async () => {
                await toggleMasterControl();
            }),
            safeRegisterCommand('antigravity.enableMaximumAutopilot', async () => {
                await enableMaximumAutopilot('dashboard/command');
            }),
            safeRegisterCommand('antigravity.panicStop', async () => {
                await emergencyDisableAllAutonomy('panic command');
            }),
            safeRegisterCommand('antigravity.toggleAutoAccept', async () => {
                const next = !isUnifiedAutoAcceptEnabled();
                // Update Legacy
                await config.update('autopilotAutoAcceptEnabled', next);
                await config.update('autoAcceptEnabled', next);
                await config.update('autoAllEnabled', next);

                // Update New Actions
                await config.update('actions.autoAccept.enabled', next);
                await config.update('actions.bump.enabled', next); // Usually coupled

                if (next) {
                    if (ensureControllerLeader('toggleAutoAccept enable', true)) {
                        await strategyManager.start();
                    } else {
                        await strategyManager.stop();
                    }
                } else {
                    await strategyManager.stop();
                }
            }),
            safeRegisterCommand('antigravity.toggleAutoAll', async () => {
                const next = !isUnifiedAutoAcceptEnabled();
                // Update Legacy
                await config.update('autopilotAutoAcceptEnabled', next);
                await config.update('autoAcceptEnabled', next);
                await config.update('autoAllEnabled', next);

                // Update New Actions
                await config.update('actions.autoAccept.enabled', next);
                await config.update('actions.bump.enabled', next);
                await config.update('actions.run.enabled', next);
                await config.update('actions.expand.enabled', next);

                if (next) {
                    await config.update('strategy', 'cdp');
                }
                if (next) {
                    if (ensureControllerLeader('toggleAutoAll enable', true)) {
                        await strategyManager.start();
                    } else {
                        await strategyManager.stop();
                    }
                } else {
                    await strategyManager.stop();
                }
                await refreshRuntimeState();
            }),
            safeRegisterCommand('antigravity.clearAutoAll', async () => {
                // Clear Legacy
                await config.update('autopilotAutoAcceptEnabled', false);
                await config.update('autoAcceptEnabled', false);
                await config.update('autoAllEnabled', false);

                // Clear New Actions
                await config.update('actions.autoAccept.enabled', false);
                await config.update('actions.bump.enabled', false);
                await config.update('actions.run.enabled', false);
                await config.update('actions.expand.enabled', false);

                await strategyManager.stop();
                await refreshRuntimeState();
                vscode.window.showInformationMessage('Antigravity: Accept-All CLEARED (Disabled).');
            }),
            safeRegisterCommand('antigravity.toggleAutonomous', async () => {
                const isRunning = autonomousLoop.isRunning();
                if (isRunning) {
                    autonomousLoop.stop('User toggled off');
                    await config.update('autonomousEnabled', false);
                } else {
                    if (!ensureControllerLeader('toggleAutonomous enable', true)) {
                        return;
                    }
                    await autonomousLoop.start();
                    await config.update('autonomousEnabled', true);
                }
            }),
            safeRegisterCommand('antigravity.openSettings', () => {
                try {
                    DashboardPanel.createOrShow(context.extensionUri);
                } catch {
                    void openNativeExtensionSettings();
                }
            }),
            safeRegisterCommand('antigravity.openExtensionSettings', async () => {
                await openNativeExtensionSettings();
            }),
            safeRegisterCommand('antigravity.checkSettingsSurfacesHealth', async () => {
                await runSettingsSurfaceHealthCheck();
            }),
            safeRegisterCommand('antigravity.toggleMcp', async () => {
                const current = config.get<boolean>('mcpEnabled');
                if (current) {
                    await mcpServer.stop();
                } else {
                    if (!ensureControllerLeader('toggleMcp enable', true)) {
                        return;
                    }
                    await mcpServer.start();
                }
                await config.update('mcpEnabled', !current);
            }),
            safeRegisterCommand('antigravity.toggleVoice', async () => {
                const current = config.get<boolean>('voiceControlEnabled');
                if (current) {
                    await voiceControl.stop();
                } else {
                    if (!ensureControllerLeader('toggleVoice enable', true)) {
                        return;
                    }
                    await voiceControl.start();
                }
                await config.update('voiceControlEnabled', !current);
            }),
            safeRegisterCommand('antigravity.processVoiceTranscript', async () => {
                const transcript = await vscode.window.showInputBox({
                    prompt: 'Voice Transcript Debug',
                    placeHolder: 'Type the transcribed voice command, e.g. "open dashboard" or "resume"'
                });

                if (!transcript || !transcript.trim()) {
                    return;
                }

                const outcome = await voiceControl.processAndExecuteTranscription(transcript, { force: true });
                if (!outcome.command) {
                    vscode.window.showWarningMessage('Voice Debug: no command parsed from transcript.');
                    return;
                }

                if (outcome.handled) {
                    vscode.window.showInformationMessage(`Voice Debug: executed intent "${outcome.command.intent}".`);
                    return;
                }

                const reason = outcome.error ? ` (${outcome.error})` : '';
                vscode.window.showWarningMessage(`Voice Debug: intent "${outcome.command.intent}" not executed${reason}.`);
            }),
            safeRegisterCommand('antigravity.generateTests', async () => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    await testGenerator.generateTestsForFile(editor.document.fileName);
                } else {
                    vscode.window.showErrorMessage('No active file to generate tests for');
                }
            }),
            safeRegisterCommand('antigravity.runCodeReview', async () => {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    const code = editor.document.getText();
                    const result = codeReviewer.review(code, editor.document.fileName);

                    // Show diagnostics
                    const diagnostics = codeReviewer.showDiagnostics(editor.document, result.issues);
                    const collection = vscode.languages.createDiagnosticCollection('antigravity-review');
                    collection.set(editor.document.uri, diagnostics);

                    if (result.passed) {
                        vscode.window.showInformationMessage(`Code Review Passed! Score: ${result.score}`);
                    } else {
                        vscode.window.showWarningMessage(`Code Review Failed. Score: ${result.score}. See Problems panel.`);
                    }
                } else {
                    vscode.window.showErrorMessage('No active file to review');
                }
            }),
            safeRegisterCommand('antigravity.startMultiAgent', async () => {
                const task = await vscode.window.showInputBox({ prompt: 'Enter task for Multi-Agent System' });
                if (task) {
                    await agentOrchestrator.coordinateAgents(task);
                }
            }),
            safeRegisterCommand('antigravity.showMemory', async () => {
                const memories = memoryManager.getRecentMemories(20);
                const items = memories.map(m => {
                    const lines = m.content.split('\n');
                    const preview = lines[0].substring(0, 60) + (lines[0].length > 60 ? '...' : '');
                    return {
                        label: `[${m.type.toUpperCase()}] ${preview}`,
                        description: new Date(m.timestamp).toLocaleString(),
                        detail: m.content // Full content accessible? VS Code might truncate detail.
                    };
                });
                const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Recent Memories (Select to view full)' });
                if (selection && selection.detail) {
                    // Show full content in a document or nice output
                    const doc = await vscode.workspace.openTextDocument({ content: selection.detail, language: 'markdown' });
                    await vscode.window.showTextDocument(doc);
                }
            }),
            safeRegisterCommand('antigravity.showStatusMenu', async () => {
                await refreshRuntimeState();
                const leaseLeader = controllerLease?.getLeaderInfo();
                const leaseIsLeader = isControllerLeader();
                const statusGuard = latestRuntimeState ? getAutoResumeGuardReport(latestRuntimeState) : null;
                const statusTiming = latestRuntimeState
                    ? getAutoResumeTimingReport(latestRuntimeState?.status === 'waiting_for_chat_message' || latestRuntimeState?.waitingForChatMessage === true)
                    : null;
                const telemetryStaleSec = Math.max(3, config.get<number>('runtimeTelemetryStaleSec') || 12);
                const refreshDebounceMs = Math.max(100, Math.min(5000, config.get<number>('runtimeStatusMenuRefreshDebounceMs') || 800));
                const refreshDebugLogsEnabled = !!config.get<boolean>('runtimeStatusMenuRefreshDebugLogs');
                const runtimeTimestamp = Number((latestRuntimeState as any)?.timestamp || Date.now());
                const telemetryAgeMs = Math.max(0, Date.now() - runtimeTimestamp);
                const telemetryIsStale = telemetryAgeMs > (telemetryStaleSec * 1000);
                const runtimeHeaderLabel = telemetryIsStale
                    ? '$(warning) Runtime [STALE]: ' + runtimeSummary(latestRuntimeState)
                    : '$(graph) Runtime: ' + runtimeSummary(latestRuntimeState);
                const escalationStateLabel = watchdogEscalationForceFullNext ? 'ARMED' : 'IDLE';
                const items = [
                    {
                        label: runtimeHeaderLabel,
                        description: `Live runtime snapshot (read-only) | telemetry age ${formatDurationShort(telemetryAgeMs)} | stale threshold ${telemetryStaleSec}s`,
                        action: undefined as string | undefined
                    },
                    {
                        label: `$(account) Controller Role: ${leaseIsLeader ? 'LEADER' : 'FOLLOWER'}`,
                        description: leaseIsLeader
                            ? 'This window is the active automation controller'
                            : `Follower mode; active leader workspace: ${leaseLeader?.workspace || 'unknown'}`,
                        action: 'antigravity.showControllerLeaseState'
                    },
                    {
                        label: '$(sync) Refresh Runtime + Reopen Status Menu',
                        description: 'Force runtime refresh, then reopen this menu for rapid staleness checks',
                        action: 'antigravity.refreshRuntimeAndReopenStatusMenu'
                    },
                    {
                        label: '$(settings-gear) Status Refresh: debounce/debug',
                        description: `debounce=${refreshDebounceMs}ms | debugLogs=${refreshDebugLogsEnabled ? 'ON' : 'OFF'} | dropped total=${refreshStatusMenuDroppedTotal} (in-flight=${refreshStatusMenuDroppedInFlight}, debounce=${refreshStatusMenuDroppedDebounce})`,
                        action: undefined as string | undefined
                    },
                    {
                        label: '$(clear-all) Reset Refresh Counters',
                        description: 'Reset session-local status refresh guard counters to zero',
                        action: 'antigravity.resetStatusRefreshCounters'
                    },
                    {
                        label: '$(watch) Guard: ' + (statusGuard ? (statusGuard.allowed ? 'ALLOW' : 'BLOCK') : 'n/a'),
                        description: statusGuard
                            ? `score ${statusGuard.health.score}/${statusGuard.minScore}, strict ${statusGuard.health.strictPass ? 'PASS' : 'FAIL'}${statusGuard.requireStrict ? ' (required)' : ''}, next ${statusTiming ? formatDurationShort(statusTiming.nextEligibleAt - Date.now()) : '-'} | (${statusGuard.recommendedNextActionConfidence}) ${statusGuard.recommendedNextAction}`
                            : 'Auto-resume guard state unavailable',
                        action: 'antigravity.explainAutoResumeGuard'
                    },
                    {
                        label: '$(pulse) Escalation: ' + escalationStateLabel,
                        description: buildEscalationHealthSummaryLine(),
                        action: 'antigravity.showEscalationMenu'
                    },
                    {
                        label: '$(rocket) Start Autonomous Loop (Yoke)',
                        description: 'Full AI Agent Mode',
                        action: 'antigravity.toggleAutonomous'
                    },
                    {
                        label: '$(pulse) Enable Auto-All (CDP)',
                        description: 'Auto-edits & Terminal (Passive)',
                        action: 'antigravity.toggleAutoAll'
                    },
                    {
                        label: '$(check) Enable Auto-Accept (Simple)',
                        description: 'Basic Auto-Accept only',
                        action: 'antigravity.toggleAutoAccept'
                    },
                    {
                        label: '$(gear) Open Dashboard',
                        description: 'Configure settings',
                        action: 'antigravity.openSettings'
                    },
                    {
                        label: '$(settings-gear) Open Native Extension Settings',
                        description: 'Open host Settings filtered to this extension',
                        action: 'antigravity.openExtensionSettings'
                    },
                    {
                        label: '$(pulse) Settings Surfaces Health Check',
                        description: 'Verify dashboard/native settings entrypoints and command availability',
                        action: 'antigravity.checkSettingsSurfacesHealth'
                    },
                    {
                        label: '$(pulse) Check Runtime State',
                        description: 'Inspect processing/waiting/completion status',
                        action: 'antigravity.checkRuntimeState'
                    },
                    {
                        label: '$(info) Detect Completion + Waiting State',
                        description: 'Determine if all tasks are complete and chat is waiting to resume',
                        action: 'antigravity.detectCompletionWaitingState'
                    },
                    {
                        label: '$(debug-start) Resume From Waiting State',
                        description: 'Send configured resume message to keep Copilot chat moving',
                        action: 'antigravity.resumeFromWaitingState'
                    },
                    {
                        label: '$(shield) Validate Cross-UI Coverage',
                        description: 'Check Antigravity/VS Code send+button detection coverage',
                        action: 'antigravity.validateCrossUiCoverage'
                    },
                    {
                        label: '$(beaker) Run Cross-UI Self-Test',
                        description: 'Generate structured readiness report for Antigravity/VS Code/Cursor',
                        action: 'antigravity.runCrossUiSelfTest'
                    },
                    {
                        label: '$(question) Explain Auto-Resume Guard',
                        description: 'Show why auto-resume is allowed or blocked and how to fix it',
                        action: 'antigravity.explainAutoResumeGuard'
                    },
                    {
                        label: '$(tools) Auto-Fix Resume Readiness',
                        description: 'Run safe recovery steps, then re-check guard status',
                        action: 'antigravity.autoFixAutoResumeReadiness'
                    },
                    {
                        label: '$(clippy) Copy Runtime State JSON',
                        description: 'Copy full runtime snapshot to clipboard',
                        action: 'antigravity.copyRuntimeStateJson'
                    },
                    {
                        label: '$(note) Copy Last Resume Payload Report',
                        description: 'Copy/open structured telemetry for the last continuation message',
                        action: 'antigravity.copyLastResumePayloadReport'
                    },
                    {
                        label: '$(pulse) Copy Escalation Diagnostics',
                        description: 'Copy/open focused watchdog escalation diagnostics JSON',
                        action: 'antigravity.copyEscalationDiagnosticsReport'
                    },
                    {
                        label: '$(copy) Copy Escalation Health Summary',
                        description: 'Copy/open compact one-line escalation status summary',
                        action: 'antigravity.copyEscalationHealthSummary'
                    },
                    {
                        label: '$(list-tree) Escalation Controls',
                        description: 'Open grouped escalation diagnostics/reset actions',
                        action: 'antigravity.showEscalationMenu'
                    },
                    {
                        label: '$(trash) Clear Escalation Timeline',
                        description: 'Reset in-memory escalation event buffer and related escalation flags',
                        action: 'antigravity.clearEscalationTimeline'
                    },
                    {
                        label: '$(zap) Clear Escalation Timeline (No Prompt)',
                        description: 'Immediate reset for power users; bypasses confirmation dialog',
                        action: 'antigravity.clearEscalationTimelineNow'
                    }
                ];

                const selection = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Antigravity Status: Select Mode'
                });

                if (selection && selection.action) {
                    vscode.commands.executeCommand(selection.action);
                }
            }),
            safeRegisterCommand('antigravity.syncProjectTasks', async () => {
                await projectManager.syncFromFixPlan();
                vscode.window.showInformationMessage('Project tasks synced from planner files (task.md → TODO.md → @fix_plan.md → ROADMAP.md).');
            }),
            safeRegisterCommand('antigravity.showControllerLeaseState', async () => {
                const leader = controllerLease?.getLeaderInfo();
                const payload = {
                    timestamp: new Date().toISOString(),
                    role: isControllerLeader() ? 'leader' : 'follower',
                    thisWindow: {
                        pid: process.pid,
                        workspace: workspaceId
                    },
                    leader
                };

                updateControllerRoleStatus();

                const serialized = JSON.stringify(payload, null, 2);
                await vscode.env.clipboard.writeText(serialized);
                const doc = await vscode.workspace.openTextDocument({ content: serialized, language: 'json' });
                await vscode.window.showTextDocument(doc, { preview: false });
                vscode.window.showInformationMessage(`Antigravity controller role: ${payload.role.toUpperCase()} (report copied to clipboard).`);
            }),
            safeRegisterCommand('antigravity.checkRuntimeState', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state) {
                    vscode.window.showWarningMessage('Antigravity: Runtime state unavailable (CDP not connected or script not injected yet).');
                    return;
                }

                const status = state.status || 'unknown';
                const done = state.doneTabs ?? 0;
                const total = state.totalTabs ?? 0;
                const pending = state.pendingAcceptButtons ?? 0;
                const waiting = state.waitingForChatMessage ? 'yes' : 'no';
                const guard = getAutoResumeGuardReport(state);
                const timing = getAutoResumeTimingReport(state?.status === 'waiting_for_chat_message' || state?.waitingForChatMessage === true);
                const nextIn = formatDurationShort(Math.max(0, timing.nextEligibleAt - Date.now()));
                const stablePollsRequired = Math.max(1, Math.min(10, config.get<number>('runtimeAutoResumeStabilityPolls') || 2));
                const completion = state.completionWaiting;
                const completionReady = completion?.readyToResume === true;
                const completionConfidence = completion?.confidence ?? '-';
                const completionConfidenceLabel = completion?.confidenceLabel || 'n/a';

                statusBar.updateRuntimeState(state);
                latestRuntimeState = state;
                log.info(`[RuntimeState] status=${status} tabs=${done}/${total} pending=${pending} waitingForChatMessage=${waiting} readyToResume=${completionReady} confidence=${completionConfidence}(${completionConfidenceLabel}) streak=${readyToResumeStreak}/${stablePollsRequired} guard=${guard.allowed ? 'allow' : 'block'} reason=${guard.reason} next=${nextIn}`);
                vscode.window.showInformationMessage(`Antigravity Runtime: ${status} | tabs ${done}/${total} | pending ${pending} | waiting chat: ${waiting} | ready=${completionReady ? 'yes' : 'no'} (${completionConfidenceLabel}) | streak: ${readyToResumeStreak}/${stablePollsRequired} | guard: ${guard.allowed ? 'allow' : 'block'} | next eligible: ${nextIn}`);
            }),
            safeRegisterCommand('antigravity.detectCompletionWaitingState', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state) {
                    vscode.window.showWarningMessage('Antigravity: Runtime state unavailable.');
                    return;
                }

                const fallbackVerdict = {
                    readyToResume: !!state.isRunning && !!state.waitingForChatMessage,
                    isComplete: !!state.allTasksComplete,
                    isWaitingForChatMessage: !!state.waitingForChatMessage,
                    confidence: 50,
                    confidenceLabel: 'medium',
                    reasons: ['fallback verdict used (completionWaiting not provided by runtime script)'],
                    recommendedAction: state.waitingForChatMessage
                        ? 'Safe to send a resume message and continue development.'
                        : 'Wait for waiting_for_chat_message state or run Auto-Fix Resume Readiness.'
                };

                const verdict = (state.completionWaiting && typeof state.completionWaiting === 'object')
                    ? state.completionWaiting
                    : fallbackVerdict;

                const payload = {
                    timestamp: new Date().toISOString(),
                    runtimeStatus: state.status || 'unknown',
                    mode: state.mode || 'unknown',
                    tabs: {
                        done: state.doneTabs ?? 0,
                        total: state.totalTabs ?? 0
                    },
                    completionWaiting: verdict
                };

                const serialized = JSON.stringify(payload, null, 2);
                await vscode.env.clipboard.writeText(serialized);
                const doc = await vscode.workspace.openTextDocument({ content: serialized, language: 'json' });
                await vscode.window.showTextDocument(doc, { preview: false });

                const summary = `Completion+Waiting: ready=${verdict.readyToResume ? 'YES' : 'NO'} | complete=${verdict.isComplete ? 'YES' : 'NO'} | waiting=${verdict.isWaitingForChatMessage ? 'YES' : 'NO'} | confidence=${verdict.confidence ?? '-'} (${verdict.confidenceLabel || 'n/a'})`;
                log.info(`[CompletionWaiting] ${summary} | action=${verdict.recommendedAction || 'n/a'}`);
                vscode.window.showInformationMessage(summary + ' Report copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.copyRuntimeStateJson', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state) {
                    vscode.window.showWarningMessage('Antigravity: Runtime state unavailable.');
                    return;
                }

                latestRuntimeState = state;
                await vscode.env.clipboard.writeText(JSON.stringify(state, null, 2));
                vscode.window.showInformationMessage('Antigravity runtime state JSON copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.refreshRuntimeAndReopenStatusMenu', async () => {
                const now = Date.now();
                const debounceMs = Math.max(100, Math.min(5000, config.get<number>('runtimeStatusMenuRefreshDebounceMs') || 800));
                const debugLogsEnabled = !!config.get<boolean>('runtimeStatusMenuRefreshDebugLogs');

                if (refreshStatusMenuInFlight) {
                    refreshStatusMenuDroppedTotal += 1;
                    refreshStatusMenuDroppedInFlight += 1;
                    if (debugLogsEnabled) {
                        log.info(`[StatusRefresh] Skipped: refresh already in flight. dropped(total=${refreshStatusMenuDroppedTotal}, inFlight=${refreshStatusMenuDroppedInFlight}, debounce=${refreshStatusMenuDroppedDebounce})`);
                    }
                    return;
                }
                if ((now - lastRefreshStatusMenuAt) < debounceMs) {
                    refreshStatusMenuDroppedTotal += 1;
                    refreshStatusMenuDroppedDebounce += 1;
                    if (debugLogsEnabled) {
                        const remainingMs = debounceMs - (now - lastRefreshStatusMenuAt);
                        log.info(`[StatusRefresh] Skipped: debounce active (${remainingMs}ms remaining). dropped(total=${refreshStatusMenuDroppedTotal}, inFlight=${refreshStatusMenuDroppedInFlight}, debounce=${refreshStatusMenuDroppedDebounce})`);
                    }
                    return;
                }

                refreshStatusMenuInFlight = true;
                try {
                    if (debugLogsEnabled) {
                        log.info(`[StatusRefresh] Running refresh + reopen (debounce=${debounceMs}ms).`);
                    }
                    await refreshRuntimeState().catch(() => { });
                    lastRefreshStatusMenuAt = Date.now();
                    await vscode.commands.executeCommand('antigravity.showStatusMenu');
                    if (debugLogsEnabled) {
                        log.info('[StatusRefresh] Completed refresh + reopen.');
                    }
                } finally {
                    refreshStatusMenuInFlight = false;
                }
            }),
            safeRegisterCommand('antigravity.resetStatusRefreshCounters', async () => {
                refreshStatusMenuDroppedTotal = 0;
                refreshStatusMenuDroppedInFlight = 0;
                refreshStatusMenuDroppedDebounce = 0;
                log.info('[StatusRefresh] Guard drop counters reset.');
                vscode.window.showInformationMessage('Antigravity: status refresh counters reset.');
            }),
            safeRegisterCommand('antigravity.copyLastResumePayloadReport', async () => {
                const cdp = resolveCDPStrategy();
                const state = cdp ? await cdp.getRuntimeState() : latestRuntimeState;
                if (state) {
                    latestRuntimeState = state;
                }

                const report = buildLastResumePayloadReport(state);
                const serialized = JSON.stringify(report, null, 2);
                await vscode.env.clipboard.writeText(serialized);

                const doc = await vscode.workspace.openTextDocument({
                    content: serialized,
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                vscode.window.showInformationMessage('Antigravity: last resume payload report copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.copyEscalationDiagnosticsReport', async () => {
                const cdp = resolveCDPStrategy();
                const state = cdp ? await cdp.getRuntimeState() : latestRuntimeState;
                if (state) {
                    latestRuntimeState = state;
                }

                const report = buildEscalationDiagnosticsReport(state);
                const serialized = JSON.stringify(report, null, 2);
                await vscode.env.clipboard.writeText(serialized);

                const doc = await vscode.workspace.openTextDocument({
                    content: serialized,
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                vscode.window.showInformationMessage('Antigravity: escalation diagnostics report copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.copyEscalationHealthSummary', async () => {
                await refreshRuntimeState().catch(() => { });
                const summary = buildEscalationHealthSummaryLine();
                await vscode.env.clipboard.writeText(summary);

                const doc = await vscode.workspace.openTextDocument({
                    content: summary,
                    language: 'text'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                vscode.window.showInformationMessage('Antigravity: escalation health summary copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.showEscalationMenu', async () => {
                const items = [
                    {
                        label: '$(pulse) Copy Escalation Diagnostics',
                        description: 'Copy/open focused escalation watchdog diagnostics report',
                        action: 'antigravity.copyEscalationDiagnosticsReport'
                    },
                    {
                        label: '$(copy) Copy Escalation Health Summary',
                        description: 'Copy/open compact one-line escalation status summary',
                        action: 'antigravity.copyEscalationHealthSummary'
                    },
                    {
                        label: '$(note) Copy Last Resume Payload',
                        description: 'Copy/open full continuation telemetry payload report',
                        action: 'antigravity.copyLastResumePayloadReport'
                    },
                    {
                        label: '$(trash) Clear Escalation Timeline',
                        description: 'Clear escalation timeline with confirmation (if enabled)',
                        action: 'antigravity.clearEscalationTimeline'
                    },
                    {
                        label: '$(zap) Clear Escalation Timeline (No Prompt)',
                        description: 'Immediate clear path for power users',
                        action: 'antigravity.clearEscalationTimelineNow'
                    },
                    {
                        label: '$(gear) Open Dashboard',
                        description: 'Open dashboard runtime controls and settings',
                        action: 'antigravity.openSettings'
                    },
                    {
                        label: '$(settings-gear) Open Native Extension Settings',
                        description: 'Open host settings filtered to this extension',
                        action: 'antigravity.openExtensionSettings'
                    },
                    {
                        label: '$(pulse) Settings Surfaces Health Check',
                        description: 'Verify dashboard/native settings and command availability',
                        action: 'antigravity.checkSettingsSurfacesHealth'
                    }
                ];

                const selection = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Escalation Controls'
                });
                if (selection?.action) {
                    await vscode.commands.executeCommand(selection.action);
                }
            }),
            safeRegisterCommand('antigravity.clearEscalationTimeline', async () => {
                const requireConfirm = config.get<boolean>('runtimeEscalationClearRequireConfirm');
                if (requireConfirm) {
                    const choice = await vscode.window.showWarningMessage(
                        'Clear escalation timeline and reset escalation flags?',
                        { modal: true },
                        'Clear',
                        'Cancel'
                    );
                    if (choice !== 'Clear') {
                        return;
                    }
                }

                await clearEscalationTimelineState('confirmed-command');
                vscode.window.showInformationMessage('Antigravity: escalation timeline cleared.');
            }),
            safeRegisterCommand('antigravity.clearEscalationTimelineNow', async () => {
                await clearEscalationTimelineState('no-prompt-command');
                vscode.window.showInformationMessage('Antigravity: escalation timeline cleared (no prompt).');
            }),
            safeRegisterCommand('antigravity.resumeFromWaitingState', async () => {
                await sendAutoResumeMessage('manual', latestRuntimeState);
            }),
            safeRegisterCommand('antigravity.validateCrossUiCoverage', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state || !state.profileCoverage) {
                    vscode.window.showWarningMessage('Antigravity: profile coverage is unavailable.');
                    return;
                }

                const ag = state.profileCoverage.antigravity;
                const vs = state.profileCoverage.vscode;

                const agReady = !!ag && (ag.hasVisibleInput || ag.hasVisibleSendButton || ag.pendingAcceptButtons > 0);
                const vsReady = !!vs && (vs.hasVisibleInput || vs.hasVisibleSendButton || vs.pendingAcceptButtons > 0);

                const summary = `Coverage — Antigravity: ${agReady ? 'ready' : 'no-signals'} | VS Code: ${vsReady ? 'ready' : 'no-signals'}`;
                log.info(`[CrossUI] ${summary}`);
                vscode.window.showInformationMessage(summary);
            }),
            safeRegisterCommand('antigravity.runCrossUiSelfTest', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state || !state.profileCoverage) {
                    vscode.window.showWarningMessage('Antigravity: profile coverage is unavailable.');
                    return;
                }

                const coverage = state.profileCoverage as any;
                const evaluate = (name: string, cov: any) => {
                    const hasInput = !!cov?.hasVisibleInput;
                    const hasSend = !!cov?.hasVisibleSendButton;
                    const pending = Number(cov?.pendingAcceptButtons || 0);
                    const ready = hasInput || hasSend || pending > 0;
                    return { name, ready, hasInput, hasSend, pending };
                };

                const report = {
                    timestamp: new Date().toISOString(),
                    runtimeStatus: state.status || 'unknown',
                    mode: state.mode || 'unknown',
                    waitingForChatMessage: !!state.waitingForChatMessage,
                    tabs: {
                        done: state.doneTabs ?? 0,
                        total: state.totalTabs ?? 0
                    },
                    profiles: {
                        vscode: evaluate('vscode', coverage.vscode),
                        antigravity: evaluate('antigravity', coverage.antigravity),
                        cursor: evaluate('cursor', coverage.cursor)
                    }
                };

                const health = evaluateCrossUiHealth(state);
                const strict = health.strict;
                const scoreParts = health.scoreParts;
                const score = health.score;
                const grade = health.grade;
                const bothPrimaryProfilesStrictReady = health.strictPass;

                const suggestions: string[] = [];
                if (!report.profiles.vscode.ready) {
                    suggestions.push('VS Code coverage has no active signals; verify chat panel is visible and focused.');
                }
                if (!report.profiles.antigravity.ready) {
                    suggestions.push('Antigravity coverage has no active signals; verify agent panel is open.');
                }
                if (!report.profiles.cursor.ready) {
                    suggestions.push('Cursor coverage has no active signals; this is normal if not running in Cursor.');
                }
                if (report.waitingForChatMessage) {
                    suggestions.push('Runtime is waiting for chat message; use Resume From Waiting State or enable auto-resume.');
                }
                if (!strict.vscodeTextReady) {
                    suggestions.push('VS Code text-input signal missing; ensure chat input is visible and selected.');
                }
                if (!strict.vscodeButtonReady) {
                    suggestions.push('VS Code submit/accept signal missing; ensure send button or pending action buttons are visible.');
                }
                if (!strict.antigravityTextReady) {
                    suggestions.push('Antigravity text-input signal missing; ensure the agent panel input is visible.');
                }
                if (!strict.antigravityButtonReady) {
                    suggestions.push('Antigravity submit/accept signal missing; ensure send button or pending action buttons are visible.');
                }

                const fullReport = {
                    ...report,
                    strict,
                    score,
                    grade,
                    scoreParts,
                    bothPrimaryProfilesStrictReady,
                    suggestions
                };

                const serialized = JSON.stringify(fullReport, null, 2);
                await vscode.env.clipboard.writeText(serialized);
                const doc = await vscode.workspace.openTextDocument({
                    content: serialized,
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                const summary = `Cross-UI self-test complete. Score=${score}/100 (${grade}) | strict primary readiness=${bothPrimaryProfilesStrictReady ? 'PASS' : 'FAIL'} | VSCode=${report.profiles.vscode.ready ? 'ready' : 'no-signals'}, Antigravity=${report.profiles.antigravity.ready ? 'ready' : 'no-signals'}, Cursor=${report.profiles.cursor.ready ? 'ready' : 'no-signals'}.`;
                log.info(`[CrossUI SelfTest] ${summary}`);
                vscode.window.showInformationMessage(summary + ' Report copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.explainAutoResumeGuard', async () => {
                const cdp = resolveCDPStrategy();
                if (!cdp) {
                    vscode.window.showWarningMessage('Antigravity: CDP strategy is not active.');
                    return;
                }

                const state = await cdp.getRuntimeState();
                if (!state || !state.profileCoverage) {
                    vscode.window.showWarningMessage('Antigravity: runtime/profile coverage is unavailable.');
                    return;
                }

                const guard = getAutoResumeGuardReport(state);
                const isWaiting = state?.status === 'waiting_for_chat_message' || state?.waitingForChatMessage === true;
                const timing = getAutoResumeTimingReport(isWaiting);
                const payload = {
                    timestamp: new Date().toISOString(),
                    runtimeStatus: state.status || 'unknown',
                    waitingForChatMessage: !!state.waitingForChatMessage,
                    autoResumeEnabled: config.get<boolean>('runtimeAutoResumeEnabled'),
                    autoResumeTelemetry: {
                        waitingStateSince,
                        lastAutoResumeAt,
                        lastAutoResumeOutcome,
                        lastAutoResumeBlockedReason,
                        lastAutoResumeMessageKind,
                        lastAutoResumeMessageProfile,
                        lastAutoResumeMessagePreview,
                        timing
                    },
                    guard: {
                        allowed: guard.allowed,
                        reason: guard.reason,
                        reasons: guard.reasons,
                        recommendedNextAction: guard.recommendedNextAction,
                        recommendedNextActionConfidence: guard.recommendedNextActionConfidence,
                        minScore: guard.minScore,
                        requireStrict: guard.requireStrict,
                        scorePass: guard.scorePass,
                        strictPass: guard.strictPass
                    },
                    health: {
                        score: guard.health.score,
                        grade: guard.health.grade,
                        strict: guard.health.strict,
                        scoreParts: guard.health.scoreParts,
                        profiles: guard.health.profiles
                    },
                    suggestions: guard.suggestions,
                    recommendedNextAction: guard.recommendedNextAction,
                    recommendedNextActionConfidence: guard.recommendedNextActionConfidence
                };

                const serialized = JSON.stringify(payload, null, 2);
                await vscode.env.clipboard.writeText(serialized);

                const doc = await vscode.workspace.openTextDocument({
                    content: serialized,
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                const summary = `Auto-resume guard: ${guard.allowed ? 'ALLOW' : 'BLOCK'} | score=${guard.health.score}/${guard.minScore} (${guard.health.grade}) | strict=${guard.health.strictPass ? 'PASS' : 'FAIL'}${guard.requireStrict ? ' (required)' : ' (optional)'} | reason=${guard.reason}`;
                log.info(`[AutoResume Guard] ${summary}`);
                vscode.window.showInformationMessage(summary + ' Report copied to clipboard.');
            }),
            safeRegisterCommand('antigravity.autoFixAutoResumeReadiness', async () => {
                const report = await runAutoResumeReadinessFix();
                const serialized = JSON.stringify(report, null, 2);
                await vscode.env.clipboard.writeText(serialized);

                const doc = await vscode.workspace.openTextDocument({
                    content: serialized,
                    language: 'json'
                });
                await vscode.window.showTextDocument(doc, { preview: false });

                const beforeAllowed = report.before?.allowed;
                const afterAllowed = report.after?.allowed;
                const summary = `Auto-fix readiness complete | before=${beforeAllowed === undefined || beforeAllowed === null ? 'n/a' : (beforeAllowed ? 'ALLOW' : 'BLOCK')} | after=${afterAllowed === undefined || afterAllowed === null ? 'n/a' : (afterAllowed ? 'ALLOW' : 'BLOCK')} | improved=${report.improved ? 'yes' : 'no'} | retry=${report.immediateRetry?.attempted ? (report.immediateRetry?.sent ? 'sent' : 'failed') : 'skipped'}.`;
                log.info(`[AutoResume Fix] ${summary}`);
                const actionHint = report.after?.recommendedNextAction || report.before?.recommendedNextAction || 'See report for details.';
                vscode.window.showInformationMessage(summary + ` Next: ${actionHint} Report copied to clipboard.`);
            }),
            safeRegisterCommand('antigravity.testAudio', async () => {
                const items = SOUND_EFFECTS.map(effect => ({
                    label: `$(symbol-event) Play Sound: ${effect}`,
                    description: `Trigger the "${effect}" sound effect`,
                    effect
                }));

                const selection = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a sound effect to test'
                });

                if (selection) {
                    SoundEffects.play(selection.effect);
                }
            }),
            safeRegisterCommand('antigravity.writeAndSubmitBump', async () => {
                const message = config.get<string>('actions.bump.text') || config.get<string>('bumpMessage') || 'bump';
                await sendAutoResumeMessage('manual', null, { messageOverride: message } as any);
                vscode.window.showInformationMessage(`Antigravity: Bump message "${message}" submitted.`);
            }),
            safeRegisterCommand('antigravity.clickAccept', async () => {
                const cdp = resolveCDPStrategy();
                if (cdp && await cdp.executeAction('accept')) return;

                const commands = [
                    'interactive.acceptChanges',
                    'workbench.action.terminal.chat.accept',
                    'inlineChat.accept',
                    'workbench.action.chat.submit', // Fallback
                    'workbench.action.chat.send',
                    'notifications.acceptAction',
                    'workbench.action.acceptSelectedQuickOpenItem'
                ];
                for (const cmd of commands) {
                    try { await vscode.commands.executeCommand(cmd); } catch { }
                }
            }),
            safeRegisterCommand('antigravity.clickRun', async () => {
                const cdp = resolveCDPStrategy();
                if (cdp && await cdp.executeAction('run')) return;

                const commands = [
                    'workbench.action.debug.start',
                    'workbench.action.debug.run',
                    'code-runner.run'
                ];
                for (const cmd of commands) {
                    try { await vscode.commands.executeCommand(cmd); } catch { }
                }
            }),
            safeRegisterCommand('antigravity.clickExpand', async () => {
                const cdp = resolveCDPStrategy();
                if (cdp && await cdp.executeAction('expand')) return;

                // Expand often implies showing more context or opening a view
                // For now, we try opening chat or focusing sidebar as a proxy for "expanding" interaction area
                const commands = [
                    'workbench.action.chat.openInSideBar',
                    'workbench.action.chat.open',
                    'workbench.panel.chat.view.copilot.focus'
                ];
                for (const cmd of commands) {
                    try { await vscode.commands.executeCommand(cmd); } catch { }
                }
            }),
            safeRegisterCommand('antigravity.forceAcquireLeader', async () => {
                if (controllerLease) {
                    controllerLease.forceAcquire();
                    updateControllerRoleStatus();
                    vscode.window.showInformationMessage('Antigravity: Forcibly acquired Leader role for this window.');
                }
            }),
            safeRegisterCommand('antigravity.startRemoteServer', async () => {
                if (remoteServer) {
                    remoteServer.toggle();
                } else {
                    remoteServer = await activateRemoteServer(context);
                }
            })
        );

        const runtimeStateTimer = setInterval(() => {
            refreshRuntimeState().catch(() => { });
        }, 3000);
        context.subscriptions.push({ dispose: () => clearInterval(runtimeStateTimer) });

        // Initialize based on saved config
        if (isUnifiedAutoAcceptEnabled()) {
            // CDP Strategy should run in ALL windows to ensure UI actions (Run, Expand, Accept) 
            // always work even if the current window is a "Passive Follower".
            // The browser script (auto-continue.ts) handles its own action safety.
            try {
                strategyManager.start().catch(e => log.error(`Failed to start decentralized strategy: ${e.message}`));
                refreshRuntimeState().catch(() => { });
            } catch (e) {
                log.error(`Critical stall in strategy bootstrap: ${e}`);
            }

            if (ensureControllerLeader('activation bootstrap')) {
                // 2. Autonomous Loop (The "Brain" - stays gated to one leader)
                if (config.get('autonomousEnabled')) {
                    autonomousLoop.start().catch(e => log.error(`Failed to start autonomous loop: ${e.message}`));
                }

                // 3. Modules
                if (config.get('mcpEnabled')) {
                    mcpServer.start().catch(e => log.error(`MCP start failed: ${e.message}`));
                }
                if (config.get('voiceControlEnabled')) {
                    voiceControl.start().catch(e => log.error(`Voice start failed: ${e.message}`));
                }

                if (config.get('remoteControlEnabled')) {
                    if (!remoteServer) {
                        activateRemoteServer(context).then((server: RemoteServer) => {
                            remoteServer = server;
                        }).catch((e: Error) => log.error(`RemoteServer start failed: ${e.message}`));
                    }
                }

                log.info('Antigravity Autopilot: Brain ACTIVE as controller leader.');
            } else {
                // Follower mode: stop high-level services but KEEP decentralized automation (StrategyManager) running
                autonomousLoop.stop('Follower mode bootstrap');
                mcpServer.stop().catch(() => { });
                voiceControl.stop().catch(() => { });
                log.info('Antigravity Autopilot: Brain PASSIVE (Leader in another workspace). UI automation ACTIVE.');
            }
        }
    } catch (e: any) {
        fs.appendFileSync(path.join(os.homedir() || os.tmpdir(), 'antigravity-activation.log'), `[${new Date().toISOString()}] FATAL ACTIVATION ERROR: ${e?.stack || e}\n`);
    }
}

export function deactivate() {
    controllerLease?.stop();
    controllerLease = null;
    autonomousLoop.stop('Deactivating');
    mcpServer.stop();
    voiceControl.stop();
    if (statusBar) statusBar.dispose();
    log.info('Antigravity Autopilot deactivated');
}