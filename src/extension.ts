import * as vscode from 'vscode';
import * as path from 'path';
import { DashboardPanel } from './ui/dashboard';
import { config } from './utils/config';
import { createLogger } from './utils/logger';
import { autonomousLoop } from './core/autonomous-loop';
// import { circuitBreaker } from './core/circuit-breaker'; // Removed unused import
import { progressTracker } from './core/progress-tracker';
import { mcpServer } from './modules/mcp/server';
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

import { StatusBarManager } from './ui/status-bar';
import { CDPStrategy, CDPRuntimeState } from './strategies/cdp-strategy';

import { SoundEffects, SOUND_EFFECTS } from './utils/sound-effects';

const log = createLogger('Extension');
let statusBar: StatusBarManager;
export function activate(context: vscode.ExtensionContext) {
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
    let latestRuntimeState: CDPRuntimeState | null = null;
    let waitingStateSince: number | null = null;
    let lastWaitingReminderAt = 0;
    let lastAutoResumeAt = 0;
    let readyToResumeStreak = 0;
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

            if (autoResumeEnabled && waitingElapsed >= waitingDelayMs && (now - lastAutoResumeAt) >= autoResumeCooldownMs && readyToResumeStreak >= stablePollsRequired) {
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
            } else if (autoResumeEnabled && waitingElapsed >= waitingDelayMs && (now - lastAutoResumeAt) >= autoResumeCooldownMs && readyToResumeStreak < stablePollsRequired) {
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

    const runtimeSummary = (state: CDPRuntimeState | null): string => {
        if (!state) return 'state unavailable';
        const status = state.status || 'unknown';
        const done = state.doneTabs ?? 0;
        const total = state.totalTabs ?? 0;
        const pending = state.pendingAcceptButtons ?? 0;
        const waiting = state.waitingForChatMessage ? 'yes' : 'no';
        return `${status} | tabs ${done}/${total} | pending ${pending} | waiting chat ${waiting}`;
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
        vscode.commands.registerCommand('antigravity.diagnoseCdp', diagnoseCdp)
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
        options?: { forceFull?: boolean; escalationReason?: string }
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
        const message = (useMinimal ? (profileMinimalMessage || minimalMessage || fullMessage) : fullMessage).trim();
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

    // Phase 39: Manual Triggers & Error Suppression
    // Note: cdpStrategy is expected to be defined elsewhere or passed into this scope.
    // For now, it's left as potentially undefined, which TypeScript will flag.
    // Assuming `cdpStrategy` refers to an instance of CDPHandler or similar.
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.getChromeDevtoolsMcpUrl', async () => {
            try {
                const probe = new CDPHandler();
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

            const fallbackPort = config.get<number>('cdpPort') || 9000;
            return `ws://127.0.0.1:${fallbackPort}`;
        }),
        vscode.commands.registerCommand('antigravity.clickRun', () => resolveCDPStrategy()?.executeAction('run')),
        vscode.commands.registerCommand('antigravity.clickExpand', () => resolveCDPStrategy()?.executeAction('expand')),
        vscode.commands.registerCommand('antigravity.clickAccept', () => resolveCDPStrategy()?.executeAction('accept')),
        vscode.commands.registerCommand('antigravity.resetConnection', async () => {
            const cdpStrategy = resolveCDPStrategy();
            if (cdpStrategy) {
                vscode.window.showInformationMessage('Restoring Anti-Gravity...');
                try {
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
        vscode.commands.registerCommand('antigravity.toggleExtension', async () => {
            await strategyManager.toggle();
            // Status bar update triggered by config listener or loop callback
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAccept', async () => {
            const next = !isUnifiedAutoAcceptEnabled();
            // Update Legacy
            await config.update('autopilotAutoAcceptEnabled', next);
            await config.update('autoAcceptEnabled', next);
            await config.update('autoAllEnabled', next);

            // Update New Actions
            await config.update('actions.autoAccept.enabled', next);
            await config.update('actions.bump.enabled', next); // Usually coupled

            await strategyManager.start();
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAll', async () => {
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
            await strategyManager.start();
            await refreshRuntimeState();
        }),
        vscode.commands.registerCommand('antigravity.clearAutoAll', async () => {
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
        vscode.commands.registerCommand('antigravity.toggleAutonomous', async () => {
            const isRunning = autonomousLoop.isRunning();
            if (isRunning) {
                autonomousLoop.stop('User toggled off');
                await config.update('autonomousEnabled', false);
            } else {
                await autonomousLoop.start();
                await config.update('autonomousEnabled', true);
            }
        }),
        vscode.commands.registerCommand('antigravity.openSettings', () => {
            DashboardPanel.createOrShow(context.extensionUri);
        }),
        vscode.commands.registerCommand('antigravity.toggleMcp', async () => {
            const current = config.get<boolean>('mcpEnabled');
            if (current) {
                await mcpServer.stop();
            } else {
                await mcpServer.start();
            }
            await config.update('mcpEnabled', !current);
        }),
        vscode.commands.registerCommand('antigravity.toggleVoice', async () => {
            const current = config.get<boolean>('voiceControlEnabled');
            if (current) {
                await voiceControl.stop();
            } else {
                await voiceControl.start();
            }
            await config.update('voiceControlEnabled', !current);
        }),
        vscode.commands.registerCommand('antigravity.processVoiceTranscript', async () => {
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
        vscode.commands.registerCommand('antigravity.generateTests', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                await testGenerator.generateTestsForFile(editor.document.fileName);
            } else {
                vscode.window.showErrorMessage('No active file to generate tests for');
            }
        }),
        vscode.commands.registerCommand('antigravity.runCodeReview', async () => {
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
        vscode.commands.registerCommand('antigravity.startMultiAgent', async () => {
            const task = await vscode.window.showInputBox({ prompt: 'Enter task for Multi-Agent System' });
            if (task) {
                await agentOrchestrator.coordinateAgents(task);
            }
        }),
        vscode.commands.registerCommand('antigravity.showMemory', async () => {
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
        vscode.commands.registerCommand('antigravity.showStatusMenu', async () => {
            await refreshRuntimeState();
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
        vscode.commands.registerCommand('antigravity.syncProjectTasks', async () => {
            await projectManager.syncFromFixPlan();
            vscode.window.showInformationMessage('Project tasks synced from planner files (task.md → TODO.md → @fix_plan.md → ROADMAP.md).');
        }),
        vscode.commands.registerCommand('antigravity.checkRuntimeState', async () => {
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
        vscode.commands.registerCommand('antigravity.detectCompletionWaitingState', async () => {
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
        vscode.commands.registerCommand('antigravity.copyRuntimeStateJson', async () => {
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
        vscode.commands.registerCommand('antigravity.refreshRuntimeAndReopenStatusMenu', async () => {
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
        vscode.commands.registerCommand('antigravity.resetStatusRefreshCounters', async () => {
            refreshStatusMenuDroppedTotal = 0;
            refreshStatusMenuDroppedInFlight = 0;
            refreshStatusMenuDroppedDebounce = 0;
            log.info('[StatusRefresh] Guard drop counters reset.');
            vscode.window.showInformationMessage('Antigravity: status refresh counters reset.');
        }),
        vscode.commands.registerCommand('antigravity.copyLastResumePayloadReport', async () => {
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
        vscode.commands.registerCommand('antigravity.copyEscalationDiagnosticsReport', async () => {
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
        vscode.commands.registerCommand('antigravity.copyEscalationHealthSummary', async () => {
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
        vscode.commands.registerCommand('antigravity.showEscalationMenu', async () => {
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
                }
            ];

            const selection = await vscode.window.showQuickPick(items, {
                placeHolder: 'Escalation Controls'
            });
            if (selection?.action) {
                await vscode.commands.executeCommand(selection.action);
            }
        }),
        vscode.commands.registerCommand('antigravity.clearEscalationTimeline', async () => {
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
        vscode.commands.registerCommand('antigravity.clearEscalationTimelineNow', async () => {
            await clearEscalationTimelineState('no-prompt-command');
            vscode.window.showInformationMessage('Antigravity: escalation timeline cleared (no prompt).');
        }),
        vscode.commands.registerCommand('antigravity.resumeFromWaitingState', async () => {
            await sendAutoResumeMessage('manual', latestRuntimeState);
        }),
        vscode.commands.registerCommand('antigravity.validateCrossUiCoverage', async () => {
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
        vscode.commands.registerCommand('antigravity.runCrossUiSelfTest', async () => {
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
        vscode.commands.registerCommand('antigravity.explainAutoResumeGuard', async () => {
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
        vscode.commands.registerCommand('antigravity.autoFixAutoResumeReadiness', async () => {
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
        vscode.commands.registerCommand('antigravity.testAudio', async () => {
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
        vscode.commands.registerCommand('antigravity.writeAndSubmitBump', async () => {
            const message = config.get<string>('bumpMessage') || 'bump';
            await sendAutoResumeMessage('manual', null, { messageOverride: message } as any);
            vscode.window.showInformationMessage(`Antigravity: Bump message "${message}" submitted.`);
        }),
        vscode.commands.registerCommand('antigravity.clickAccept', async () => {
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
        vscode.commands.registerCommand('antigravity.clickRun', async () => {
            const commands = [
                'workbench.action.debug.start',
                'workbench.action.debug.run',
                'code-runner.run'
            ];
            for (const cmd of commands) {
                try { await vscode.commands.executeCommand(cmd); } catch { }
            }
        }),
        vscode.commands.registerCommand('antigravity.clickExpand', async () => {
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
        })
    );

    const runtimeStateTimer = setInterval(() => {
        refreshRuntimeState().catch(() => { });
    }, 3000);
    context.subscriptions.push({ dispose: () => clearInterval(runtimeStateTimer) });

    // Initialize based on saved config
    // 1. Strategy (Core Driver)
    if (isUnifiedAutoAcceptEnabled()) {
        strategyManager.start().catch(e => log.error(`Failed to start strategy: ${e.message}`));


        refreshRuntimeState().catch(() => { });

        // 2. Autonomous Loop
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

        log.info('Antigravity Autopilot activated!');
    }
}

export function deactivate() {
    autonomousLoop.stop('Deactivating');
    mcpServer.stop();
    voiceControl.stop();
    if (statusBar) statusBar.dispose();
    log.info('Antigravity Autopilot deactivated');
}
