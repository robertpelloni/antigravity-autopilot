import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as os from 'os';
import { sleepPreventionActive, sleepPreventionProcess, setSleepPreventionActive, setSleepPreventionProcess, claudePanel } from '../../core/state';
import { debugLog } from '../../utils/logging';
import { getValidatedConfig } from '../../core/config';

export function startSleepPrevention(): void {
    const config = getValidatedConfig();
    const preventSleep = config.sleepPrevention.enabled;
    
    debugLog(`💤 Sleep prevention setting: ${preventSleep}, already active: ${sleepPreventionActive}`);
    
    if (!preventSleep) {
        debugLog('💤 Sleep prevention disabled in settings');
        return;
    }
    
    if (sleepPreventionActive) {
        debugLog('💤 Sleep prevention already active');
        return;
    }
    
    try {
        const platform = os.platform();
        let command: string;
        let args: string[];
        
        switch (platform) {
            case 'darwin':
                command = 'caffeinate';
                args = ['-i', '-s', '-t', (60 * 60 * 24).toString()];
                break;
            case 'win32':
                command = 'ping';
                args = ['-t', 'localhost'];
                break;
            case 'linux':
                command = 'systemd-inhibit';
                args = ['--what=sleep:idle', '--who=ClaudeAutopilot', '--why=Waiting for Claude usage limit reset', 'sleep', '7200'];
                break;
            default:
                debugLog('❌ Sleep prevention not supported on this platform');
                return;
        }
        
        debugLog(`🔧 Starting sleep prevention: ${command} ${args.join(' ')}`);
        const process = spawn(command, args, {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        setSleepPreventionProcess(process);
        setSleepPreventionActive(true);
        
        process.stdout?.on('data', (data) => {
            debugLog(`☕ Sleep prevention stdout: ${data.toString()}`);
        });
        
        process.stderr?.on('data', (data) => {
            debugLog(`⚠️ Sleep prevention stderr: ${data.toString()}`);
        });
        
        process.on('error', (error) => {
            debugLog(`❌ Sleep prevention failed: ${error.message}`);
            setSleepPreventionActive(false);
            setSleepPreventionProcess(null);
        });
        
        process.on('exit', (code) => {
            debugLog(`🛌 Sleep prevention ended with code: ${code}`);
            setSleepPreventionActive(false);
            setSleepPreventionProcess(null);
        });
        
        debugLog('☕ Sleep prevention started');
        vscode.window.showInformationMessage('Sleep prevention enabled while waiting for Claude usage limit reset');
        
    } catch (error) {
        debugLog(`❌ Failed to start sleep prevention: ${error}`);
    }
}

export function stopSleepPrevention(): void {
    if (!sleepPreventionActive || !sleepPreventionProcess) {
        return;
    }
    
    try {
        sleepPreventionProcess.kill();
        setSleepPreventionProcess(null);
        setSleepPreventionActive(false);
        debugLog('🛌 Sleep prevention stopped');
    } catch (error) {
        debugLog(`❌ Failed to stop sleep prevention: ${error}`);
    }
}

export function toggleSleepPreventionSetting(enabled: boolean): void {
    const config = vscode.workspace.getConfiguration('claudeAutopilot');
    config.update('sleepPrevention.enabled', enabled, vscode.ConfigurationTarget.Global);
    debugLog(`💤 Sleep prevention setting updated: ${enabled}`);
    
    if (!enabled && sleepPreventionActive) {
        stopSleepPrevention();
    }
}

export function sendSleepPreventionSetting(): void {
    const config = getValidatedConfig();
    const preventSleep = config.sleepPrevention.enabled;
    
    if (claudePanel) {
        try {
            claudePanel.webview.postMessage({
                command: 'setSleepPreventionSetting',
                enabled: preventSleep
            });
        } catch (error) {
            debugLog(`❌ Failed to send sleep prevention setting to webview: ${error}`);
        }
    }
}