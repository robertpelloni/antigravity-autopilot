const CDP = require('chrome-remote-interface');

async function run() {
    let client;
    try {
        client = await CDP({ port: 9222 });
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
