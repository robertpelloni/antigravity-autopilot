import * as vscode from 'vscode';

export const CONFIG_SECTION = 'antigravity';

export interface AntigravityConfig {
    strategy: 'simple' | 'cdp';
    interactionUiProfile: 'auto' | 'vscode' | 'antigravity' | 'cursor';
    autoAcceptEnabled: boolean;
    autoAllEnabled: boolean;
    multiTabEnabled: boolean;
    autonomousEnabled: boolean;
    mcpEnabled: boolean;
    voiceControlEnabled: boolean;
    autoSwitchModels: boolean;
    autoGitCommit: boolean;
    pollFrequency: number;
    bannedCommands: string[];
    loopInterval: number;
    maxLoopsPerSession: number;
    executionTimeout: number; // in minutes
    maxCallsPerHour: number;
    voiceMode: 'push-to-talk' | 'always-listening';
    enableMemory: boolean;
    // User Requested Settings
    threadWaitInterval: number; // Seconds to wait between steps/threads
    autoApproveDelay: number;   // Seconds to wait before auto-approving
    bumpMessage: string;        // Message to post to bump thread
    runtimeWaitingReminderEnabled: boolean;
    runtimeWaitingReminderDelaySec: number;
    runtimeWaitingReminderCooldownSec: number;
    runtimeAutoResumeEnabled: boolean;
    runtimeAutoResumeMessage: string;
    runtimeAutoResumeUseMinimalContinue: boolean;
    runtimeAutoResumeMinimalMessage: string;
    runtimeAutoResumeCooldownSec: number;
    runtimeAutoResumeStabilityPolls: number;
    runtimeAutoResumeMinScore: number;
    runtimeAutoResumeRequireStrictPrimary: boolean;

    // CDP Settings
    cdpPort: number;
    cdpTimeout: number;

    // Advanced Model & Loop Settings
    preferredModelForReasoning: string;
    preferredModelForFrontend: string;
    preferredModelForQuick: string;
    maxConsecutiveTestLoops: number;

    // Pattern Matching
    acceptPatterns: string[];
    rejectPatterns: string[];

    // Interaction Methods (user-selectable)
    interactionTextMethods: string[];   // Enabled text input method IDs
    interactionClickMethods: string[];  // Enabled click method IDs
    interactionSubmitMethods: string[]; // Enabled submit method IDs
    interactionTimings: Record<string, number>; // Per-method timing overrides (ms)
    interactionRetryCount: number;      // How many methods to try before giving up
    interactionParallel: boolean;       // Try methods simultaneously vs sequentially
    interactionVisualDiffThreshold: number; // Screenshot diff threshold for visual-verify methods
    interactionClickMethodsVSCode: string[];
    interactionClickMethodsAntigravity: string[];
    interactionClickMethodsCursor: string[];
    interactionClickSelectorsVSCode: string[];
    interactionClickSelectorsAntigravity: string[];
    interactionClickSelectorsCursor: string[];
}

export class ConfigManager {
    private static instance: ConfigManager;

    private constructor() { }

    static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    get<T>(key: keyof AntigravityConfig): T {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<T>(key) as T;
    }

    async update(key: keyof AntigravityConfig, value: any, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        await config.update(key, value, target);
    }

    getAll(): AntigravityConfig {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return {
            strategy: config.get('strategy', 'cdp'),
            interactionUiProfile: config.get('interactionUiProfile', 'auto'),
            autoAcceptEnabled: config.get('autoAcceptEnabled', false),
            autoAllEnabled: config.get('autoAllEnabled', false),
            multiTabEnabled: config.get('multiTabEnabled', false),
            autonomousEnabled: config.get('autonomousEnabled', false),
            mcpEnabled: config.get('mcpEnabled', false),
            voiceControlEnabled: config.get('voiceControlEnabled', false),
            autoSwitchModels: config.get('autoSwitchModels', true),
            autoGitCommit: config.get('autoGitCommit', false),
            pollFrequency: config.get('pollFrequency', 1000),
            bannedCommands: config.get('bannedCommands', []),
            loopInterval: config.get('loopInterval', 30),
            maxLoopsPerSession: config.get('maxLoopsPerSession', 100),
            executionTimeout: config.get('executionTimeout', 15),
            maxCallsPerHour: config.get('maxCallsPerHour', 100),
            voiceMode: config.get('voiceMode', 'push-to-talk'),
            enableMemory: config.get('enableMemory', true),
            threadWaitInterval: config.get('threadWaitInterval', 5),
            autoApproveDelay: config.get('autoApproveDelay', 30),
            bumpMessage: config.get('bumpMessage', 'bump'),
            runtimeWaitingReminderEnabled: config.get('runtimeWaitingReminderEnabled', true),
            runtimeWaitingReminderDelaySec: config.get('runtimeWaitingReminderDelaySec', 60),
            runtimeWaitingReminderCooldownSec: config.get('runtimeWaitingReminderCooldownSec', 180),
            runtimeAutoResumeEnabled: config.get('runtimeAutoResumeEnabled', true),
            runtimeAutoResumeMessage: config.get('runtimeAutoResumeMessage', 'Continue with the next highest-priority development task in this workspace. If everything is complete, summarize what is done and propose the next best improvement.'),
            runtimeAutoResumeUseMinimalContinue: config.get('runtimeAutoResumeUseMinimalContinue', true),
            runtimeAutoResumeMinimalMessage: config.get('runtimeAutoResumeMinimalMessage', 'Continue with the next highest-priority development task in this workspace.'),
            runtimeAutoResumeCooldownSec: config.get('runtimeAutoResumeCooldownSec', 300),
            runtimeAutoResumeStabilityPolls: config.get('runtimeAutoResumeStabilityPolls', 2),
            runtimeAutoResumeMinScore: config.get('runtimeAutoResumeMinScore', 70),
            runtimeAutoResumeRequireStrictPrimary: config.get('runtimeAutoResumeRequireStrictPrimary', true),
            cdpPort: config.get('cdpPort', 9000),
            cdpTimeout: config.get('cdpTimeout', 10000),
            preferredModelForReasoning: config.get('preferredModelForReasoning', 'claude-opus-4.5-thinking'),
            preferredModelForFrontend: config.get('preferredModelForFrontend', 'gemini-3-pro-high'),
            preferredModelForQuick: config.get('preferredModelForQuick', 'gemini-3-flash'),
            maxConsecutiveTestLoops: config.get('maxConsecutiveTestLoops', 3),
            acceptPatterns: config.get('acceptPatterns', []),
            rejectPatterns: config.get('rejectPatterns', []),
            interactionTextMethods: config.get('interactionTextMethods', ['cdp-keys', 'cdp-insert-text', 'clipboard-paste', 'dom-inject', 'bridge-type']),
            interactionClickMethods: config.get('interactionClickMethods', ['dom-scan-click', 'dom-click', 'bridge-click', 'cdp-mouse', 'native-accept', 'vscode-cmd', 'script-force', 'process-peek']),
            interactionSubmitMethods: config.get('interactionSubmitMethods', ['vscode-submit', 'cdp-enter', 'script-submit', 'ctrl-enter', 'alt-enter']),
            interactionTimings: config.get('interactionTimings', {}),
            interactionRetryCount: config.get('interactionRetryCount', 3),
            interactionParallel: config.get('interactionParallel', false),
            interactionVisualDiffThreshold: config.get('interactionVisualDiffThreshold', 0.001),
            interactionClickMethodsVSCode: config.get('interactionClickMethodsVSCode', ['dom-scan-click', 'native-accept', 'process-peek', 'vscode-cmd', 'cdp-mouse', 'bridge-click']),
            interactionClickMethodsAntigravity: config.get('interactionClickMethodsAntigravity', ['dom-scan-click', 'dom-click', 'bridge-click', 'cdp-mouse', 'script-force', 'native-accept']),
            interactionClickMethodsCursor: config.get('interactionClickMethodsCursor', ['dom-scan-click', 'dom-click', 'cdp-mouse', 'script-force', 'native-accept']),
            interactionClickSelectorsVSCode: config.get('interactionClickSelectorsVSCode', [
                'button[aria-label*="Accept"]',
                'button[title*="Accept"]',
                'button[aria-label*="Apply"]',
                'button[title*="Apply"]',
                '.monaco-button',
                '.monaco-dialog-box button',
                '.monaco-notification-list button'
            ]),
            interactionClickSelectorsAntigravity: config.get('interactionClickSelectorsAntigravity', [
                '#antigravity\\.agentPanel button',
                '#antigravity\\.agentPanel [role="button"]',
                '.bg-ide-button-background',
                'button.grow'
            ]),
            interactionClickSelectorsCursor: config.get('interactionClickSelectorsCursor', [
                '#workbench\\.parts\\.auxiliarybar button',
                '#workbench\\.parts\\.auxiliarybar [role="button"]',
                '.chat-session-item [role="button"]',
                '.monaco-button'
            ])
        };
    }
}

export const config = ConfigManager.getInstance();
