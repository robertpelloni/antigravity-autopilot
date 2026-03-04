const fs = require('fs');
const file = 'src/extension.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Add workbench patcher import
if (!content.includes('applyWorkbenchPatches')) {
    content = content.replace(
        "import { ControllerLease } from './core/controller-lease';",
        "import { ControllerLease } from './core/controller-lease';\nimport { applyWorkbenchPatches } from './core/workbench-patcher';"
    );
}

// 2. Add patcher execution inside activate
if (!content.includes('applyWorkbenchPatches().catch')) {
    content = content.replace(
        "        statusBar.updateControllerRole(false);",
        "        statusBar.updateControllerRole(false);\n\n        // Apply Terminal Auto-Run Patches\n        applyWorkbenchPatches().catch(e => log.error(`Workbench patcher failed: ${e}`));"
    );
}

// 3. Fix the 2-argument log.error call inside testInteractionMethod
content = content.replace(
    "log.error('Test Interaction Method Failed', e);",
    "log.error(`Test Interaction Method Failed: ${e}`);"
);

fs.writeFileSync(file, content);
console.log('Patch complete.');
