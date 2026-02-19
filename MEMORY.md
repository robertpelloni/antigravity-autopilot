# Memory & Development Context

This file serves as a persistent brain for autonomous agents working on **Antigravity Autopilot**. It contains critical architectural gotchas, hard-learned lessons, and design preferences. Review this before attempting deep refactors.

---

## Chrome DevTools Protocol (CDP) Constraints

### 1. `full_cdp_script.js` is a Sandbox
The file `main_scripts/full_cdp_script.js` is injected via WebSocket evaluation into the **Chromium Render Thread** of the active IDE.
- **CRITICAL**: You absolutely cannot `require()` node modules here. No `fs`, no `path`, no `os`.
- The script uses an IIFE pattern to encapsulate logic. Do not try to convert it to an ES Module.
- If it throws a syntax error, the *entire extension* will fail to attach properly. Always run `node -c main_scripts/full_cdp_script.js` to syntax check it before packaging.

### 2. DOM Selectors in IDEs Shift Unpredictably
- Cursor and VS Code update their WebViews constantly. A button class like `.monaco-button-blue` might change to `.brand-primary`.
- **Preference**: We rely heavily on `aria-label` and `title` attributes (e.g., `[aria-label*="Accept"]`), as these are accessibility standards that rarely change across IDE updates.
- **Current Bug Target**: Getting the "Run" and "Expand" icon-only buttons to click has historical issues. Ensure `aria-label` checks are deep.

## VS Code Extension Host Quirks

### 1. The VSIX Cache Bug
When rapidly iterating and testing inside Cursor IDE:
- Cursor will aggressively cache the `.vsix` package. If you rebuild but do not increment the version in `package.json`, Cursor will silently ignore the new file and boot the old version.
- **Rule**: ALWAYS bump the patch version before running `npm run verify:release`, even for local testing.

### 2. Activation Silence
If the `activate(context)` function inside `src/extension.ts` throws an unhandled synchronous exception, the extension completely dies.
- *Symptom*: Commands like `antigravity.openSettings` report as "not found".
- *Current Fix (v5.0.16)*: A global `try/catch` surrounds the entire `activate` block and appends to `os.homedir() + '/antigravity-activation.log'`. Check this file immediately if the extension dies on boot.

## Design Preferences

- **Flattened Repo Structure**: Avoid `git sumbodules`. The project has struggled with detached HEAD states and submodule sync issues. Native directories are preferred.
- **Verbose Action Logging**: Users requested that *every* button click be logged visibly. Do not silence `__ANTIGRAVITY_LOG__` outputs in the CDP script; they are intentional user telemetry.
