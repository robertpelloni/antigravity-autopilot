const fs = require('fs');
const code = fs.readFileSync('c:/Users/hyper/workspace/antigravity-autopilot/test_script.js', 'utf8');
const lines = code.split('\n');

let nested = 1; // Start inside 'try {'

for (let i = 673; i <= 1027; i++) {
    let line = lines[i];
    // Very rudimentary strip
    line = line.replace(/'.*?'/g, ''); 
    line = line.replace(/".*?"/g, ''); 
    line = line.replace(/\/\/.*/g, '');

    for (const c of line) {
        if (c === '{') nested++;
        else if (c === '}') nested--;
    }

    if (nested > 1 && lines[i].includes('{') && !lines[i].includes('}')) {
       console.log("Scope OPENED at line " + (i+1) + " depth: " + nested + " -> " + lines[i].trim());
    }
    if (lines[i].includes('}') && !lines[i].includes('{')) {
       console.log("Scope CLOSED at line " + (i+1) + " depth: " + nested + " -> " + lines[i].trim());
    }
}

console.log("Final depth: " + nested);
