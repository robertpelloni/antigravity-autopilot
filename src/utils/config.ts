import * as vscode from 'vscode';

export const CONFIG_SECTION = 'antigravity';

/**
 * v8.2 — Radically simplified config.
 *
 * Only settings that are ACTUALLY READ by extension.ts / cdp-strategy.ts / status-bar.ts:
 *   - autopilotAutoAcceptEnabled (toggle)
 *   - autoAllEnabled (toggle alias)
 *   - autoAcceptEnabled (toggle alias)
 *   - actions.bump.text (bump text)
 *   - actions.bump.cooldown (bump cooldown seconds)
 *   - actions.bump.stallTimeout (stall detection seconds)
 *   - accessibility.screenReaderOptimized (status bar)
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
