const fs = require('fs');
const path = require('path');

const filePath = path.join('d:', '01_BUILD_APP', 'REMOTE_AGENT', 'frontend', 'js', 'app.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replacement 1: updateActionBubble
const target1 = `    updateActionBubble() {
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

const replace1 = `    updateActionBubble() {
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

// Replacement 2: toggleAutoMode
const target2 = `    toggleAutoMode(enabled) {
        this.isAutoMode = enabled;
        console.log(\`🔄 Auto Mode: \${enabled ? 'ON' : 'OFF'}\`);
        
        if (enabled && this.pendingActions.size > 0) {
            this.addChatBubble('system', '⚡ Auto-accepting pending actions...');
            this.acceptAllActions();
        }
    }`;

const replace2 = `    toggleAutoMode() {
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

// Helper to normalize whitespace for matching (simple version)
function escapeRegExp(string) {
    return string.replace(/[.*+?^$\{}:()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// Check if direct replacement works
if (content.includes(target1)) {
    console.log("Found target1, replacing...");
    content = content.replace(target1, replace1);
} else {
    console.log("Target1 not found exactly. Trying normalized match...");
    // Try to match ignoring whitespace differences
    // This is risky but let's try to just find the function signature and replace the block if structure matches
    // Actually, let's just log failure for now
    console.log("Still could not find target1.");
    // Force replace by finding lines? 
    // Manual line search
    const lines = content.split('\\n');
    // Find start of updateActionBubble
    const startIdx = lines.findIndex(l => l.includes('updateActionBubble() {'));
    if (startIdx !== -1) {
        // Assume it ends 21 lines later? No, count braces?
        // Let's just hardcode the logic: replace from startIdx to startIdx + 21
        console.log("Found updateActionBubble at line " + (startIdx + 1));
        // Verify it looks like what we expect
        if (lines[startIdx + 1].includes('const count = this.pendingActions.size;')) {
            console.log("Confirmed start. Replacing block.");
            // Splice out old lines
            // Old block is ~21 lines
            const newLines = replace1.split('\\n');
            lines.splice(startIdx, 22, ...newLines);
            // Note: 22 lines to remove (from view_file it was 715 to 736 inclusive = 22 lines)
        }
    }
    content = lines.join('\\n');
}

if (content.includes(target2)) {
    console.log("Found target2, replacing...");
    content = content.replace(target2, replace2);
} else {
    console.log("Target2 not found exactly.");
    const lines = content.split('\\n');
    // Find start of toggleAutoMode
    const startIdx = lines.findIndex(l => l.includes('toggleAutoMode(enabled) {'));
    if (startIdx !== -1) {
        console.log("Found toggleAutoMode at line " + (startIdx + 1));
        // Splice out old lines (approx 9 lines: 767 to 775)
        const newLines = replace2.split('\\n');
        lines.splice(startIdx, 9, ...newLines);
    }
    content = lines.join('\\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done.");
