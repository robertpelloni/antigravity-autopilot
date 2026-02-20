const fs = require('fs');
const path = require('path');

// Explicit path with forward slashes
const filePath = 'd:/01_BUILD_APP/REMOTE_AGENT/frontend/js/app.js';

console.log(`Reading file: ${filePath}`);

if (!fs.existsSync(filePath)) {
    console.error("File does not exist!");
    process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');
console.log(`File size: ${content.length} bytes`);
console.log(`First 50 chars: ${content.substring(0, 50).replace(/\n/g, '\\n')}`);

// 1. UPDATE updateActionBubble
// Match function signature and body until the closing brace that matches the indentation
// updateActionBubble is indented by 4 spaces.
// The closing brace should be on a line with just 4 spaces and }.
// We'll simplistic regex: updateActionBubble\(\) \{ <stuff> \} <newline> <space> <space> <space> <space> } 
// Actually, let's just use a large chunks replacement logic but strictly finding the index.

const startMarker1 = 'updateActionBubble() {';
const endMarker1 = '    }'; // A line with just indentation and } 
// But there might be other blocks.
// Let's find the start index
const funcStart = content.indexOf('updateActionBubble() {');

if (funcStart === -1) {
    console.error("Could not find updateActionBubble function definition");
} else {
    // Find the NEXT occurrence of "    }" that closes this method?
    // That is risky. 
    // Let's look for the known content inside that we want to replace.
    // "const container = this.elements.actionButtons;"
    const knownInner = 'const container = this.elements.actionButtons;';
    const innerIdx = content.indexOf(knownInner, funcStart);

    if (innerIdx !== -1) {
        // We found the old version!
        console.log("Found old updateActionBubble.");
        // Find the end of the method. 
        // It ends with: 
        //             if (this.isAutoMode) {
        //                 this.acceptAllActions();
        //             }
        //         }
        //     }
        // matching the indentation.

        // Let's replace the whole block based on surrounding text context if possible.
        // Or just replace from funcStart to the closing brace.

        // Instead of complex logic, allow me to just REPLACE a Known Block with New Block if exact match fails.
        // I will try to construct the EXACT matches again.

        const oldBlock = `    updateActionBubble() {
        const count = this.pendingActions.size;
        const container = this.elements.actionButtons;
        const badge = this.elements.actionCountBadge;

        if (count === 0) {
            // Hide everything
            container?.classList.add('hidden');
            this.toggleActionMenu(false);
        } else {
            // Show badge container
            container?.classList.remove('hidden');
            
            // Update badge
            if (badge) badge.textContent = count;

            // Handle Auto Mode
            if (this.isAutoMode) {
                this.acceptAllActions();
            }
        }
    }`;

        const newBlock = `    updateActionBubble() {
        const count = this.pendingActions.size;
        const badge = this.elements.pendingBadge;

        if (count === 0) {
            badge?.classList.add('hidden');
        } else {
            badge?.classList.remove('hidden');
            if (badge) badge.textContent = count;
            
            // Handle Auto Mode
            if (this.isAutoMode) {
                this.acceptAllActions();
            }
        }
    }`;

        // Try exact replace
        if (content.indexOf(oldBlock) !== -1) {
            console.log("Exact match found for updateActionBubble. Replacing.");
            content = content.replace(oldBlock, newBlock);
        } else {
            console.log("Exact match failed. Trying to normalize line endings.");
            // Standardize content and block to \n
            const normalize = (s) => s.replace(/\r\n/g, '\n');
            if (normalize(content).includes(normalize(oldBlock))) {
                console.log("Normalized match found. Replacing.");
                // We need to replace in the original string though.
                // This is tricky.
                // Let's just use the funcStart and find the end manually.

                // We know the block starts at funcStart.
                // We know the old block length (roughly).
                // Use regex for loose match of body.

                const regex = /updateActionBubble\(\) \{\s*const count = this\.pendingActions\.size;[\s\S]*?this\.acceptAllActions\(\);\s*\}\s*\}\s*?\}/;
                // This regex is getting complicated.

                // Fallback: Splice based on line numbers from previous tool output?
                // updateActionBubble starts at line 715.
                const lines = content.split('\n');
                // re-verify line 715 (index 714)
                if (lines[714] && lines[714].includes('updateActionBubble() {')) {
                    console.log("Verified start at line 715.");
                    // Replace lines 714 to 735 (22 lines)
                    const newLines = newBlock.split('\n');
                    lines.splice(714, 21, ...newLines); // Remove 21 lines? 
                    // Old block has 21 lines?
                    // Count:
                    // 1. start
                    // 2. const ...
                    // ...
                    // 22. }
                    // Let's check line 736: }
                    // splice(714, 22, ...newLines)
                    lines.splice(714, 22, ...newLines);
                    content = lines.join('\n');
                } else {
                    console.log("Could not verify start line.");
                }
            }
        }
    } else {
        console.log("Could not find inner content of updateActionBubble. Already updated?");
    }
}

// 2. UPDATE toggleAutoMode
// Start search after updateActionBubble
const toggleStart = content.indexOf('toggleAutoMode(enabled) {');
if (toggleStart !== -1) {
    console.log("Found old toggleAutoMode.");
    const oldToggleBlock = `    toggleAutoMode(enabled) {
        this.isAutoMode = enabled;
        console.log(\`🔄 Auto Mode: \${enabled ? 'ON' : 'OFF'}\`);
        
        if (enabled && this.pendingActions.size > 0) {
            this.addChatBubble('system', '⚡ Auto-accepting pending actions...');
            this.acceptAllActions();
        }
    }`;

    const newToggleBlock = `    toggleAutoMode() {
        this.isAutoMode = !this.isAutoMode;
        
        const btn = this.elements.btnOptMode;
        if (btn) {
            btn.textContent = this.isAutoMode ? 'AUTO' : 'MANUAL';
            // Optional: Add visual feedback for active state
            btn.style.borderColor = this.isAutoMode ? 'var(--accent-success)' : 'var(--glass-border)';
            btn.style.color = this.isAutoMode ? 'var(--accent-success)' : 'var(--text-primary)';
        }

        console.log(\`🔄 Auto Mode: \${this.isAutoMode ? 'ON' : 'OFF'}\`);
        
        if (this.isAutoMode && this.pendingActions.size > 0) {
            this.addChatBubble('system', '⚡ Auto-accepting pending actions...');
            this.acceptAllActions();
        }
    }`;

    // Try exact replace
    if (content.indexOf(oldToggleBlock) !== -1) {
        content = content.replace(oldToggleBlock, newToggleBlock);
    } else {
        console.log("Exact match failed for toggleAutoMode. Trying line splice.");
        const lines = content.split('\n');
        // Find line
        const idx = lines.findIndex(l => l.includes('toggleAutoMode(enabled) {'));
        if (idx !== -1) {
            console.log("Replacing at line " + (idx + 1));
            // Old block is ~9 lines
            const newLines = newToggleBlock.split('\n');
            lines.splice(idx, 9, ...newLines);
            content = lines.join('\n');
        }
    }
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Update complete.");
