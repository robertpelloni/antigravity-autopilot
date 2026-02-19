import * as vscode from 'vscode';

export const CONFIG_SECTION = 'antigravity';

export interface AntigravityConfig {
    strategy: 'simple' | 'cdp';
    interactionUiProfile: 'auto' | 'vscode' | 'antigravity' | 'cursor';
    // Action Groups
    actions: {
        bump: {
            enabled: boolean;
            text: string;
            cooldown: number;
            typingDelayMs: number;
            submitDelayMs: number;
        };

        autoAccept: {
            enabled: boolean;
            pollIntervalMs: number;
            delayMs: number;
        };
        run: {
            enabled: boolean;
            delayMs: number;
        };
        expand: {
            enabled: boolean;
            delayMs: number;
        };
    };
    // Audio Settings
    audio: {
        enabled: boolean;
        volume: number;
    };

    // Deprecated / Legacy (kept for internal compat if needed, but actions.* preferred)
    autoAcceptEnabled: boolean;
    autoAllEnabled: boolean;
    autopilotAutoAcceptEnabled: boolean;
    autopilotAutoBumpEnabled: boolean;
    autopilotRunExpandContinueEnabled: boolean;
    autoAcceptPollIntervalMs: number;
    autoBumpCooldownSec: number;
    bumpMessage: string;

    multiTabEnabled: boolean;
    autonomousEnabled: boolean;
    continuousMode: boolean;
    mcpEnabled: boolean;
    voiceControlEnabled: boolean;
    soundEffectsEnabled: boolean;
    soundEffectsPerActionEnabled: boolean;
    soundEffectsActionMap: Record<string, string>;
    autoSwitchModels: boolean;
    autoGitCommit: boolean;
    autoContinueScriptEnabled: boolean;
    pollFrequency: number;
    bannedCommands: string[];
    loopInterval: number;
    maxLoopsPerSession: number;
    executionTimeout: number;
    maxCallsPerHour: number;
    voiceMode: 'push-to-talk' | 'always-listening';
    enableMemory: boolean;
    threadWaitInterval: number;
    autoApproveDelay: number;

    runtimeWaitingReminderEnabled: boolean;
    runtimeWaitingReminderDelaySec: number;
    runtimeWaitingReminderCooldownSec: number;
    runtimeAutoResumeEnabled: boolean;
    runtimeAutoResumeMessage: string;
    runtimeAutoResumeUseMinimalContinue: boolean;
    runtimeAutoResumeMinimalMessage: string;
    runtimeAutoResumeMinimalMessageVSCode: string;
    runtimeAutoResumeMinimalMessageAntigravity: string;
    runtimeAutoResumeMinimalMessageCursor: string;
    runtimeAutoResumeCooldownSec: number;
    runtimeAutoResumeStabilityPolls: number;
    runtimeAutoFixWaitingEnabled: boolean;
    runtimeAutoFixWaitingDelaySec: number;
    runtimeAutoFixWaitingCooldownSec: number;
    runtimeAutoFixWaitingEscalationEnabled: boolean;
    runtimeAutoFixWaitingEscalationThreshold: number;
    runtimeAutoFixWaitingEscalationCooldownSec: number;
    runtimeAutoFixWaitingEscalationMaxEvents: number;
    runtimeEscalationClearRequireConfirm: boolean;
    runtimeTelemetryStaleSec: number;
    runtimeStatusMenuRefreshDebounceMs: number;
    runtimeStatusMenuRefreshDebugLogs: boolean;
    runtimeAutoResumeMinScore: number;
    runtimeAutoResumeRequireStrictPrimary: boolean;

    // Watchdog Settings
    watchdogEnabled: boolean;
    watchdogTimeoutMs: number;

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

    // Interaction Methods
    interactionTextMethods: string[];
    interactionClickMethods: string[];
    interactionSubmitMethods: string[];
    interactionTimings: Record<string, number>;
    interactionRetryCount: number;
    interactionParallel: boolean;
    interactionVisualDiffThreshold: number;
    interactionClickMethodsVSCode: string[];
    interactionClickMethodsAntigravity: string[];
    interactionClickMethodsCursor: string[];
    interactionClickSelectorsVSCode: string[];
    interactionClickSelectorsAntigravity: string[];
    interactionClickSelectorsCursor: string[];
    // Experimental
    experimental: {
        cdpAggressiveDiscovery: boolean;
        cdpExplicitDiscovery: boolean;
    };
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

    get<T>(key: string): T {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        return config.get<T>(key) as T;
    }

    async update(key: string, value: any, target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global): Promise<void> {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        await config.update(key, value, target);
    }

    getAll(): AntigravityConfig {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

        // Backward compatibility migration logic for runtime values
        const legacyBumpMessage = config.get<string>('bumpMessage', 'bump');
        const legacyAutoBumpEnabled = config.get<boolean>('autopilotAutoBumpEnabled', true);
        const legacyAutoAcceptEnabled = config.get<boolean>('autoAcceptEnabled', false);
        const legacyAutoAllEnabled = config.get<boolean>('autoAllEnabled', false);
        const legacyAutopilotAutoAccept = config.get<boolean>('autopilotAutoAcceptEnabled', legacyAutoAllEnabled || legacyAutoAcceptEnabled);
        const legacyRunExpand = config.get<boolean>('autopilotRunExpandContinueEnabled', true);
        const legacyPoll = config.get<number>('autoAcceptPollIntervalMs', config.get('pollFrequency', 1000));

        return {
            strategy: config.get('strategy', 'cdp'),
            interactionUiProfile: config.get('interactionUiProfile', 'auto'),
            continuousMode: config.get('continuousMode', true),
            // Audio Settings
            audio: {
                enabled: config.get('audio.enabled', config.get('soundEffectsEnabled', false)),
                volume: config.get('audio.volume', 1.0)
            },

            // New Actions Logic
            actions: {
                bump: {
                    enabled: config.get('actions.bump.enabled', legacyAutoBumpEnabled),
                    text: config.get('actions.bump.text', legacyBumpMessage),
                    cooldown: config.get('actions.bump.cooldown', config.get('autoBumpCooldownSec', config.get('autoApproveDelay', 30))),
                    typingDelayMs: config.get('actions.bump.typingDelayMs', 50),
                    submitDelayMs: config.get('actions.bump.submitDelayMs', 100)
                },

                autoAccept: {
                    enabled: config.get('actions.autoAccept.enabled', legacyAutopilotAutoAccept),
                    pollIntervalMs: config.get('actions.autoAccept.pollIntervalMs', legacyPoll),
                    delayMs: config.get('actions.autoAccept.delayMs', 100)
                },
                run: {
                    enabled: config.get('actions.run.enabled', legacyRunExpand),
                    delayMs: config.get('actions.run.delayMs', 100)
                },
                expand: {
                    enabled: config.get('actions.expand.enabled', legacyRunExpand),
                    delayMs: config.get('actions.expand.delayMs', 50)
                }
            },

            // Legacy Fields (Mapped for compatibility)
            autoAcceptEnabled: legacyAutoAcceptEnabled,
            autoAllEnabled: legacyAutoAllEnabled,
            autopilotAutoAcceptEnabled: legacyAutopilotAutoAccept,
            autopilotAutoBumpEnabled: legacyAutoBumpEnabled,
            autopilotRunExpandContinueEnabled: legacyRunExpand,
            autoAcceptPollIntervalMs: legacyPoll,
            autoBumpCooldownSec: config.get('autoBumpCooldownSec', config.get('autoApproveDelay', 30)),
            bumpMessage: legacyBumpMessage,

            multiTabEnabled: config.get('multiTabEnabled', false),
            autonomousEnabled: config.get('autonomousEnabled', false),
            mcpEnabled: config.get('mcpEnabled', false),
            voiceControlEnabled: config.get('voiceControlEnabled', false),
            soundEffectsEnabled: config.get('soundEffectsEnabled', false),
            soundEffectsPerActionEnabled: config.get('soundEffectsPerActionEnabled', true),
            soundEffectsActionMap: config.get('soundEffectsActionMap', {
                submit: 'submit',
                bump: 'bump',
                resume: 'bump',
                type: 'type',
                run: 'run',
                expand: 'expand',
                'alt-enter': 'alt-enter',
                accept: 'click',
                'accept-all': 'success',
                allow: 'click',
                continue: 'submit',
                click: 'click',
                success: 'success',
                error: 'error'
            }),
            autoSwitchModels: config.get('autoSwitchModels', true),
            autoGitCommit: config.get('autoGitCommit', false),
            autoContinueScriptEnabled: config.get('autoContinueScriptEnabled', true),
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
            runtimeWaitingReminderEnabled: config.get('runtimeWaitingReminderEnabled', true),
            runtimeWaitingReminderDelaySec: config.get('runtimeWaitingReminderDelaySec', 60),
            runtimeWaitingReminderCooldownSec: config.get('runtimeWaitingReminderCooldownSec', 180),
            runtimeAutoResumeEnabled: config.get('runtimeAutoResumeEnabled', true),
            runtimeAutoResumeMessage: config.get('runtimeAutoResumeMessage', 'Continue with the next highest-priority development task in this workspace. If everything is complete, summarize what is done and propose the next best improvement.'),
            runtimeAutoResumeUseMinimalContinue: config.get('runtimeAutoResumeUseMinimalContinue', true),
            runtimeAutoResumeMinimalMessage: config.get('runtimeAutoResumeMinimalMessage', 'Continue with the next highest-priority development task in this workspace.'),
            runtimeAutoResumeMinimalMessageVSCode: config.get('runtimeAutoResumeMinimalMessageVSCode', 'Continue with the next highest-priority coding task in this VS Code workspace.'),
            runtimeAutoResumeMinimalMessageAntigravity: config.get('runtimeAutoResumeMinimalMessageAntigravity', 'Continue with the next highest-priority Antigravity development task.'),
            runtimeAutoResumeMinimalMessageCursor: config.get('runtimeAutoResumeMinimalMessageCursor', 'Continue with the next highest-priority Cursor coding task in this workspace.'),
            runtimeAutoResumeCooldownSec: config.get('runtimeAutoResumeCooldownSec', 300),
            runtimeAutoResumeStabilityPolls: config.get('runtimeAutoResumeStabilityPolls', 2),
            runtimeAutoFixWaitingEnabled: config.get('runtimeAutoFixWaitingEnabled', true),
            runtimeAutoFixWaitingDelaySec: config.get('runtimeAutoFixWaitingDelaySec', 180),
            runtimeAutoFixWaitingCooldownSec: config.get('runtimeAutoFixWaitingCooldownSec', 300),
            runtimeAutoFixWaitingEscalationEnabled: config.get('runtimeAutoFixWaitingEscalationEnabled', true),
            runtimeAutoFixWaitingEscalationThreshold: config.get('runtimeAutoFixWaitingEscalationThreshold', 2),
            runtimeAutoFixWaitingEscalationCooldownSec: config.get('runtimeAutoFixWaitingEscalationCooldownSec', 900),
            runtimeAutoFixWaitingEscalationMaxEvents: config.get('runtimeAutoFixWaitingEscalationMaxEvents', 10),
            runtimeEscalationClearRequireConfirm: config.get('runtimeEscalationClearRequireConfirm', true),
            runtimeTelemetryStaleSec: config.get('runtimeTelemetryStaleSec', 12),
            runtimeStatusMenuRefreshDebounceMs: config.get('runtimeStatusMenuRefreshDebounceMs', 800),
            runtimeStatusMenuRefreshDebugLogs: config.get('runtimeStatusMenuRefreshDebugLogs', false),
            runtimeAutoResumeMinScore: config.get('runtimeAutoResumeMinScore', 70),
            runtimeAutoResumeRequireStrictPrimary: config.get('runtimeAutoResumeRequireStrictPrimary', true),

            // Watchdog Settings
            watchdogEnabled: config.get('watchdogEnabled', true),
            watchdogTimeoutMs: config.get('watchdogTimeoutMs', 15000),

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
            interactionTimings: config.get('interactionTimings', {
                'vscode-cmd': 100,
                'native-accept': 60,
                'vscode-submit': 50
            }),
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
            ]),
            experimental: {
                cdpAggressiveDiscovery: config.get('experimental.cdpAggressiveDiscovery', false),
                cdpExplicitDiscovery: config.get('experimental.cdpExplicitDiscovery', true)
            }
        };
    }
}

export const config = ConfigManager.getInstance();
