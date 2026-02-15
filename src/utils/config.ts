import * as vscode from 'vscode';

export const CONFIG_SECTION = 'antigravity';

export interface AntigravityConfig {
    strategy: 'simple' | 'cdp';
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
            cdpPort: config.get('cdpPort', 9000),
            cdpTimeout: config.get('cdpTimeout', 10000),
            preferredModelForReasoning: config.get('preferredModelForReasoning', 'claude-opus-4.5-thinking'),
            preferredModelForFrontend: config.get('preferredModelForFrontend', 'gemini-3-pro-high'),
            preferredModelForQuick: config.get('preferredModelForQuick', 'gemini-3-flash'),
            maxConsecutiveTestLoops: config.get('maxConsecutiveTestLoops', 3),
            acceptPatterns: config.get('acceptPatterns', []),
            rejectPatterns: config.get('rejectPatterns', []),
            interactionTextMethods: config.get('interactionTextMethods', ['cdp-keys', 'clipboard-paste', 'dom-inject']),
            interactionClickMethods: config.get('interactionClickMethods', ['dom-click', 'cdp-mouse', 'vscode-cmd', 'script-force']),
            interactionSubmitMethods: config.get('interactionSubmitMethods', ['vscode-submit', 'cdp-enter', 'script-submit']),
            interactionTimings: config.get('interactionTimings', {}),
            interactionRetryCount: config.get('interactionRetryCount', 3),
            interactionParallel: config.get('interactionParallel', false)
        };
    }
}

export const config = ConfigManager.getInstance();
