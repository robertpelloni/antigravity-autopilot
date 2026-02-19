import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Antigravity Debug');
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
