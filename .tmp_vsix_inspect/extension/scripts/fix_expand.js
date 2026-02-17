const fs = require('fs');
const f = 'main_scripts/full_cdp_script.js';
let c = fs.readFileSync(f, 'utf8');
const startMarker = '    async function expandCollapsedSections()';
const endMarker = '    async function sendMessage(text)';
const si = c.indexOf(startMarker);
const ei = c.indexOf(endMarker);
if (si === -1 || ei === -1) { console.log('MARKERS NOT FOUND', si, ei); process.exit(1); }

// Scoped version: ONLY searches within chat response containers
const newFn = `    async function expandCollapsedSections() {
        // Expand collapsed sections ONLY within the chat/response area
        // IMPORTANT: Do NOT query globally — that would click file explorer, sidebar, etc.
        const expandTargets = [];
        let clicked = 0;

        // Scope: only look inside chat/response containers
        const chatContainers = queryAll('.chat-response, .interactive-session, .monaco-list-row, .interactive-result-editor-wrapper, [class*="chat-widget"], [class*="aideagent"]');

        for (const container of chatContainers) {
            // 1. Explicit expand/show buttons
            const buttons = container.querySelectorAll('[role="button"], .monaco-button, .clickable');
            for (const el of buttons) {
                const text = (el.textContent || '').trim().toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const title = (el.getAttribute('title') || '').toLowerCase();

                const isExpand = text.includes('expand') || text.includes('show') ||
                    aria.includes('expand') || aria.includes('show') ||
                    title.includes('expand') || title.includes('show');

                if (isExpand && isElementVisible(el)) {
                    expandTargets.push(el);
                }
            }

            // 2. Collapsed chevrons (right-pointing = collapsed)
            const chevrons = container.querySelectorAll('.codicon-chevron-right, [aria-expanded="false"]');
            for (const chev of chevrons) {
                if (isElementVisible(chev)) {
                    const nearbyText = (chev.closest('.monaco-list-row') || container).textContent.toLowerCase();
                    if (nearbyText.includes('run') || nearbyText.includes('step') ||
                        nearbyText.includes('command') || nearbyText.includes('terminal') ||
                        nearbyText.includes('output') || nearbyText.includes('diff')) {
                        expandTargets.push(chev);
                    }
                }
            }
        }

        // 3. Hunt for hidden "Run" buttons — traverse up parents to find collapse toggle
        //    Scoped: only Run buttons that are already inside a chat response
        const runBtns = queryAll('.chat-response div[title*="Run"], .interactive-session div[title*="Run"], .chat-response [aria-label*="Run"], .interactive-session [aria-label*="Run"]');
        for (const btn of runBtns) {
            if (!isElementVisible(btn)) {
                let parent = btn.parentElement;
                for (let d = 0; parent && d < 5; d++, parent = parent.parentElement) {
                    const toggles = parent.querySelectorAll('.codicon-chevron-right, [aria-expanded="false"]');
                    toggles.forEach(t => { if (isElementVisible(t)) expandTargets.push(t); });
                }
            }
        }

        // 4. Click unique targets
        const unique = [...new Set(expandTargets)];
        if (unique.length > 0) {
            log('[Expand] Found ' + unique.length + ' collapse toggles in chat area. Expanding...');
            for (const btn of unique) {
                try { btn.click(); clicked++; } catch (e) {}
                await new Promise(r => setTimeout(r, 50));
            }
            if (clicked > 0) {
                await workerDelay(300);
                return true;
            }
        }
        return false;
    }


`;

c = c.substring(0, si) + newFn + c.substring(ei);
fs.writeFileSync(f, c, 'utf8');
console.log('SUCCESS - expandCollapsedSections replaced (scoped version). New file length:', c.length);
