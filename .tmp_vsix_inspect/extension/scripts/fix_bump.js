const fs = require('fs');
const f = 'main_scripts/full_cdp_script.js';
let c = fs.readFileSync(f, 'utf8');

console.log('File length:', c.length);

// ============================================================
// FIX 1: Store config in __autoAllState
// ============================================================
const marker1 = 'Agent Loaded (IDE:';
const idx1 = c.indexOf(marker1);
if (idx1 === -1) { console.log('FIX1: marker not found'); process.exit(1); }
// Go back to the start of the line containing this
let lineStart1 = c.lastIndexOf('\n', idx1) + 1;
const configInsert = `            // Store user config in state for loops to use\r\n            state.bumpMessage = config.bumpMessage || '';\r\n            state.autoApproveDelay = (config.autoApproveDelay || 30) * 1000;\r\n            state.bumpEnabled = !!config.bumpMessage;\r\n            state.threadWaitInterval = (config.threadWaitInterval || 5) * 1000;\r\n            log(\`[Config] bumpMessage="\${state.bumpMessage}", autoApproveDelay=\${state.autoApproveDelay}ms, threadWait=\${state.threadWaitInterval}ms\`);\r\n\r\n`;
c = c.substring(0, lineStart1) + configInsert + c.substring(lineStart1);
console.log('FIX1: Config storage injected');

// ============================================================
// FIX 2: Remove the broken bump from inside performClick
// ============================================================
const bumpStart = '// NEW: Bump thread after successful action if configured';
const bi = c.indexOf(bumpStart);
if (bi === -1) { console.log('FIX2: bump comment not found'); process.exit(1); }
// Find the start of this comment's line
let bumpLineStart = c.lastIndexOf('\n', bi) + 1;
// Find the closing brace `}` that ends the bump block (the one after sendMessage line)
const sendMsgLine = c.indexOf('await sendMessage(bumpMessage);', bi);
if (sendMsgLine === -1) { console.log('FIX2: sendMessage line not found'); process.exit(1); }
// Find the closing `}` after sendMessage
const closingBrace = c.indexOf('}', sendMsgLine);
// Find the end of the line with the closing brace
const braceLineEnd = c.indexOf('\n', closingBrace) + 1;
// Also remove the empty line after
let afterBrace = braceLineEnd;
while (c[afterBrace] === '\r' || c[afterBrace] === '\n' || c[afterBrace] === ' ') {
    if (c[afterBrace] === '\n') { afterBrace++; break; }
    afterBrace++;
}
c = c.substring(0, bumpLineStart) + c.substring(afterBrace);
console.log('FIX2: Removed in-click bump');

// ============================================================
// FIX 3: Add isConversationIdle() and autoBump() BEFORE sendMessage
// ============================================================
const sendMsgMarker = '    async function sendMessage(text)';
const si3 = c.indexOf(sendMsgMarker);
if (si3 === -1) { console.log('FIX3: sendMessage marker not found'); process.exit(1); }

const idleFunctions = `    // Detect if the AI conversation is idle (Good/Bad feedback badges visible)\r\n    function isConversationIdle() {\r\n        const badges = queryAll('span, [class*="badge"], [class*="feedback"]');\r\n        for (const b of badges) {\r\n            const text = (b.textContent || '').trim();\r\n            if (text === 'Good' || text === 'Bad') {\r\n                if (isElementVisible(b)) return true;\r\n            }\r\n        }\r\n        // Also check for thumbs up/down icons\r\n        const thumbIcons = queryAll('.codicon-thumbsup, .codicon-thumbsdown, [aria-label*="thumbs"], [aria-label*="feedback"]');\r\n        for (const icon of thumbIcons) {\r\n            if (isElementVisible(icon)) return true;\r\n        }\r\n        return false;\r\n    }\r\n\r\n    // Auto-bump: send a message when the conversation is idle\r\n    let lastBumpTime = 0;\r\n    async function autoBump() {\r\n        const state = window.__autoAllState;\r\n        const bumpMsg = state.bumpMessage;\r\n        if (!bumpMsg || !state.bumpEnabled) return false;\r\n\r\n        const now = Date.now();\r\n        const cooldown = state.autoApproveDelay || 30000;\r\n\r\n        // Don't bump more often than the cooldown\r\n        if (now - lastBumpTime < cooldown) {\r\n            const remaining = Math.round((cooldown - (now - lastBumpTime)) / 1000);\r\n            log(\`[Bump] Cooldown: \${remaining}s remaining\`);\r\n            return false;\r\n        }\r\n\r\n        if (isConversationIdle()) {\r\n            log(\`[Bump] AI is idle (Good/Bad visible). Sending: "\${bumpMsg}"\`);\r\n            const sent = await sendMessage(bumpMsg);\r\n            if (sent) {\r\n                lastBumpTime = now;\r\n                log('[Bump] Bump sent successfully!');\r\n                return true;\r\n            } else {\r\n                log('[Bump] Failed to send bump');\r\n            }\r\n        }\r\n        return false;\r\n    }\r\n\r\n`;
c = c.substring(0, si3) + idleFunctions + c.substring(si3);
console.log('FIX3: Added isConversationIdle() and autoBump()');

// ============================================================
// FIX 4: Add autoBump to antigravityLoop (after clicked check)
// ============================================================
const agMarker = 'Clicked ${clicked} accept buttons`;';
const agIdx = c.indexOf(agMarker);
if (agIdx === -1) { console.log('FIX4: antigravityLoop marker not found'); process.exit(1); }
// Find end of line
let agLineEnd = c.indexOf('\n', agIdx) + 1;
// Skip the closing brace `}` line
let agBraceEnd = c.indexOf('\n', agLineEnd) + 1;
const bumpBlock = `            } else {\r\n                // No buttons found — check if AI is idle and auto-bump\r\n                const bumped = await autoBump();\r\n                if (bumped) {\r\n                    log(\`[Loop] Cycle \${cycle}: Auto-bumped conversation\`);\r\n                    await workerDelay(3000);\r\n                }\r\n`;
c = c.substring(0, agBraceEnd) + bumpBlock + c.substring(agBraceEnd);
console.log('FIX4: Added autoBump to antigravityLoop');

// ============================================================
// FIX 5: Add autoBump to cursorLoop
// ============================================================
const cursorMarker = 'Clicked ${clicked} buttons`;';
const curIdx = c.indexOf(cursorMarker);
if (curIdx === -1) { console.log('FIX5: cursorLoop marker not found'); process.exit(1); }
let curLineEnd = c.indexOf('\n', curIdx) + 1;
// Check if there's already an else block here - if not, wrap
const nextLine5 = c.substring(curLineEnd, curLineEnd + 80).trim();
if (!nextLine5.startsWith('} else')) {
    // We need to change the unconditional log into a conditional
    // Replace the single log line with if/else
    // Find start of the log line
    let logLineStart = c.lastIndexOf('\n', curIdx) + 1;
    let logLineEnd = c.indexOf('\n', curIdx) + 1;
    const oldLogLine = c.substring(logLineStart, logLineEnd);
    const newCursorBlock = `            if (clicked > 0) {\r\n                log(\`[Loop] Cycle \${cycle}: Clicked \${clicked} buttons\`);\r\n            } else {\r\n                const bumped = await autoBump();\r\n                if (bumped) {\r\n                    log(\`[Loop] Cycle \${cycle}: Auto-bumped conversation\`);\r\n                    await workerDelay(3000);\r\n                }\r\n            }\r\n`;
    c = c.substring(0, logLineStart) + newCursorBlock + c.substring(logLineEnd);
    console.log('FIX5: Added autoBump to cursorLoop');
} else {
    console.log('FIX5: cursorLoop already has else block, skipping');
}

// ============================================================
// FIX 6: Add autoBump to static poll loop
// ============================================================
const staticMarker = "performClick(['button', '[class*=\"button\"]', '[class*=\"anysphere\"]']);";
const stIdx = c.indexOf(staticMarker);
if (stIdx === -1) { console.log('FIX6: static loop marker not found'); process.exit(1); }
const stLineStart = c.lastIndexOf('\n', stIdx) + 1;
const stLineEnd = c.indexOf('\n', stIdx) + 1;
const oldStaticLine = c.substring(stLineStart, stLineEnd);
const newStaticBlock = `                        const clicks = await performClick(['button', '[class*="button"]', '[class*="anysphere"]']);\r\n                        if (clicks === 0) await autoBump();\r\n`;
c = c.substring(0, stLineStart) + newStaticBlock + c.substring(stLineEnd);
console.log('FIX6: Added autoBump to static loop');

fs.writeFileSync(f, c, 'utf8');
console.log('ALL FIXES APPLIED. New file length:', c.length);
