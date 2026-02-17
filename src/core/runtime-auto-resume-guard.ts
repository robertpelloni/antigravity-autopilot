/**
 * Auto-resume guard evaluation helpers.
 * Pure logic extracted for deterministic runtime state replay tests.
 */

export interface CrossUiProfileHealth {
    ready: boolean;
    hasInput: boolean;
    hasSend: boolean;
    pending: number;
}

export interface CrossUiHealth {
    profiles: {
        vscode: CrossUiProfileHealth;
        antigravity: CrossUiProfileHealth;
        cursor: CrossUiProfileHealth;
    };
    strict: {
        vscodeTextReady: boolean;
        vscodeButtonReady: boolean;
        antigravityTextReady: boolean;
        antigravityButtonReady: boolean;
    };
    scoreParts: {
        vscodeCoverage: number;
        antigravityCoverage: number;
        activeRuntimeSignal: number;
        waitingDetection: number;
        cursorBonus: number;
    };
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    strictPass: boolean;
}

export interface AutoResumeGuardOptions {
    minScore: number;
    requireStrict: boolean;
}

export interface AutoResumeGuardReport {
    allowed: boolean;
    reason: string;
    reasons: string[];
    suggestions: string[];
    recommendedNextAction: string;
    recommendedNextActionConfidence: 'high' | 'medium' | 'low';
    minScore: number;
    requireStrict: boolean;
    scorePass: boolean;
    strictPass: boolean;
    health: CrossUiHealth;
}

function evaluateCoverageProfile(cov: any): CrossUiProfileHealth {
    const hasInput = !!cov?.hasVisibleInput;
    const hasSend = !!cov?.hasVisibleSendButton;
    const pending = Number(cov?.pendingAcceptButtons || 0);
    const ready = hasInput || hasSend || pending > 0;
    return { ready, hasInput, hasSend, pending };
}

export function evaluateCrossUiHealth(state: any): CrossUiHealth {
    const coverage = state?.profileCoverage || {};

    const profiles = {
        vscode: evaluateCoverageProfile(coverage.vscode),
        antigravity: evaluateCoverageProfile(coverage.antigravity),
        cursor: evaluateCoverageProfile(coverage.cursor)
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
    const grade: 'A' | 'B' | 'C' | 'D' | 'F' = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const strictPass = strict.vscodeTextReady && strict.vscodeButtonReady && strict.antigravityTextReady && strict.antigravityButtonReady;

    return { profiles, strict, scoreParts, score, grade, strictPass };
}

export function buildAutoResumeGuardReport(state: any, options: AutoResumeGuardOptions): AutoResumeGuardReport {
    const health = evaluateCrossUiHealth(state);
    const minScore = Math.max(0, Math.min(100, options.minScore));
    const requireStrict = !!options.requireStrict;
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
}
