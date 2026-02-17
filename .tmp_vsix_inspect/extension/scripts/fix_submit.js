const fs = require('fs');
const f = 'main_scripts/full_cdp_script.js';
let c = fs.readFileSync(f, 'utf8');
console.log('File length:', c.length);

// ============================================================
// FIX A: Remove the broken bump from inside performClick
// Lines 915-920: this only fires after clicking a button, 
// never when AI is idle (Good/Bad visible)
// ============================================================
const bumpInClick = `                    // NEW: Bump thread after successful action if configured\r\n                    if (bumpMessage) {\r\n                        log(\`[Bump] Sending bump message: "\${bumpMessage}"\`);\r\n                        await workerDelay(1000); // Wait a bit after click\r\n                        await sendMessage(bumpMessage);\r\n                    }\r\n`;
if (c.includes(bumpInClick)) {
    c = c.replace(bumpInClick, '');
    console.log('FIX-A: Removed in-click bump from performClick');
} else {
    console.log('FIX-A: WARN - in-click bump not found with CRLF, trying LF');
    const bumpLF = bumpInClick.replace(/\r\n/g, '\n');
    if (c.includes(bumpLF)) {
        c = c.replace(bumpLF, '');
        console.log('FIX-A: Removed in-click bump (LF)');
    } else {
        console.log('FIX-A: SKIPPED');
    }
}

// ============================================================
// FIX B: Replace Enter-only dispatch with Enter+Alt+Ctrl dispatch
// The current strategy dispatches plain Enter but VS Code chat
// typically needs Enter or Alt+Enter depending on settings
// ============================================================
const oldEnterBlock = `            // Fallback: Try multiple Enter strategies\r\n            log('[Chat] Pressing Enter (multiple strategies)');\r\n            // Strategy 1: keydown + keyup\r\n            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));\r\n            chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));\r\n            chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));\r\n            await workerDelay(200);\r\n            // Strategy 2: Find any submit/send nearby\r\n            const allNearbyBtns = Array.from(document.querySelectorAll('button, [role="button"]'));\r\n            const sendCandidate = allNearbyBtns.find(b => {\r\n                const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).toLowerCase();\r\n                return lbl.includes('send') || lbl.includes('submit') || lbl.includes('chat');\r\n            });\r\n            if (sendCandidate && isElementVisible(sendCandidate)) {\r\n                log('[Chat] Found send button, clicking');\r\n                sendCandidate.click();\r\n            }\r\n            return true;`;

const newEnterBlock = `            // Fallback: Try multiple Enter strategies (plain, Alt, Ctrl)
            log('[Chat] Submitting via Enter strategies...');

            // Strategy 1: Plain Enter (works in some chat UIs)
            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            await workerDelay(300);

            // Strategy 2: Alt+Enter (VS Code chat default submit)
            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true, cancelable: true }));
            chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, altKey: true, bubbles: true }));
            await workerDelay(300);

            // Strategy 3: Ctrl+Enter (alternative submit shortcut)
            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true, cancelable: true }));
            chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true }));
            await workerDelay(300);

            // Strategy 4: Find send/submit button anywhere near the input
            const inputForm = chatInput.closest('form, div, section');
            const allBtns = inputForm ? Array.from(inputForm.querySelectorAll('button, [role="button"], a')) : Array.from(document.querySelectorAll('button, [role="button"]'));
            const sendCandidate = allBtns.find(b => {
                const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '') + ' ' + (b.className || '')).toLowerCase();
                return lbl.includes('send') || lbl.includes('submit') || lbl.includes('run') || lbl.includes('arrow') || lbl.includes('codicon-send');
            });
            if (sendCandidate && isElementVisible(sendCandidate)) {
                log('[Chat] Found send/run button, clicking: ' + (sendCandidate.getAttribute('aria-label') || sendCandidate.textContent || '').trim());
                sendCandidate.click();
            }
            return true;`;

if (c.includes(oldEnterBlock)) {
    c = c.replace(oldEnterBlock, newEnterBlock);
    console.log('FIX-B: Replaced Enter dispatch with Alt+Ctrl+button strategies');
} else {
    console.log('FIX-B: WARN - trying without CRLF');
    const oldLF = oldEnterBlock.replace(/\r\n/g, '\n');
    if (c.includes(oldLF)) {
        c = c.replace(oldLF, newEnterBlock);
        console.log('FIX-B: Replaced Enter dispatch (LF)');
    } else {
        console.log('FIX-B: SKIPPED - marker not found');
    }
}

fs.writeFileSync(f, c, 'utf8');
console.log('DONE. New file length:', c.length);
