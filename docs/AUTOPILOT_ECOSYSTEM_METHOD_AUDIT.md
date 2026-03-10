# Autopilot Ecosystem Detection/Click Audit

_Last updated: 2026-03-09_

This document catalogs Antigravity/VS Code autopilot-style extensions and summarizes how they detect actions, click buttons, and (when applicable) bump/continue execution.

## Scope and criteria

- Focus: `accept/run/retry/continue/proceed/allow/keep` detection + click execution paths.
- Source priority:
  1. Local companion repos in this workspace
  2. Public GitHub repos discovered via GitHub API + targeted repo code search
- “Works” means **likely reliable in modern Antigravity/VS Code forks** based on implementation shape.
- “Risk” means known fragility patterns (over-broad selectors, no chat gating, blind command execution, etc.).

## Quick findings (why “nearly nothing works”)

1. **Too many repos rely on broad button scans** (`button`, `[class*="button"]`) without strict chat-surface gating.
2. **Command-only auto-accept loops are blind** (they call host accept commands every N ms), so they can’t reason about context.
3. **Run safety is often shallow** (simple text checks) and misses session/frame/window targeting complexity.
4. **Nested webview/session contexts** are under-handled in many implementations.
5. **First-match/fallback heuristics** (generic textarea/button fallback) create off-target behavior in VS Code chrome.

---

## Method matrix (detection + click)

| Repo | Core method | Detection strategy | Click strategy | What works | Main risks |
|---|---|---|---|---|---|
| `hyper/antigravity-autopilot` (this repo) | CDP + injected runtime + session-aware strategy | Intent/state + selector matching + chat-surface gating + session probing | DOM pointer/mouse/click + bridge/hybrid bump + controlled submit fallbacks | Best current baseline; strongest safety layering and telemetry | Still sensitive to runtime drift and selector churn |
| `Munkhin/auto-accept-agent` | CDP injected `auto_accept.js` + background tab loop | Pattern arrays (`accept/run/retry/...`), iframe traversal, banned command nearby-text scan | DOM click dispatch loop + tab cycling | Strong practical coverage in many UIs; robust traversal patterns | Uses broad selectors; can over-match without host-specific hardening |
| `guglielmo-io/antigravity-autopilot` | CDP injection (single script engine) | Text-list matching (`RETRY_TEXTS`, `CONTINUE_TEXTS`, `RUN_TEXTS`) + panel lookup | `el.click()` with cooldown; optional auto-run blocklist | Clean/compact and run opt-in default is good | Simpler target filtering; fewer anti-misclick guardrails |
| `ImL1s/antigravity-plus` | Multi-strategy (pesosz/native/cdp) + poller + full CDP script | Poller pattern/reject lists + CDP script `isAcceptButton` + deny list | CDP click by selector; full script loop performs click+tab logic | Rich architecture and telemetry; multiple fallback modes | Selector sets include broad candidates; can need heavy tuning per IDE version |
| `linhbq82/AntiBridge-Antigravity-remote` | Bridge-first detector (`detect_actions.js`) + backend orchestration | Selector + pattern based, action extraction (`file_edit`, `terminal_command`, retry), pending-action model | Prefer WebSocket bridge accept/reject; fallback to CDP evaluate/click; keyboard fallback | Strong remote-control workflow and explicit pending-action state | Accept patterns can still over-match; backend/page desync possible |
| `linhbq82/Antibridge-autoaccep-for-antigravity` | Command-loop extension companion | No DOM detection; periodic command execution | Executes `antigravity.agent.acceptAgentStep`/terminal commands on interval | Very simple and predictable in compatible hosts | Blind mode, no content/risk detection, host-command dependency |
| `Yajusta/antigravity-auto-accept` | Command-loop extension | No DOM detection; blind polling | Executes `antigravity.agent.acceptAgentStep` every second | Minimal setup, low complexity | Accepts everything; cannot inspect command context |
| `antigravity-auto-accept` (local companion) | CDP/DOM hybrid click logic | Heuristic marker + context scoring + run candidate filtering | Direct element clicking + targeted recovery flows | Better than blind command loops for real UI state | Still heuristic-heavy; host layout drift impacts reliability |
| `yoke-antigravity` / `free-auto-accept-antigravity` | Lightweight selector wrappers | Simple selector constraints by mode | Shared click helper by target selector list | Works in narrow known layouts | Fragile to DOM/layout changes; less safety context |

---

## Concrete method references by repo

### `Munkhin/auto-accept-agent`

- Detection core:
  - `extension/main_scripts/auto_accept.js`
    - `isAcceptButton(el)`
    - `getButtonSelectors()`
    - `findNearbyCommandText(el)` + `isCommandBanned(...)`
- Click core:
  - `clickAcceptButtons()` dispatches mouse click events
- Background completion support:
  - `cursorTabLoop(...)`, `antigravityTabLoop(...)`
  - completion badges via `Good/Bad`
- Notes:
  - Strong DOM traversal across iframes (`queryAll` + recursive document walk)

### `guglielmo-io/antigravity-autopilot`

- Detection/click core:
  - `extension/extension.js`
    - `buildInjectionScript(config)`
    - `findButton(doc, textList)`
    - `clickWithCooldown(el, actionType)`
    - `getCommandText(btnEl)` + `isCommandSafe(...)`
- Notes:
  - Auto-run is opt-in by default (good safety posture)

### `ImL1s/antigravity-plus`

- Detection/click core:
  - `src/core/auto-approve/poller.ts`
    - `detectButtons()`
    - `handleDetection(...)`
    - `clickButton(...)`
  - `src/core/auto-approve/scripts/full-cdp-script.ts`
    - `isAcceptButton(el)`
    - `performClick()`
    - command-context scanning + deny list checks
- Notes:
  - Flexible strategy model, but broad selector use needs strict host gating

### `linhbq82/AntiBridge-Antigravity-remote`

- Detection core:
  - `scripts/detect_actions.js`
    - `isAcceptButton(el)`
    - `scanForActions()`
    - `extractActionDetails(button)`
    - `findRejectButton(...)`
- Orchestration/click core:
  - `backend/services/accept-detector.js`
    - `acceptAction(...)` / `rejectAction(...)`
    - bridge-first, CDP fallback
  - `backend/services/AntigravityBridge.js`
    - `acceptByClick()` / `rejectByClick()` / `stopGeneration()`
- Notes:
  - Best for explicit action queues + remote control workflows

### Command-loop family (blind accept)

- `Yajusta/antigravity-auto-accept` and `linhbq82/Antibridge-autoaccep-for-antigravity`:
  - `src/extension.ts` or `extension.js`
  - interval loop calling host commands like:
    - `antigravity.agent.acceptAgentStep`
    - `antigravity.terminal.accept`
- Notes:
  - Useful as fallback where DOM/CDP unavailable, but safety/context is weak

---

## What to adopt going forward (recommended standard)

1. **Session-aware CDP first** (main target + attached sessions).
2. **Chat-surface fail-closed gating** before any click or typing.
3. **Run clicks opt-in by default** and additionally gated by waiting-intent state.
4. **No generic input fallback** (never default to first textarea).
5. **Bridge + telemetry hooks** for explicit action/state observability.
6. **Selector registry per host build** (Antigravity/Cursor/VS Code variants) with versioned tests.

---

## Backlog for expansion

- Add GitHub API discovery automation that periodically refreshes candidate repos and updates this file.
- Add per-repo reproducible test harness snapshots (`detect`, `click`, `submit`, `bump`) against the same scenario set.
- Add pass/fail scorecards by host/version (Antigravity stable/beta, VS Code Insiders, Cursor).
