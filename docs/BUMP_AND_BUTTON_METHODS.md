# Bump + Button Automation Methods (Antigravity Autopilot)

Last updated: 2026-02-27

This document records the **current runtime methods** used by `src/scripts/auto-continue.ts` and their observed reliability intent in Antigravity/VS Code chat surfaces.

## 1) Bump Typing Methods

### Method order (configured)
`automation.bump.typeMethods` default order:
1. `exec-command`
2. `native-setter`
3. `dispatch-events`

### Reliability notes
- `exec-command` (**primary, preferred**)  
  Uses `document.execCommand('insertText', false, text)`. This is currently the most reliable path for chat composer insertion.
- `native-setter` (**fallback**)  
  Uses native textarea setter (`HTMLTextAreaElement.prototype.value`) then dispatches `input`/`change`. Works in many React inputs but can desync in some virtualized editors.
- `dispatch-events` (**last resort**)  
  Directly mutates `input.value` and dispatches events. Kept as a recovery path only.

### Focus/visibility guard
Bump execution is now guarded by:
- `automation.bump.requireVisible` (existing)
- `automation.bump.requireFocused` (runtime default true)

This prevents multi-window bump spam when multiple IDE windows are open but only one is focused.

### Per-window dedupe (new)
- Runtime tracks per-window bump state (`pendingText`, `lastTypedAt`, `lastSubmitAt`, `lastSubmitAttemptAt`).
- If the same bump text was already typed recently and remains pending, runtime suppresses re-typing spam and retries submit instead.
- Goal: **type once per window per pending bump**, then keep retrying submit without poll-loop retyping.

---

## 2) Bump Submit Methods

### Method order (configured)
`automation.bump.submitMethods` default order:
1. `click-send`
2. `enter-key` (kept in config but guarded in runtime)

### Reliability notes
- `click-send` (**primary, preferred**)  
  Uses scoped DOM click path (`tryClick`) with strict chat-surface safety checks.
- `enter-key` (**intentionally suppressed in runtime**)  
  Keyboard Enter dispatch is blocked to avoid leaking into host keybindings (Run menu / layout actions in forked hosts).

### Current send detection selectors (submit click path)
The runtime attempts click targets matching:
- `[title*="Send" i]`, `[aria-label*="Send" i]`
- `[title*="Submit" i]`, `[aria-label*="Submit" i]`
- `[title*="Continue" i]`, `[aria-label*="Continue" i]`
- `button[type="submit"]`
- `[aria-keyshortcuts*="Enter" i]`
- `[data-testid*="send" i]`, `[data-testid*="submit" i]`
- `.codicon-send`, `.send-button`

### Narrowed known-good submit strategy
For Antigravity fork stability:
1. `click-send` only (primary)
2. Keep keyboard submit disabled in runtime safety path
3. Expand selector coverage first before considering any key fallback changes

---

## 3) Run / Expand / Accept-All Detection + Click Methods

## Run
- Gate: `automation.actions.clickRun` + control detect methods
- Action methods (preferred order):
  1. `dom-click`
  2. `native-click`
- Selector strategy includes command-intent labels:
  - `Run in Terminal`, `Run command`, `Execute command`
  - `Expand/Run`, `Expand / Run`
  - plus `data-testid*="run"` and `aria-keyshortcuts` hints
- Safety: no `alt-enter` key fallback (blocked intentionally)

## Expand
- Gate: `automation.actions.clickExpand` + control detect methods
- Action methods (preferred order):
  1. `dom-click`
  2. `native-click`
- Selector strategy:
  - `Expand`
  - `requires input`
  - collapsed indicators/twisties

## Accept All
- Gate: `automation.actions.clickAcceptAll` (independent)
- Action methods:
  1. `accept-all-button`
  2. `keep-button`
  3. `allow-all-button`
  4. `dom-click`
- Text fallback: normalized `acceptall` text/label match on visible chat-surface targets.

## Retry + Always Approve
- Retry and Always Approve are now included in the safe click selector + semantic fallback paths in both runtime layers:
  - `src/scripts/auto-continue.ts`
  - `main_scripts/full_cdp_script.js`
- Covered selector families:
  - `title` / `aria-label` contains `Retry`
  - `title` / `aria-label` contains `Always Approve`
  - `data-testid` variants such as `always-approve`, `always_approve`, `approve-always`
- Safety remains unchanged: blocked-shell/unsafe-context and chat-surface validation still apply.

---

## 4) Safety Model (Do Not Remove)

All click methods are constrained by:
- unsafe-context rejection (workbench chrome/menu/layout/file-attach/settings zones)
- banned icon ancestry checks
- chat-surface validation (`isChatActionSurface`)

This is designed to avoid ghost clicks into non-chat UI while still allowing action buttons in valid chat containers.

---

## 5) Operational Guidance

## 5.1) Known-working path (current production intent)

For reliable operation, the expected path is:
1. `CDP: ON` in the controlling window status bar.
2. Window role is `LEADER` (or follower fail-open explicitly enabled).
3. Runtime is injected only into the focused-visible page target in single-target mode.
4. Bump send path uses `click-send` first; if unavailable, `form.requestSubmit()`, then guarded Enter dispatch.
5. Run/Expand clicks execute via DOM scan/click on safe chat/action surfaces only.

If any of the above is missing, behavior is expected to degrade safely (block instead of unsafe click/type).

## 5.2) Methods intentionally NOT used (by design)

The following are intentionally disabled/avoided because they produced unsafe host behavior in Antigravity fork builds:
- Native fallback commands for Run/Expand from extension host (`workbench.*` command fallbacks).
- Broad textarea + global keyboard submit fallbacks from backend send path.
- Legacy `__ANTIGRAVITY_COMMAND__` bridge command execution.
- Unscoped keyboard submit relays (`submit|keys`) that can leak into menu/layout shortcuts.
- Unconditional leader takeover on every focus transition.

These are non-working **by policy** (safety), not regressions.

If bump text is typed repeatedly but not submitted:
1. Verify runtime focus/visibility state (focused window should be the only bumper).
2. Verify role status is stable (no rapid leader/follower flapping in logs).
2. Enable action logging and inspect `submit` action telemetry lines.
3. Confirm send button selectors still match current host DOM.
4. Prefer selector updates over re-enabling keyboard submit fallbacks.

If Run/Expand/Accept-All still do not click in Antigravity fork:
1. Enable `antigravity.automation.debug.logAllActions=true` and `antigravity.automation.debug.logToExtension=true`.
2. Capture logs for one reproduction cycle.
3. Provide the exact lines below from Antigravity Debug output.

---

## 6) Logs that help immediately

Yes — logs will help a lot. Please capture and share lines containing:

- `state changed generating=`
- `Smart Resume State:`
- `[RoleGuard]`
- `[SafetyGate] Blocked non-chat click target`
- `Clicked Run`
- `Clicked Expand`
- `Clicked Accept All`
- `action=submit`
- `[SubmitGuard] Pending bump remains unsent`

These lines let us determine, with high confidence, whether the failure is:
- role propagation,
- chat-surface gating,
- selector miss,
- or submit click miss.

If Run/Expand/Accept-All are not clicking:
1. Check whether safety counters are rising (blocked non-chat/safety gate).
2. Add host-specific selector variants (aria-label/title/data-testid) inside existing safe click flow.
3. Keep action execution DOM-first; avoid host keyboard command fallbacks in forked environments.
