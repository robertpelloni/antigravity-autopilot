const fs = require('fs');
const code = fs.readFileSync('src/scripts/auto-continue.ts', 'utf8');
const match = code.match(/export const AUTO_CONTINUE_SCRIPT = `([\s\S]+?)`;/);
if (!match) {
    console.log("Could not find string");
    process.exit(1);
}
const scriptContent = match[1];

try {
    const vm = require('vm');
    new vm.Script(scriptContent);
    console.log("Syntax is valid!");
} catch (e) {
    console.error("Syntax Error found in AUTO_CONTINUE_SCRIPT:", e);
    process.exit(1);
}
