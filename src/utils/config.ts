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

    /** Returns all settings as a plain object — used by dashboard UI */
    getAll(): Record<string, any> {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        // Convert VS Code's WorkspaceConfiguration to a plain object
        const result: Record<string, any> = {};
        const inspect = cfg as any;
        // Get all keys that have values
        if (inspect && typeof inspect === 'object') {
            for (const key of Object.keys(inspect)) {
                if (key.startsWith('_') || typeof (inspect as any)[key] === 'function') continue;
                try { result[key] = cfg.get(key); } catch { }
            }
        }
        return result;
    }
}

export const config = ConfigManager.getInstance();
