import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        const canCreate = !!(vscode as any)?.window?.createOutputChannel;
        if (canCreate) {
            outputChannel = vscode.window.createOutputChannel('Antigravity Debug');
        } else {
            outputChannel = {
                appendLine: (value: string) => console.log(value),
                append: (value: string) => console.log(value),
                clear: () => { },
                show: () => { },
                hide: () => { },
                dispose: () => { },
                replace: (value: string) => console.log(value),
                name: 'Antigravity Debug'
            } as unknown as vscode.OutputChannel;
        }
    }
    return outputChannel;
}

export function logToOutput(message: string, data?: any) {
    const channel = getOutputChannel();
    const timestamp = new Date().toLocaleTimeString();
    channel.appendLine(`[${timestamp}] ${message}`);
    if (data) {
        channel.appendLine(JSON.stringify(data, null, 2));
    }
}
