/**
 * Auto-Run Fix — Patches the "Always Proceed" terminal policy to actually auto-execute.
 * 
 * Adapts Kanezal/better-antigravity's structural regex matching to find the 
 * onChange handler in minified code across Antigravity, Cursor, and VS Code.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

const PATCH_MARKER = '/*BA:autorun*/';

export function getWorkbenchDirs(): string[] {
    const appData = process.env.LOCALAPPDATA || '';
    const dirs = [
        path.join(appData, 'Programs', 'Antigravity', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
        path.join(appData, 'Programs', 'cursor', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
        path.join(appData, 'Programs', 'Microsoft VS Code Insiders', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench'),
        path.join(appData, 'Programs', 'Microsoft VS Code', 'resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench')
    ];
    return dirs.filter(d => fs.existsSync(d));
}

export function getTargetFiles(workbenchDir: string): Array<{ path: string; label: string }> {
    return [
        { path: path.join(workbenchDir, 'workbench.desktop.main.js'), label: 'workbench' },
        { path: path.join(workbenchDir, 'jetskiAgent.js'), label: 'jetskiAgent' },
    ].filter(f => fs.existsSync(f.path));
}

export async function isPatched(filePath: string): Promise<boolean> {
    try {
        const content = await fsp.readFile(filePath, 'utf8');
        return content.includes(PATCH_MARKER);
    } catch {
        return false;
    }
}

interface AnalysisResult {
    enumName: string;
    confirmFn: string;
    policyVar: string;
    secureVar: string;
    useEffectFn: string;
    insertAt: number;
}

function analyzeFile(content: string): AnalysisResult | null {
    const onChangeRegex = /(\w+)=(\w+)\((\(\w+\))=>\{(\w+)\(\w+\),\w+===(\w+)\.EAGER&&(\w+)\(!0\)\},\[/g;
    const match = onChangeRegex.exec(content);

    if (!match) return null;

    const [fullMatch, , , , , enumName, confirmFn] = match;
    const insertPos = match.index + fullMatch.length;

    const contextStart = Math.max(0, match.index - 3000);
    const contextEnd = Math.min(content.length, match.index + 3000);
    const context = content.substring(contextStart, contextEnd);

    const policyMatch = /(\w+)=\w+\?\.terminalAutoExecutionPolicy\?\?(\w+)\.OFF/.exec(context);
    const secureMatch = /(\w+)=\w+\?\.secureModeEnabled\?\?!1/.exec(context);

    if (!policyMatch || !secureMatch) return null;

    const policyVar = policyMatch[1];
    const secureVar = secureMatch[1];

    const useEffectFn = findUseEffect(context, [confirmFn]);

    if (!useEffectFn) return null;

    const afterOnChange = content.indexOf('])', insertPos);
    if (afterOnChange === -1) return null;

    const insertAt = content.indexOf(';', afterOnChange);
    if (insertAt === -1) return null;

    return {
        enumName,
        confirmFn,
        policyVar,
        secureVar,
        useEffectFn,
        insertAt: insertAt + 1,
    };
}

function findUseEffect(context: string, exclude: string[]): string | null {
    const candidates: Record<string, number> = {};
    const regex = /(\w{1,3})\(\(\)=>\{/g;
    let m;

    while ((m = regex.exec(context)) !== null) {
        const fn = m[1];
        if (fn.length <= 3 && !exclude.includes(fn)) {
            candidates[fn] = (candidates[fn] || 0) + 1;
        }
    }

    let best = '';
    let maxCount = 0;
    for (const [fn, count] of Object.entries(candidates)) {
        if (count > maxCount) {
            best = fn;
            maxCount = count;
        }
    }

    return best || null;
}

export interface PatchResult {
    success: boolean;
    label: string;
    status: 'patched' | 'already-patched' | 'pattern-not-found' | 'reverted' | 'no-backup' | 'error';
    bytesAdded?: number;
    error?: string;
}

export async function patchFile(filePath: string, label: string): Promise<PatchResult> {
    try {
        let content = await fsp.readFile(filePath, 'utf8');

        if (content.includes(PATCH_MARKER)) {
            return { success: true, label, status: 'already-patched' };
        }

        const analysis = analyzeFile(content);
        if (!analysis) {
            return { success: false, label, status: 'pattern-not-found' };
        }

        const { enumName, confirmFn, policyVar, secureVar, useEffectFn, insertAt } = analysis;

        const patch = `${PATCH_MARKER}${useEffectFn}(()=>{${policyVar}===${enumName}.EAGER&&!${secureVar}&&${confirmFn}(!0)},[])`;

        const backup = filePath + '.ba-backup';
        try { await fsp.access(backup); } catch {
            await fsp.copyFile(filePath, backup);
        }

        content = content.substring(0, insertAt) + patch + content.substring(insertAt);
        await fsp.writeFile(filePath, content, 'utf8');

        return { success: true, label, status: 'patched', bytesAdded: patch.length };
    } catch (err: any) {
        return { success: false, label, status: 'error', error: err.message };
    }
}

export async function applyWorkbenchPatches(): Promise<void> {
    const dirs = getWorkbenchDirs();
    for (const dir of dirs) {
        const files = getTargetFiles(dir);
        for (const file of files) {
            try {
                const res = await patchFile(file.path, file.label);
                console.log(`[Patcher] ${file.path}: ${res.status}`);
            } catch (e) {
                console.error(`[Patcher] Error patching ${file.path}: ${e}`);
            }
        }
    }
}
