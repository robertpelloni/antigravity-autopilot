
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

import { StrategyManager } from './strategies/manager';
import { testGenerator } from './core/test-generator';
import { codeReviewer } from './core/code-reviewer';
import { agentOrchestrator } from './core/agent-orchestrator';
import { memoryManager } from './core/memory-manager';
import { projectManager } from './providers/project-manager';

import { StatusBarManager } from './ui/status-bar';
import { CDPStrategy, CDPRuntimeState } from './strategies/cdp-strategy';

const log = createLogger('Extension');
let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('Antigravity Unified: Activation Started!');
    console.log('Antigravity Unified: Activation Started!');
    log.info('Antigravity Autopilot (Unified) activating...');

    // Initialize UI
    statusBar = new StatusBarManager(context);

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
            const now = Date.now();
            const isWaiting = runtimeState?.completionWaiting?.readyToResume === true
                || runtimeState?.status === 'waiting_for_chat_message'
                || runtimeState?.waitingForChatMessage === true;

            if (isWaiting) {
                readyToResumeStreak += 1;
            } else {
                readyToResumeStreak = 0;
            }

            if (!isWaiting) {
                waitingStateSince = null;
                watchdogEscalationConsecutiveFailures = 0;
                watchdogEscalationForceFullNext = false;
                lastWatchdogEscalationReason = 'reset: not waiting';
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
                    } else {
                        watchdogEscalationConsecutiveFailures += 1;
                        if (escalationEnabled && watchdogEscalationConsecutiveFailures >= escalationThreshold) {
                            watchdogEscalationForceFullNext = true;
                            lastWatchdogEscalationAt = Date.now();
                            lastWatchdogEscalationReason = `threshold reached (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}) after ${outcome}`;
                            log.info(`[AutoResume Watchdog] Escalation armed: forcing full resume prompt on next auto-resume attempt (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}).`);
                        }
                    }
                } catch (e: any) {
                    lastAutoFixWatchdogAt = Date.now();
                    lastAutoFixWatchdogOutcome = `error: ${String(e?.message || e || 'unknown')}`;
                    watchdogEscalationConsecutiveFailures += 1;
                    if (escalationEnabled && watchdogEscalationConsecutiveFailures >= escalationThreshold) {
                        watchdogEscalationForceFullNext = true;
                        lastWatchdogEscalationAt = Date.now();
                        lastWatchdogEscalationReason = `threshold reached (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}) after watchdog error`;
                        log.info(`[AutoResume Watchdog] Escalation armed after watchdog error (${watchdogEscalationConsecutiveFailures}/${escalationThreshold}).`);
                    }
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

    const evaluateCrossUiHealth = (state: any) => {
        const coverage = state?.profileCoverage || {};
        const evaluate = (cov: any) => {
            const hasInput = !!cov?.hasVisibleInput;
            const hasSend = !!cov?.hasVisibleSendButton;
            const pending = Number(cov?.pendingAcceptButtons || 0);
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
            activeRuntimeSignal: (state?.status && state.status !== 'unknown' && state.status !== 'stopped') ? 20 : 0,
            waitingDetection: (typeof state?.waitingForChatMessage === 'boolean') ? 10 : 0,
            cursorBonus: profiles.cursor.ready ? 10 : 0
        };

        const score = Object.values(scoreParts).reduce((a, b) => a + b, 0);
        const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
        const strictPass = strict.vscodeTextReady && strict.vscodeButtonReady && strict.antigravityTextReady && strict.antigravityButtonReady;

        return { profiles, strict, scoreParts, score, grade, strictPass };
    };

    const getAutoResumeGuardReport = (state: any) => {
        const health = evaluateCrossUiHealth(state);
        const minScore = Math.max(0, Math.min(100, config.get<number>('runtimeAutoResumeMinScore') || 70));
        const requireStrict = config.get<boolean>('runtimeAutoResumeRequireStrictPrimary');
        const scorePass = health.score >= minScore;
        const strictPass = !requireStrict || health.strictPass;
        const allowed = scorePass && strictPass;

        const reasons: string[] = [];
        const suggestions: string[] = [];

        if (!scorePass) {
            reasons.push(`score ${health.score} is below minimum ${minScore}`);
            suggestions.push('Run Cross-UI Self-Test and improve profile coverage signals.');
        }

        if (requireStrict && !health.strictPass) {
            reasons.push('strict primary readiness failed');
            if (!health.strict.vscodeTextReady) {
                suggestions.push('VS Code text input signal missing; open/focus Copilot chat input.');
            }
            if (!health.strict.vscodeButtonReady) {
                suggestions.push('VS Code submit/accept signal missing; expose send/accept controls.');
            }
            if (!health.strict.antigravityTextReady) {
                suggestions.push('Antigravity text input signal missing; ensure agent panel input is visible.');
            }
            if (!health.strict.antigravityButtonReady) {
                suggestions.push('Antigravity submit/accept signal missing; ensure send/accept controls are visible.');
            }
        }

        if (reasons.length === 0) {
            reasons.push('guard conditions satisfied');
        }

        if (suggestions.length === 0) {
            suggestions.push('No action needed; auto-resume is permitted under current settings.');
        }

        let recommendedNextAction = 'No action needed; auto-resume is currently allowed.';
        let recommendedNextActionConfidence: 'high' | 'medium' | 'low' = 'high';
        if (!allowed) {
            if (requireStrict && !health.strict.vscodeTextReady) {
                recommendedNextAction = 'Open/focus VS Code Copilot chat input, then re-run Auto-Fix Resume Readiness.';
                recommendedNextActionConfidence = 'high';
            } else if (requireStrict && !health.strict.vscodeButtonReady) {
                recommendedNextAction = 'Expose VS Code send/accept controls (or pending action buttons), then re-check guard.';
                recommendedNextActionConfidence = 'high';
            } else if (requireStrict && !health.strict.antigravityTextReady) {
                recommendedNextAction = 'Open/focus Antigravity agent panel input, then re-run guard check.';
                recommendedNextActionConfidence = 'high';
            } else if (requireStrict && !health.strict.antigravityButtonReady) {
                recommendedNextAction = 'Expose Antigravity send/accept controls, then re-check guard.';
                recommendedNextActionConfidence = 'high';
            } else if (!scorePass) {
                recommendedNextAction = 'Run Cross-UI Self-Test to improve coverage signals or lower runtimeAutoResumeMinScore temporarily.';
                recommendedNextActionConfidence = 'medium';
            } else {
                recommendedNextAction = 'Run Auto-Fix Resume Readiness and then Explain Auto-Resume Guard to inspect remaining blockers.';
                recommendedNextActionConfidence = 'low';
            }
        }

        return {
            allowed,
            reason: reasons.join('; '),
            reasons,
            suggestions,
            recommendedNextAction,
            recommendedNextActionConfidence,
            minScore,
            requireStrict,
            scorePass,
            strictPass,
            health
        };
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
            return 'ws://localhost:9222'; // Dummy return to satisfy whatever is calling this
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
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity.toggleExtension', async () => {
            await strategyManager.toggle();
            // Status bar update triggered by config listener or loop callback
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAccept', async () => {
            await config.update('autoAcceptEnabled', !config.get('autoAcceptEnabled'));
            await strategyManager.start();
        }),
        vscode.commands.registerCommand('antigravity.toggleAutoAll', async () => {
            const current = config.get<boolean>('autoAllEnabled');
            await config.update('autoAllEnabled', !current);
            if (!current) {
                await config.update('strategy', 'cdp');
            }
            await strategyManager.start();
            await refreshRuntimeState();
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
            const items = [
                {
                    label: '$(graph) Runtime: ' + runtimeSummary(latestRuntimeState),
                    description: 'Live runtime snapshot (read-only)',
                    action: undefined as string | undefined
                },
                {
                    label: '$(watch) Guard: ' + (statusGuard ? (statusGuard.allowed ? 'ALLOW' : 'BLOCK') : 'n/a'),
                    description: statusGuard
                        ? `score ${statusGuard.health.score}/${statusGuard.minScore}, strict ${statusGuard.health.strictPass ? 'PASS' : 'FAIL'}${statusGuard.requireStrict ? ' (required)' : ''}, next ${statusTiming ? formatDurationShort(statusTiming.nextEligibleAt - Date.now()) : '-'} | (${statusGuard.recommendedNextActionConfidence}) ${statusGuard.recommendedNextAction}`
                        : 'Auto-resume guard state unavailable',
                    action: 'antigravity.explainAutoResumeGuard'
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
            vscode.window.showInformationMessage('Project tasks synced from @fix_plan.md');
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
        })
    );

    const runtimeStateTimer = setInterval(() => {
        refreshRuntimeState().catch(() => { });
    }, 3000);
    context.subscriptions.push({ dispose: () => clearInterval(runtimeStateTimer) });

    // Initialize based on saved config
    // 1. Strategy (Core Driver)
    if (config.get('autoAllEnabled') || config.get('autoAcceptEnabled')) {
        strategyManager.start().catch(e => log.error(`Failed to start strategy: ${e.message}`));
    }

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

export function deactivate() {
    autonomousLoop.stop('Deactivating');
    mcpServer.stop();
    voiceControl.stop();
    if (statusBar) statusBar.dispose();
    log.info('Antigravity Autopilot deactivated');
}
