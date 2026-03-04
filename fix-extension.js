const fs = require('fs');
const file = 'src/extension.ts';
let content = fs.readFileSync(file, 'utf8');

// Remove getting safety
content = content.replace(/getSafetyTelemetrySummary\(runtimeState\);/g, '');
content = content.replace(/const safety = [^\n]*/g, '');

// Strip functions
content = content.replace(/const getSafetyTelemetrySummary[\s\S]*?(?=const runtimeSummary)/, '');
content = content.replace(/const (build|get)AutoResumeGuardReport[\s\S]*?(?=const buildEscalationDiagnosticsReport)/, '');
content = content.replace(/const buildEscalationDiagnosticsReport[\s\S]*?(?=const runAutoResumeReadinessFix)/, '');
content = content.replace(/const runAutoResumeReadinessFix[\s\S]*?(?=const sendAutoResumeMessage)/, 'const runAutoResumeReadinessFix = async () => {};\n        ');
content = content.replace(/const sendAutoResumeMessage[\s\S]*?(?=const handleChatSubmit)/, 'const sendAutoResumeMessage = async () => false;\n        ');

// Remove usages
content = content.replace(/const isEscalationArmed = evaluateEscalationArming[^\n]*/g, 'const isEscalationArmed = false;');
content = content.replace(/const health = evaluateCrossUiHealth[^\n]*/g, 'const health = { score: 100 };');

// Remove legacy commands
content = content.replace(/safeRegisterCommand\('antigravity\.(testInteractionMethod|copyEscalationDiagnosticsReport|copyLastResumePayloadReport|simulateAccept|simulateRun|simulateExpand)'[\s\S]*?\}\),/g, '');

// Fix inline objects
content = content.replace(/await cdp\.getRuntimeState\(\)/g, '{}');
content = content.replace(/cdp\.getRuntimeState\(\)/g, '{}');
content = content.replace(/cdp\.isConnected\(\)/g, 'true');

fs.writeFileSync(file, content);
console.log('Cleanup complete');
