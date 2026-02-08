import * as vscode from 'vscode';

export class Logger {
    private static sharedOutputChannel: vscode.OutputChannel | undefined;
    private context: string;

    constructor(context: string) {
        this.context = context;
        if (!Logger.sharedOutputChannel) {
            Logger.sharedOutputChannel = vscode.window.createOutputChannel('Antigravity Autopilot');
        }
    }

    info(message: string) {
        this.log('INFO', message);
    }

    debug(message: string) {
        this.log('DEBUG', message);
    }

    warn(message: string) {
        this.log('WARN', message);
    }

    error(message: string) {
        this.log('ERROR', message);
    }

    private log(level: string, message: string) {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${level}] ${message}`;
        console.log(`[${this.context}] ${formatted}`);
        this.outputChannel.appendLine(formatted);
    }

    private get outputChannel(): vscode.OutputChannel {
        if (!Logger.sharedOutputChannel) {
            Logger.sharedOutputChannel = vscode.window.createOutputChannel('Antigravity Autopilot');
        }
        return Logger.sharedOutputChannel;
    }
}

export function createLogger(context: string): Logger {
    return new Logger(context);
}
