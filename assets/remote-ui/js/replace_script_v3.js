const fs = require('fs');
const filePath = 'd:/01_BUILD_APP/REMOTE_AGENT/frontend/js/app.js';

console.log(`Reading file: ${filePath}`);
let content = fs.readFileSync(filePath, 'utf8');

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

const lines = content.split('\n');
const idx = lines.findIndex(l => l.includes('updateActionBubble() {'));

if (idx !== -1) {
    console.log(`Found updateActionBubble at line ${idx + 1}`);
    // Check if it's already updated?
    if (lines[idx + 1].includes('const badge = this.elements.pendingBadge;')) {
        console.log("Already updated. Exiting.");
    } else {
        console.log("Replacing block...");
        // Ensure we are replacing the old block which is ~22 lines
        // Old block signature check:
        if (lines[idx + 1].includes('const count = this.pendingActions.size;') &&
            lines[idx + 2].includes('const container = this.elements.actionButtons;')) {

            const newLines = newBlock.split('\n');
            // Remove 22 lines (715 to 736 inclusive is 22 lines)
            lines.splice(idx, 22, ...newLines);

            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            console.log("Written changes to file.");
        } else {
            console.log("Context mismatch. Aborting safety check.");
            console.log("Line " + (idx + 2) + ": " + lines[idx + 1]);
            console.log("Line " + (idx + 3) + ": " + lines[idx + 2]);
        }
    }
} else {
    console.log("Could not find function.");
}
