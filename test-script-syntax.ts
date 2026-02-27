import { AUTO_CONTINUE_SCRIPT } from './src/scripts/auto-continue';
console.log("Length:", AUTO_CONTINUE_SCRIPT.length);
try {
    new Function(AUTO_CONTINUE_SCRIPT);
    console.log("Syntax OK");
} catch (e: any) {
    console.error("Syntax Error:", e);
}
