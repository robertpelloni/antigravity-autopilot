export function buildAutoResumeGuardReport(state: any, options?: any) {
    return {
        allowed: true,
        minScore: 0,
        requireStrict: false,
        reason: 'stub',
        reasons: [],
        scorePass: true,
        strictPass: true,
        suggestions: [],
        recommendedNextAction: 'none',
        recommendedNextActionConfidence: 1,
        health: {
            score: 100,
            strictPass: true,
            grade: 'A',
            isError: false,
            isWarn: false,
            strict: { antigravityTextReady: true, antigravityButtonReady: true, vscodeTextReady: true, vscodeButtonReady: true },
            scoreParts: {},
            profiles: {}
        }
    };
}
export function getAutoResumeGuardReport(state: any) { return buildAutoResumeGuardReport(state); }
export function evaluateEscalationArming(state: any) { return { arm: false, reason: 'stub', cooldownRemainingMs: 0 }; }
export function evaluateCrossUiHealth(state: any) { return buildAutoResumeGuardReport(state).health; }
export function getAutoResumeTimingReport(state: any) { return { elapsedMs: 0, isWarn: false, isError: false, message: '' }; }
export function buildLastResumePayloadReport(state: any) { return {}; }
export function buildEscalationDiagnosticsReport(state: any) { return {}; }
export function getSafetyTelemetrySummary(state: any) {
    return { health: { strictPass: true }, score: 100, isBlocked: false, isError: false, isWarn: false, totalCount: 0, reason: 'stub' };
}
