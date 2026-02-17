/**
 * Calculates an adaptive loop backoff interval in seconds.
 *
 * @param baseInterval Base loop interval in seconds.
 * @param failures Consecutive failure count.
 * @param maxMinutes Maximum cap in minutes.
 * @returns Backoff-adjusted interval in seconds.
 */
export function calculateAdaptiveBackoff(baseInterval: number, failures: number, maxMinutes: number): number {
    if (failures <= 0) return baseInterval;

    const backoffMultiplier = Math.pow(2, Math.min(failures, 6));
    let newInterval = baseInterval * backoffMultiplier;

    const maxSeconds = maxMinutes * 60;
    if (newInterval > maxSeconds) {
        newInterval = maxSeconds;
    }
    return newInterval;
}
