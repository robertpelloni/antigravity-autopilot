const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolveCdpPort() {
    const envPortRaw = process.env.ANTIGRAVITY_CDP_PORT || process.env.CDP_PORT;
    const envPort = Number(envPortRaw);
    if (Number.isFinite(envPort) && envPort > 0) {
        return envPort;
    }

    try {
        const userDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity');
        const portFilePath = path.join(userDataDir, 'DevToolsActivePort');
        if (fs.existsSync(portFilePath)) {
            const content = fs.readFileSync(portFilePath, 'utf8');
            const [rawPort] = content.split('\n').map(l => l.trim()).filter(Boolean);
            const parsed = Number(rawPort);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
    } catch (_) {}

    throw new Error('Unable to resolve Antigravity CDP port. Set ANTIGRAVITY_CDP_PORT or start Antigravity with DevToolsActivePort available.');
}

async function run() {
    let client;
    try {
        const port = resolveCdpPort();
        client = await CDP({ port });
        const { Runtime } = client;

        const script = `
            (function() {
                const el = document.querySelector('.cursor-text[contenteditable="true"]') || document.querySelector('.artifact-view [contenteditable="true"]');
                if (!el) return "Not found";
                
                el.focus();
                
                // Try execCommand
                const res1 = document.execCommand('insertText', false, 'test_execCommand ');
                
                // Try TextEvent
                let res2 = false;
                try {
                    const event = document.createEvent('TextEvent');
                    event.initTextEvent('textInput', true, true, null, 'test_textEvent ', 9, 'en-US');
                    el.dispatchEvent(event);
                    res2 = true;
                } catch(e) {}
                
                // Try InputEvent
                const eventInput = new InputEvent('input', {
                    inputType: 'insertText',
                    data: 'test_InputEvent ',
                    bubbles: true,
                    cancelable: true
                });
                const res3 = el.dispatchEvent(eventInput);
                
                // Try DataTransfer paste without mock
                const dt = new DataTransfer();
                dt.setData('text/plain', 'test_paste ');
                const paste = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
                const res4 = el.dispatchEvent(paste);
                
                return "execCommand: " + res1 + ", TextEvent: " + res2 + ", InputEvent: " + res3 + ", PasteEvent: " + res4;
            })()
        `;

        const result = await Runtime.evaluate({
            expression: script,
            returnByValue: true
        });

        console.log(result.result.value);
    } catch (err) {
        console.error(err);
    } finally {
        if (client) await client.close();
    }
}

run();
