import * as vscode from 'vscode';
import { createLogger } from '../utils/logger';
import { config } from '../utils/config';

const log = createLogger('StatusBar');

export interface StatusBarState {
    autoAllEnabled: boolean;
    multiTabEnabled: boolean;
    autonomousEnabled: boolean;
    loopCount: number;
    mode: string;
    runtimeStatus?: string;
}

export class StatusBarManager {
    private statusMain: vscode.StatusBarItem;
    private statusSettings: vscode.StatusBarItem;
    private runtimeStateLabel: string | null = null;
    private controllerRoleLabel: string | null = null;
    private controllerRoleTooltip: string | null = null;
    private disposed = false;

    constructor(context: vscode.ExtensionContext) {
        // Main Toggle
        this.statusMain = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusMain.command = 'antigravity.showStatusMenu';
        context.subscriptions.push(this.statusMain);

        // Settings Gear
        this.statusSettings = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.statusSettings.command = 'antigravity.openSettings';
        this.statusSettings.text = '$(gear)';
        this.statusSettings.tooltip = 'Open Antigravity Dashboard';
        context.subscriptions.push(this.statusSettings);

        this.statusMain.show();
        this.statusSettings.show();
        log.info('Status bar initialized');
    }

    update(state: StatusBarState): void {
        if (this.disposed) return;

        const runtimeSuffix = this.runtimeStateLabel ? ` • ${this.runtimeStateLabel}` : '';
        const controllerSuffix = this.controllerRoleLabel ? ` • ${this.controllerRoleLabel}` : '';
        const statusSuffix = `${runtimeSuffix}${controllerSuffix}`;

        const screenReader = config.get('accessibility.screenReaderOptimized');

        if (state.autonomousEnabled) {
            this.statusMain.text = screenReader ? `Antigravity: Running (${state.loopCount})` : `$(sync~spin) Yoke: ${state.loopCount}${statusSuffix}`;
            this.statusMain.tooltip = this.controllerRoleTooltip
                ? `Autonomous Mode Running - Click to Stop (${this.controllerRoleTooltip})`
                : 'Autonomous Mode Running - Click to Stop';
            this.statusMain.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
        } else if (state.autoAllEnabled) {
            this.statusMain.text = screenReader ? `Antigravity: Monitoring` : `$(rocket) Yoke: CDP${statusSuffix}`;
            this.statusMain.tooltip = this.runtimeStateLabel
                ? `CDP Auto-All Enabled (${this.runtimeStateLabel})${this.controllerRoleTooltip ? ` | ${this.controllerRoleTooltip}` : ''}`
                : `CDP Auto-All Enabled${this.controllerRoleTooltip ? ` | ${this.controllerRoleTooltip}` : ''}`;
            this.statusMain.backgroundColor = undefined;
        } else {
            this.statusMain.text = screenReader ? `Antigravity: Off` : `$(circle-slash) Yoke: OFF${statusSuffix}`;
            this.statusMain.tooltip = `Antigravity Paused - Click to Enable${this.controllerRoleTooltip ? ` | ${this.controllerRoleTooltip}` : ''}`;
            this.statusMain.backgroundColor = undefined;
        }
    }

    updateControllerRole(isLeader: boolean, leaderWorkspace?: string | null): void {
        if (this.disposed) return;

        this.controllerRoleLabel = isLeader ? 'LEADER' : 'FOLLOWER';
        if (isLeader) {
            this.controllerRoleTooltip = 'Controller lease role: LEADER (this window controls automation)';
            return;
        }

        const workspaceSuffix = leaderWorkspace ? ` | leader workspace: ${leaderWorkspace}` : '';
        this.controllerRoleTooltip = `Controller lease role: FOLLOWER (another window is active)${workspaceSuffix}`;
    }

    updateRuntimeState(runtimeState: any | null): void {
        if (!runtimeState || !runtimeState.status) {
            this.runtimeStateLabel = null;
            return;
        }

        const status = String(runtimeState.status);
        if (status === 'waiting_for_chat_message') {
            this.runtimeStateLabel = 'WAITING';
        } else if (status === 'all_tasks_complete') {
            this.runtimeStateLabel = 'COMPLETE';
        } else if (status === 'pending_accept_actions') {
            this.runtimeStateLabel = 'PENDING';
        } else if (status === 'processing') {
            this.runtimeStateLabel = 'ACTIVE';
        } else if (status === 'idle') {
            this.runtimeStateLabel = 'IDLE';
        } else if (status === 'stopped') {
            this.runtimeStateLabel = null;
        } else {
            this.runtimeStateLabel = status.toUpperCase();
        }
    }

    dispose(): void {
        this.disposed = true;
        this.statusMain.dispose();
        this.statusSettings.dispose();
    }
}
