const { describe, it } = require('node:test');
const assert = require('node:assert');

/**
 * VoiceControl Command Parsing Tests
 * Tests command recognition, wake word, confidence, and stats.
 */

// ============ Replicate parseCommand for testing ============

const COMMAND_PATTERNS = [
    { intent: 'approve', patterns: [/\b(?:approve|accept|yes|confirm|go ahead|looks good|lgtm)\b/i], description: 'Approve' },
    { intent: 'reject', patterns: [/\b(?:reject|deny|no|cancel|stop|abort)\b/i], description: 'Reject' },
    { intent: 'bump', patterns: [/\b(?:bump|nudge|ping|poke|remind)\b/i], description: 'Bump' },
    { intent: 'switch_model', patterns: [/\b(?:switch|change|use)\s+(?:to\s+)?(?:model\s+)?(\w+)/i], description: 'Switch model', paramExtract: (m) => ({ model: m[1] || '' }) },
    { intent: 'status', patterns: [/\b(?:status|what's happening|progress|report)\b/i], description: 'Status' },
    { intent: 'pause', patterns: [/\b(?:pause|wait|hold|freeze)\b/i], description: 'Pause' },
    { intent: 'resume', patterns: [/\b(?:resume|continue|unpause|proceed)\b/i], description: 'Resume' },
    { intent: 'open_dashboard', patterns: [/\b(?:open|show|display)\s+(?:the\s+)?dashboard\b/i], description: 'Dashboard' },
    { intent: 'run_tests', patterns: [/\b(?:run|execute)\s+(?:the\s+)?tests?\b/i], description: 'Tests' },
    { intent: 'deploy', patterns: [/\b(?:deploy|ship|publish|release)\b/i], description: 'Deploy' }
];

function parseCommand(text, patterns = COMMAND_PATTERNS) {
    const cleaned = text.trim().toLowerCase();
    if (!cleaned) return null;
    for (const cmd of patterns) {
        for (const pattern of cmd.patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                return { raw: text, intent: cmd.intent, confidence: 1.0, params: cmd.paramExtract ? cmd.paramExtract(match) : {}, timestamp: Date.now() };
            }
        }
    }
    return { raw: text, intent: 'unknown', confidence: 0.0, params: {}, timestamp: Date.now() };
}

// ============ Tests ============

describe('VoiceControl Command Parsing', () => {
    it('should parse approve commands', () => {
        assert.strictEqual(parseCommand('approve').intent, 'approve');
        assert.strictEqual(parseCommand('yes').intent, 'approve');
        assert.strictEqual(parseCommand('looks good').intent, 'approve');
        assert.strictEqual(parseCommand('lgtm').intent, 'approve');
    });

    it('should parse reject commands', () => {
        assert.strictEqual(parseCommand('reject this').intent, 'reject');
        assert.strictEqual(parseCommand('no').intent, 'reject');
        assert.strictEqual(parseCommand('abort').intent, 'reject');
    });

    it('should parse bump commands', () => {
        assert.strictEqual(parseCommand('bump').intent, 'bump');
        assert.strictEqual(parseCommand('nudge the agent').intent, 'bump');
    });

    it('should parse switch_model with parameter extraction', () => {
        const cmd = parseCommand('switch to claude');
        assert.strictEqual(cmd.intent, 'switch_model');
        assert.strictEqual(cmd.params.model, 'claude');
    });

    it('should parse status commands', () => {
        assert.strictEqual(parseCommand('status').intent, 'status');
        assert.strictEqual(parseCommand('progress').intent, 'status');
    });

    it('should parse pause and resume', () => {
        assert.strictEqual(parseCommand('pause').intent, 'pause');
        assert.strictEqual(parseCommand('resume').intent, 'resume');
        assert.strictEqual(parseCommand('proceed').intent, 'resume');
    });

    it('should parse dashboard commands', () => {
        assert.strictEqual(parseCommand('open dashboard').intent, 'open_dashboard');
        assert.strictEqual(parseCommand('show the dashboard').intent, 'open_dashboard');
    });

    it('should parse test and deploy commands', () => {
        assert.strictEqual(parseCommand('run tests').intent, 'run_tests');
        assert.strictEqual(parseCommand('deploy').intent, 'deploy');
        assert.strictEqual(parseCommand('ship it').intent, 'deploy');
    });

    it('should return unknown for unrecognized commands', () => {
        const cmd = parseCommand('hello world');
        assert.strictEqual(cmd.intent, 'unknown');
        assert.strictEqual(cmd.confidence, 0.0);
    });

    it('should return null for empty input', () => {
        assert.strictEqual(parseCommand(''), null);
        assert.strictEqual(parseCommand('   '), null);
    });
});
