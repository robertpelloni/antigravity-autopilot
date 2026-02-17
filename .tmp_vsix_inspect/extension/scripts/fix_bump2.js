const fs = require('fs');
const f = 'main_scripts/full_cdp_script.js';
let c = fs.readFileSync(f, 'utf8');
console.log('File length:', c.length);

// ============================================================
// FIX 4: Add autoBump to antigravityLoop when clicked === 0
// Replace the simple `if (clicked > 0)` with `if/else` that bumps
// ============================================================
const agOld = `            if (clicked > 0) {\r\n                log(\`[Loop] Cycle \${cycle}: Clicked \${clicked} accept buttons\`);\r\n            }\r\n\r\n            await workerDelay(1500);`;
const agNew = `            if (clicked > 0) {\r\n                log(\`[Loop] Cycle \${cycle}: Clicked \${clicked} accept buttons\`);\r\n            } else {\r\n                // No buttons found — check if AI is idle and auto-bump\r\n                const bumped = await autoBump();\r\n                if (bumped) {\r\n                    log(\`[Loop] Cycle \${cycle}: Auto-bumped conversation\`);\r\n                    await workerDelay(3000);\r\n                }\r\n            }\r\n\r\n            await workerDelay(1500);`;

if (c.includes(agOld)) {
    c = c.replace(agOld, agNew);
    console.log('FIX4: Added autoBump to antigravityLoop');
} else {
    console.log('FIX4: WARN - marker not found exactly, trying alternate');
    // Try without \r
    const agOldLF = agOld.replace(/\r\n/g, '\n');
    if (c.includes(agOldLF)) {
        c = c.replace(agOldLF, agNew);
        console.log('FIX4: Added autoBump to antigravityLoop (LF)');
    } else {
        console.log('FIX4: SKIPPED - could not find marker');
    }
}

// ============================================================
// FIX 5: Add autoBump to cursorLoop
// Change the unconditional log to if/else
// ============================================================
const curOld = `            const clicked = await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);\r\n            log(\`[Loop] Cycle \${cycle}: Clicked \${clicked} buttons\`);\r\n\r\n            await workerDelay(800);`;
const curNew = `            const clicked = await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);\r\n            if (clicked > 0) {\r\n                log(\`[Loop] Cycle \${cycle}: Clicked \${clicked} buttons\`);\r\n            } else {\r\n                const bumped = await autoBump();\r\n                if (bumped) {\r\n                    log(\`[Loop] Cycle \${cycle}: Auto-bumped conversation\`);\r\n                    await workerDelay(3000);\r\n                }\r\n            }\r\n\r\n            await workerDelay(800);`;

if (c.includes(curOld)) {
    c = c.replace(curOld, curNew);
    console.log('FIX5: Added autoBump to cursorLoop');
} else {
    const curOldLF = curOld.replace(/\r\n/g, '\n');
    if (c.includes(curOldLF)) {
        c = c.replace(curOldLF, curNew);
        console.log('FIX5: Added autoBump to cursorLoop (LF)');
    } else {
        console.log('FIX5: SKIPPED - could not find marker');
    }
}

// ============================================================
// FIX 6: Add autoBump to static poll loop
// ============================================================
const stOld = `                        performClick(['button', '[class*="button"]', '[class*="anysphere"]']);\r\n                        await workerDelay(config.pollInterval || 1000);`;
const stNew = `                        const clicks = await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);\r\n                        if (clicks === 0) await autoBump();\r\n                        await workerDelay(config.pollInterval || 1000);`;

if (c.includes(stOld)) {
    c = c.replace(stOld, stNew);
    console.log('FIX6: Added autoBump to static loop');
} else {
    const stOldLF = stOld.replace(/\r\n/g, '\n');
    if (c.includes(stOldLF)) {
        c = c.replace(stOldLF, stNew);
        console.log('FIX6: Added autoBump to static loop (LF)');
    } else {
        console.log('FIX6: SKIPPED - could not find marker');
    }
}

// ============================================================
// FIX 7: Improve sendMessage to properly submit in VS Code chat
// The current Enter key dispatch doesn't work in many VS Code setups.
// Add multiple submission strategies.
// ============================================================
const sendOld = `            // Fallback: Press Enter\r\n            log('[Chat] Pressing Enter');\r\n            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));\r\n            return true;`;
const sendNew = `            // Fallback: Try multiple Enter strategies\r\n            log('[Chat] Pressing Enter (multiple strategies)');\r\n            // Strategy 1: keydown + keyup\r\n            chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));\r\n            chatInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));\r\n            chatInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));\r\n            await workerDelay(200);\r\n            // Strategy 2: Find any submit/send nearby\r\n            const allNearbyBtns = Array.from(document.querySelectorAll('button, [role="button"]'));\r\n            const sendCandidate = allNearbyBtns.find(b => {\r\n                const lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.textContent || '')).toLowerCase();\r\n                return lbl.includes('send') || lbl.includes('submit') || lbl.includes('chat');\r\n            });\r\n            if (sendCandidate && isElementVisible(sendCandidate)) {\r\n                log('[Chat] Found send button, clicking');\r\n                sendCandidate.click();\r\n            }\r\n            return true;`;

if (c.includes(sendOld)) {
    c = c.replace(sendOld, sendNew);
    console.log('FIX7: Improved sendMessage submission');
} else {
    const sendOldLF = sendOld.replace(/\r\n/g, '\n');
    if (c.includes(sendOldLF)) {
        c = c.replace(sendOldLF, sendNew);
        console.log('FIX7: Improved sendMessage submission (LF)');
    } else {
        console.log('FIX7: SKIPPED - could not find marker');
    }
}

fs.writeFileSync(f, c, 'utf8');
console.log('ALL REMAINING FIXES APPLIED. New file length:', c.length);
