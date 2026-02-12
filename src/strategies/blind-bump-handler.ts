import * as vscode from 'vscode';
import { config } from '../utils/config';
import { CDPHandler } from '../services/cdp/cdp-handler';

export class BlindBumpHandler {
    private timer: NodeJS.Timeout | null = null;
    private statusBar: vscode.StatusBarItem | undefined;
    private isActive = false;

    constructor(private cdp: CDPHandler) { }

    public start() {
        this.stop();
        this.isActive = true;
        const delay = (config.get<number>('autoApproveDelay') || 10) * 1000;

        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBar.text = '$(pulse) AG: Init';
        this.statusBar.show();

        this.timer = setInterval(() => this.cycle(), delay + 2000);
    }

    public stop() {
        this.isActive = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (this.statusBar) this.statusBar.dispose();
    }

    private async cycle() {
        if (!this.isActive) return;
        const msg = config.get<string>('bumpMessage') || 'bump';
        if (!msg) return;

        if (this.statusBar) this.statusBar.text = '$(zap) AG: Bumping...';

        await this.openChat();
        if (this.cdp) {
            await this.typeMessage(msg);
            await this.submit();
        }
    }

    private async openChat() {
        const cmd = vscode.commands.executeCommand;
        await cmd('workbench.action.chat.open');
        await new Promise(r => setTimeout(r, 500));
        await cmd('workbench.action.chat.focusInput');
    }

    private async submit() {
        const cmd = vscode.commands.executeCommand;
        await cmd('workbench.action.chat.submit');
        // Force Enter
        await this.cdp.dispatchKeyEventToAll({ type: 'keyDown', keyIdentifier: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
        await new Promise(r => setTimeout(r, 50));
        await this.cdp.dispatchKeyEventToAll({ type: 'keyUp', keyIdentifier: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    }

    private async typeMessage(msg: string) {
        console.log('[BlindBumpHandler] Typing:', msg);
        for (let i = 0; i < msg.length; i++) {
            const char = msg[i];
            const charCode = char.charCodeAt(0);
            const evt = {
                type: 'keyDown', text: char, unmodifiedText: char,
                keyIdentifier: char, code: 'Key' + char.toUpperCase(),
                windowsVirtualKeyCode: charCode, nativeVirtualKeyCode: charCode
            };
            await this.cdp.dispatchKeyEventToAll(evt);
            await new Promise(r => setTimeout(r, 10));
            // KeyUp omitted for brevity in avoiding loops, or I add it separately
        }
    }
}
