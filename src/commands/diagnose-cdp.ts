
import * as vscode from 'vscode';
import { cdpClient } from '../providers/cdp-client';

export async function diagnoseCdp() {
    const panel = vscode.window.createWebviewPanel(
        'antigravityCdpDiag',
        'CDP Diagnostics',
        vscode.ViewColumn.Two,
        {}
    );

    panel.webview.html = `
        <html>
        <body style="font-family: monospace; white-space: pre-wrap; padding: 20px;">
            <h2>Running CDP Diagnostic Scan...</h2>
            <p>Please wait...</p>
        </body>
        </html>
    `;

    try {
        // Use the shared client instance to get the active handler
        // This ensures diagnostics reflect the actual state used by the automation strategy
        const handler = cdpClient.getHandler();

        if (!handler || typeof handler.diagnose !== 'function') {
            panel.webview.html = `<html><body><h2>Error</h2><p>CDP Client handler not accessible.</p></body></html>`;
            return;
        }

        const report = await handler.diagnose();

        panel.webview.html = `
            <html>
            <body style="font-family: monospace; white-space: pre-wrap; padding: 20px; background-color: #1e1e1e; color: #d4d4d4;">
                <h2>CDP Diagnostics</h2>
                <div style="background: #252526; padding: 15px; border-radius: 5px;">${report}</div>
            </body>
            </html>
        `;

    } catch (e: any) {
        panel.webview.html = `
            <html>
            <body style="font-family: monospace; white-space: pre-wrap; padding: 20px;">
                <h2>Scan Failed</h2>
                <p>${e.message}</p>
            </body>
            </html>
        `;
    }
}
