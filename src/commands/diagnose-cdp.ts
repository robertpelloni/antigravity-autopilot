
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
        // Access the handler through the client (we need to cast or expose it, 
        // but for now let's assume we can add a method to Client or cast it)
        // Since we didn't expose diagnose on Client, let's add it or cast.
        // Actually, let's add it to CDPClient as well to keep it clean.

        // Wait, I didn't add diagnose to CDPClient in the plan, I added it to CDPHandler.
        // I need to update CDPClient to expose it.

        const handler = (cdpClient as any).handler;
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
