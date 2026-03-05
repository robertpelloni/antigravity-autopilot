import * as vscode from 'vscode';

export const CONFIG_SECTION = 'antigravity';

/**
 * Minimal config accessor.
 *
 * Simplified runtime/dashboard now rely primarily on:
 *   - autoContinueScriptEnabled
 *   - actions.bump.enabled
 *   - actions.bump.text
 *   - actions.bump.cooldown
 *   - actions.bump.stallTimeout
 *   - actions.bump.submitDelayMs
 *   - automation.timing.pollIntervalMs
 *   - automation.actions.clickRun/clickExpand/clickAlwaysAllow/clickRetry/clickAcceptAll/clickKeep
 */

class ConfigManager {
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

    /** Returns config object — used by dashboard UI. Returns the WorkspaceConfiguration
     *  directly since it supports property access (cfg.actions, cfg.autopilotAutoAcceptEnabled etc). */
    getAll(): any {
        return vscode.workspace.getConfiguration(CONFIG_SECTION);
    }
}

export const config = ConfigManager.getInstance();
