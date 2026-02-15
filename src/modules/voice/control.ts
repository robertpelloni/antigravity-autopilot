/**
 * Antigravity Voice Control Module
 *
 * A command-parsing voice control system that converts natural language
 * voice commands into actionable Antigravity operations. Supports
 * push-to-talk and continuous modes with configurable wake words.
 *
 * @module modules/voice/control
 */

import * as vscode from 'vscode';
import { createLogger } from '../../utils/logger';
import { config } from '../../utils/config';

const log = createLogger('VoiceControl');

// ============ Types ============

export interface VoiceCommand {
    raw: string;             // Raw transcribed text
    intent: string;          // Parsed intent (e.g., 'approve', 'reject', 'bump')
    confidence: number;      // 0-1 confidence score
    params: Record<string, string>;  // Extracted parameters
    timestamp: number;
}

export interface VoiceConfig {
    mode: 'push-to-talk' | 'continuous' | 'wake-word';
    wakeWord: string;
    language: string;
    minConfidence: number;
    enabled: boolean;
}

export interface VoiceStats {
    isActive: boolean;
    mode: string;
    commandsProcessed: number;
    lastCommand?: VoiceCommand;
    uptimeMs: number;
}

// ============ Command Patterns ============

export interface CommandPattern {
    intent: string;
    patterns: RegExp[];
    description: string;
    paramExtract?: (match: RegExpMatchArray) => Record<string, string>;
}

export const COMMAND_PATTERNS: CommandPattern[] = [
    {
        intent: 'approve',
        patterns: [/\b(?:approve|accept|yes|confirm|go ahead|looks good|lgtm)\b/i],
        description: 'Approve the current agent step'
    },
    {
        intent: 'reject',
        patterns: [/\b(?:reject|deny|no|cancel|stop|abort)\b/i],
        description: 'Reject the current agent step'
    },
    {
        intent: 'bump',
        patterns: [/\b(?:bump|nudge|ping|poke|remind)\b/i],
        description: 'Bump the agent to continue'
    },
    {
        intent: 'switch_model',
        patterns: [/\b(?:switch|change|use)\s+(?:to\s+)?(?:model\s+)?(\w+)/i],
        description: 'Switch to a different AI model',
        paramExtract: (m) => ({ model: m[1] || '' })
    },
    {
        intent: 'status',
        patterns: [/\b(?:status|what's happening|progress|report|how's it going)\b/i],
        description: 'Request current status'
    },
    {
        intent: 'pause',
        patterns: [/\b(?:pause|wait|hold|freeze)\b/i],
        description: 'Pause agent execution'
    },
    {
        intent: 'resume',
        patterns: [/\b(?:resume|continue|unpause|go|proceed)\b/i],
        description: 'Resume agent execution'
    },
    {
        intent: 'open_dashboard',
        patterns: [/\b(?:open|show|display)\s+(?:the\s+)?dashboard\b/i],
        description: 'Open the Antigravity dashboard'
    },
    {
        intent: 'run_tests',
        patterns: [/\b(?:run|execute)\s+(?:the\s+)?tests?\b/i],
        description: 'Run the test suite'
    },
    {
        intent: 'deploy',
        patterns: [/\b(?:deploy|ship|publish|release)\b/i],
        description: 'Deploy the application'
    }
];

// ============ Command Parser ============

export function parseCommand(text: string, patterns: CommandPattern[] = COMMAND_PATTERNS): VoiceCommand | null {
    const cleaned = text.trim().toLowerCase();
    if (!cleaned) return null;

    for (const cmd of patterns) {
        for (const pattern of cmd.patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                return {
                    raw: text,
                    intent: cmd.intent,
                    confidence: 1.0,
                    params: cmd.paramExtract ? cmd.paramExtract(match) : {},
                    timestamp: Date.now()
                };
            }
        }
    }

    // No match — return low confidence unknown
    return {
        raw: text,
        intent: 'unknown',
        confidence: 0.0,
        params: {},
        timestamp: Date.now()
    };
}

// ============ Voice Control Class ============

export class VoiceControl {
    private isActive = false;
    private voiceConfig: VoiceConfig;
    private commandsProcessed = 0;
    private lastCommand?: VoiceCommand;
    private startTime = 0;
    private commandPatterns: CommandPattern[];

    constructor(customPatterns?: CommandPattern[]) {
        this.voiceConfig = {
            mode: 'push-to-talk',
            wakeWord: 'hey antigravity',
            language: 'en-US',
            minConfidence: 0.6,
            enabled: false
        };
        this.commandPatterns = customPatterns || COMMAND_PATTERNS;
    }

    // ============ Lifecycle ============

    async start() {
        if (this.isActive) return;
        this.isActive = true;
        this.startTime = Date.now();

        const mode = config.get('voiceMode') || this.voiceConfig.mode;
        this.voiceConfig.mode = mode as VoiceConfig['mode'];

        log.info(`Voice Control active. Mode: ${mode}`);
        vscode.window.showInformationMessage(`🎤 Voice Control Active (${mode})`);
    }

    async stop() {
        if (!this.isActive) return;
        this.isActive = false;
        log.info('Voice Control stopped');
    }

    // ============ Command Processing ============

    /**
     * Process a voice transcription and return the parsed command.
     */
    processTranscription(text: string): VoiceCommand | null {
        if (!this.isActive) return null;

        // Wake word check in wake-word mode
        if (this.voiceConfig.mode === 'wake-word') {
            if (!text.toLowerCase().includes(this.voiceConfig.wakeWord)) {
                return null;
            }
            // Strip wake word before parsing
            text = text.toLowerCase().replace(this.voiceConfig.wakeWord, '').trim();
        }

        const command = parseCommand(text, this.commandPatterns);
        if (command && command.confidence >= this.voiceConfig.minConfidence) {
            this.commandsProcessed++;
            this.lastCommand = command;
            log.info(`Voice command: "${command.intent}" (confidence: ${command.confidence})`);
            return command;
        }

        return command; // Return even low-confidence for caller to decide
    }

    /**
     * Get available voice commands with descriptions.
     */
    getAvailableCommands(): Array<{ intent: string; description: string }> {
        return this.commandPatterns.map(c => ({
            intent: c.intent,
            description: c.description
        }));
    }

    // ============ Configuration ============

    setConfig(update: Partial<VoiceConfig>): void {
        Object.assign(this.voiceConfig, update);
    }

    getConfig(): VoiceConfig {
        return { ...this.voiceConfig };
    }

    // ============ Stats ============

    getStats(): VoiceStats {
        return {
            isActive: this.isActive,
            mode: this.voiceConfig.mode,
            commandsProcessed: this.commandsProcessed,
            lastCommand: this.lastCommand,
            uptimeMs: this.isActive ? Date.now() - this.startTime : 0
        };
    }
}

export const voiceControl = new VoiceControl();
