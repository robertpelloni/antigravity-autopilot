
import { cdpClient } from '../providers/cdp-client';
import { createLogger } from '../utils/logger';

const log = createLogger('AutoResumeGuard');

export async function runAutoResumeReadinessFix(options?: { skipRefresh?: boolean }): Promise<{ improved: boolean; immediateRetry?: { sent: boolean; attempted: boolean } }> {
    log.info('Running Auto-Resume Readiness Fix...');
    // 1. Ensure connected
    if (!cdpClient.isConnected()) {
        await cdpClient.connect();
    }

    // 2. Scan and diagnose (focus check)
    // We can't easily force focus via CDP without a specific target, but we can try to "wake up" the connection.
    const instances = await cdpClient.getHandler().scanForInstances();

    // 3. If we found instances but weren't connected, that's an improvement.
    const improved = instances.length > 0;

    return { improved };
}

export async function sendAutoResumeMessage(
    kind: 'automatic' | 'manual',
    state: any,
    options?: { forceFull?: boolean; escalationReason?: string; messageOverride?: string }
): Promise<boolean> {
    log.info(`Sending auto-resume message (${kind})...`);

    const message = options?.messageOverride || "continue"; // Simple continue for now, can be enhanced based on state/options

    // Use the robust sendHybridBump from CDPHandler (via Client)
    // This uses a bridge loopback to execute VS Code commands (e.g. workbench.action.chat.submit)
    // which is much more reliable than DOM interaction alone.
    if (cdpClient.isConnected()) {
        const sent = await cdpClient.sendHybridBump(message);
        if (sent) {
            log.info('Auto-resume (hybrid) message sent successfully.');
        } else {
            log.warn('Failed to send auto-resume (hybrid) message.');
        }
        return sent;
    } else {
        log.warn('Cannot send auto-resume: CDP not connected.');
        return false;
    }
}
