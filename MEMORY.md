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

## Recent Release Gotchas (v5.2.3)

- **Panel Chrome Click-Loop Risk**: Broad button scans can accidentally click VS Code panel/header/tab chrome controls in loops. Keep strict exclusions in `isValidInteractionTarget` for tab/tablist + workbench chrome containers, and preserve regression coverage in `tests/panel-click-guard.test.js`.
- **Run Pattern Over-Match**: Avoid broad standalone `run` accept-pattern matching; keep command-intent variants (`run in terminal`, `run command`, `execute command`) to reduce false positives outside chat action surfaces.
- **Secure Release Audit Policy**: Current ecosystem may report high advisories in dev tooling with no upstream fix path. Policy now computes effective high/critical counts with a narrow allowlist; do not broaden this list casually. Non-allowlisted high/critical findings must still fail CI.

## Phantom Clicks & The Custom Layout Flicker
When dealing with "ghost" UI actions (e.g., the window layout mysteriously toggling during automated loops):
- **Not a DOM Event:** We instrumented `click-spy-advanced.js` and confirmed there are absolutely zero untrusted DOM MouseEvents triggering layout changes.
- **The Culprit is Native Layer or Shortcuts:** The CDP `__ANTIGRAVITY_COMMAND__` dispatch or stray `submitWithKeys` Enter/Space keys firing while focus is improperly trapped in the workbench chrome triggers native commands.
- **Fix Pattern:** Always ensure the chat composer input explicitly holds focus *before* emitting Enter keystrokes to prevent VS Code keybindings from intercepting the submit event.

## Recent Hardening Notes (v5.2.63)

- **Antigravity Selector Isolation:** In mixed environments (Antigravity + VS Code Insiders/Copilot both open), broad Antigravity selectors like `button`/`button.grow` can still discover non-chat chrome surfaces. Keep Antigravity click selectors narrow and avoid merging broad shared click selectors into Antigravity mode.
- **Remote Control Security Baseline:** Embedded remote server must default to localhost-only bind and validate HTTP/WS client host allowlist before accepting control traffic. LAN mode should remain opt-in and explicitly configured.

## Recent Hardening Notes (v5.2.71)

- **TypeAndSubmit Enter Fallback Risk:** Even when main submit fallback is blocked in AG mode, secondary `typeAndSubmit` key-dispatch paths can still emit Enter combos. Keep AG mode fail-closed in *all* submit paths, not only primary submit handlers.
- **ForceAction Run/Expand Lock:** Manual/runtime `forceAction('run'|'expand')` must be blocked in AG mode; broad run/expand selector sets can reintroduce workbench chrome targeting.
- **AG Expansion Pre-Pass:** `expandCollapsedSections()` pre-click sweeps should be disabled in AG mode unless explicitly scoped to verified chat surfaces; otherwise they can surface unstable periodic behavior.

## Recent Hardening Notes (v5.2.72)

- **Measure Every Blocked Path:** Safety fixes are stronger when each blocked path increments explicit counters. Expose these counters in runtime snapshots (`safetyCounters`, `blockedUnsafeActionsTotal`) so watchdog/debug tooling can correlate suppression spikes with loop behavior.

## Recent Hardening Notes (v5.2.73)

- **Visibility Beats Silent Safety:** Snapshot counters are only useful if operators can see them quickly. Keep Runtime State UI wired to `safetyCounters`/`safetyStats` and render a compact severity signal (`QUIET`/`ACTIVE`/`HOT`) so suppression spikes are diagnosable without opening raw JSON reports.

## Recent Hardening Notes (v5.2.74)

- **Trend Context Matters:** Point-in-time blocked totals are not enough during live debugging. Pair safety totals with trend deltas and normalized rate (`/min`) and mirror the same signal in status-menu diagnostics so operators can detect spike bursts without opening the dashboard.

## Recent Hardening Notes (v5.2.75)

- **Always-On Safety Visibility:** Dashboard/status-menu telemetry can still be missed during long unattended runs. Keep a compact safety signal (`SAFE:QUIET|ACTIVE|HOT`) in status-bar text and include a tooltip breakdown so suppression spikes remain visible in the ambient operator UI.

## Recent Hardening Notes (v5.2.76)

- **Alert Only on Meaningful HOT Events:** For operator warnings, gate alerts on HOT transitions or significant HOT deltas and enforce cooldown windows. This avoids reminder spam while still surfacing dangerous suppression bursts quickly.
