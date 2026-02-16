const fs = require('fs');
const path = 'main_scripts/full_cdp_script.js';
const lines = fs.readFileSync(path, 'utf8').split('\n');

// Lines to remove: 1046 to 1117 (1-based)
// Array indices: 1045 to 1116
const startLine = 1046;
const endLine = 1117;
const startIndex = startLine - 1;
const deleteCount = endLine - startLine + 1;

console.log(`Original lines: ${lines.length}`);
console.log(`Removing lines ${startLine} to ${endLine} (${deleteCount} lines)`);
console.log(`Line ${startLine} content: ${JSON.stringify(lines[startIndex])}`);
console.log(`Line ${endLine} content: ${JSON.stringify(lines[startIndex + deleteCount - 1])}`);

lines.splice(startIndex, deleteCount);

console.log(`New lines: ${lines.length}`);
fs.writeFileSync(path, lines.join('\n'));
console.log('Done.');
