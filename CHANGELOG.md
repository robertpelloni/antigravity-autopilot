# Changelog
All notable changes to the Antigravity Autopilot extension will be documented in this file.

## [5.2.211] - 2026-02-28
### Fixed
* **Antigravity Action Suppression Regression**: Relaxed Antigravity-specific `requireChatSurface` gating for Run/Expand/Submit detection/click paths so valid fork controls outside strict chat wrappers are no longer skipped.
* **Bump Input Discovery Recovery**: Added Antigravity fallback input discovery when strict chat selectors miss, while still excluding terminal/shell surfaces.
* **Leader Action Gate Reliability**: Removed `runtime.windowFocused` hard stop from `shouldAct()` and retained `document.hasFocus()`/visibility checks to avoid stale host-focus config suppressing all leader actions.
* **Submit Fallback Robustness**: Extended safe submit fallback to permit Antigravity fork inputs (non-terminal) for Enter-key fallback after send/form submit attempts.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.211 VSIX build.

## [5.2.210] - 2026-02-28
### Fixed
* **Global Leader Arbitration**: Simplified controller lease to a single global lease file (`.antigravity-controller-lease.json`) to prevent per-workspace split-brain where multiple windows could all present/act as leader.
* **Bump Submit Reliability**: Simplified submit flow to deterministic fallback order in minimal runtime (`click send` → `form.requestSubmit()` → safe chat-only Enter dispatch), improving "typed but not submitted" incidents.
* **Minimal Core Hardening**: Preserved core action surface (Run, Expand, Always Allow, Retry, Accept All, Keep) while keeping strict terminal-surface exclusion and leader/focus gating.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.210 VSIX build.

## [5.2.209] - 2026-02-28
### Fixed
* **Prompt Injection Eligibility Regression**: Removed over-strict preflight focus/visibility/leader checks in `CDPClient.sendMessage()` so prompt injection can proceed through runtime API routing instead of being rejected before session selection.
* **Watchdog Heartbeat Startup Race**: Initialized `window.__antigravityHeartbeat` immediately at runtime boot to reduce false "missing heartbeat" reinjection storms during early page/session startup.
* **Bootstrap Focus Default Safety**: Set minimal runtime default `runtime.windowFocused` to `true` until host config sync arrives, preventing premature local focus false-negatives during initialization while leader gating remains enforced.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.209 VSIX build.

## [5.2.208] - 2026-02-28
### Fixed
* **Host Window Focus Runtime Gating**: Propagated VS Code window focus state into runtime config and blocked automation when host window is unfocused, preventing multi-window bump fanout even under role drift.
* **Role/Focus Sync to Connected Sessions**: Added live runtime config refresh on host focus changes so active/follower behavior updates immediately without requiring reconnect.
* **Run/Expand/Submit Safe Fallback Matching**: Added two-pass clickable resolution (chat-first with safe non-terminal fallback) to recover icon-only and ambiguous-container action controls while preserving safety bans.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.208 VSIX build.

## [5.2.207] - 2026-02-28
### Fixed
* **Foreground Chat-Surface Bump Isolation**: Restricted minimal runtime bump input and submit targeting to verified chat/composer surfaces while excluding terminal/explorer-adjacent editables.
* **Run/Expand/Submit Icon Semantics**: Improved semantic matching for icon-only controls (`codicon-play`, chevrons/twisties, `codicon-send`) so Run/Expand/Submit actions are detected and clicked more reliably.
* **Unsafe Legacy Send Fallback Removal**: Disabled broad fallback textarea + synthetic Enter path in `CDPClient.sendMessage()` to prevent cross-surface text/key leakage.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.207 VSIX build.

## [5.2.206] - 2026-02-28
### Fixed
* **Submit Single-Flight Guarding**: Added cooldown-based in-flight submit protection in the minimal auto-continue runtime to prevent overlapping bump submit bursts.
* **CDP Action Dedupe Throttling**: Added backend dispatch dedupe throttles to suppress repeated rapid-fire action relays (especially submit actions) across page/session routes.
* **Strategy Submit Reentrancy Lock**: Added strategy-layer submit lock + short cooldown so submit categories cannot overlap while a prior submit execution is still active.
* **Chat-Surface Input Isolation**: Hardened minimal runtime input selection to chat/composer surfaces only, explicitly excluding terminal surfaces that could receive bump text (e.g., `@terminal:pwsh`).
* **Run/Expand/Submit Icon Matching**: Added icon/class/shortcut semantic hints so icon-only controls (`codicon-play`, chevrons, send icon) are reliably detected and clicked.
* **Unsafe Legacy Bump Fallback Removal**: Disabled broad legacy textarea + synthetic Enter fallback in `CDPClient.sendMessage()` to prevent cross-surface typing/keypress side effects.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.206 VSIX build.

## [5.2.205] - 2026-02-28
### Fixed
* **Minimal Fork-Aware Runtime Core**: Replaced the oversized auto-continue runtime with a simplified loop that focuses on fork detection, stalled-conversation detection, bump typing/submission, and safe action clicking.
* **Action Coverage Consolidation**: Unified DOM action targeting for `Run`, `Expand`, `Always Allow/Always Approve`, `Retry`, `Accept All`, `Accept`, `Keep`, and `Edit` using a single prioritized click pipeline.
* **Keep Button Reliability**: Added explicit `Keep` selectors and semantic matching as a first-class continuation action in the simplified runtime flow.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.205 VSIX build.

## [5.2.204] - 2026-02-28
### Fixed
* **Cross-Workspace Lease Contention Lockout**: Updated controller lease persistence to use a stable workspace-scoped lease file (`.antigravity-controller-lease.<workspace-hash>.json`) so unrelated workspaces no longer steal leader role and suppress automation in the active workspace.
* **Workspace Key Canonicalization**: Added canonical workspace normalization before hashing lease keys (including Windows case-insensitive path normalization) to ensure consistent leader arbitration across identical workspace paths.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.204 VSIX build.

## [5.2.203] - 2026-02-27
### Fixed
* **Controller Lease Role Reconciliation**: Restored global lease-file arbitration to resolve multi-window leader contention after workspace-scoped lease behavior caused all windows to report leader.
* **Hybrid Bump Bridge Truthiness**: Hardened `sendHybridBump()` so success is reported only when `__AUTOPILOT_BRIDGE__` is actually present and invoked.
* **Console Bridge Compatibility**: Expanded CDP console fallback bridge parsing to accept `__AUTOPILOT*` payloads in addition to legacy `__ANTIGRAVITY*` prefixes.
* **Run/Expand Selector Coverage**: Broadened run/expand/requires-input selector matching (`data-testid`, `Expand/Run`, shortcut hints) across interaction fallback paths to improve click reliability on forked UI variants.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.203 VSIX build.

## [5.2.202] - 2026-02-27
### Fixed
* **Workspace-Scoped Controller Lease**: Changed controller lease persistence to workspace-scoped lease files, preventing leader/follower lock contention across unrelated workspaces.
* **Bridge Routing Regression**: Restored runtime extension payload routing to `__AUTOPILOT_BRIDGE__` (with legacy fallback only), fixing dropped click/type/bump bridge actions.
* **BridgeType Script Injection Repair**: Fixed malformed injected bridge-type script wrapper so text bridge fallback executes reliably.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.202 VSIX build.

## [5.2.201] - 2026-02-27
### Fixed
* **Leader Role Transition Alignment**: Added runtime role-alignment orchestration so decentralized CDP automation starts/stops when lease role changes (including follower→leader transition), fixing cases where actions remained inactive after takeover.
* **Bump/Resume Leader Enforcement**: Hardened manual/automatic resume and hybrid bump dispatch to leader-only paths to prevent follower-window fanout typing/submission.
* **Accept-All / Run / Expand Click Reliability**: Expanded DOM click matching coverage (including additional `data-testid` and all-accept variants), removed duplicate command registrations, and tightened action routing to reduce `dom-scan-click` misses.
* **CDP Scan Noise Reduction**: Suppressed explicit fallback port-range scans when auto-discovery already resolves a valid active port, reducing stale timeout/hang-up noise.
* **Command Collision Mitigation**: Removed internal registration of `antigravity.getChromeDevtoolsMcpUrl` to avoid activation conflicts with `google.chrome-devtools-mcp`.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `package-lock.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.201 VSIX build.

## [5.2.200] - 2026-02-27
### Fixed
* **Regression Hotfix — No Leader / No Actions Deadlock**: Restored fail-open follower UI automation default at activation (`controller.followerUiAutomationEnabled` now defaults to enabled when unset) so automation does not stall in startup lease races where no leader is established quickly.
* **Startup Role Logging Clarity**: Updated follower log messaging to clearly indicate fail-open follower behavior versus explicit follower disable override.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.200 VSIX build.

## [5.2.199] - 2026-02-27
### Fixed


### Fixed
* **Cross-App CDP Isolation**: Restricted CDP target discovery/attachment to Antigravity page targets and disabled Antigravity port auto-discovery in non-Antigravity host apps, preventing VS Code/Insiders windows from influencing Antigravity automation state.
* **Implicit Port Fallback Removal**: Removed default `cdpPort` fallback wiring from the core CDP client/bootstrap probe path so automation no longer silently binds to externally configured/hardwired ports when discovery context is invalid.
* **Probe Hardcoded Port Removal**: Updated `src/scripts/run-probe.js` to resolve CDP ports via environment or Antigravity `DevToolsActivePort` file instead of fixed `9222`.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.198 VSIX build.

## [5.2.197] - 2026-02-27
### Fixed
* **Accept-All Reliability Across UI Variants**: Expanded accept-pattern matching and selector coverage for `Accept All`, `Keep`, `Allow`, `Retry`, and `Always Approve/Allow` paths across both runtime and interaction fallback layers.
* **Shadow DOM Click Discovery**: Updated interaction click scanning to include recursive Shadow DOM traversal so chat-action buttons rendered in nested webview/shadow roots are no longer missed.
* **Legacy Click Pipeline Stability**: Fixed legacy runtime `performClick()` option handling (`skipAcceptCheck`) and guarded `isAcceptButton()` against undefined state references that could silently break click loops.
* **Watchdog Reinject Churn Reduction**: Hardened watchdog logic to evaluate heartbeats across main + attached sessions and defer reinjection when recent automation activity is present, reducing false reinjections during active runs.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.197 VSIX build.

## [5.2.196] - 2026-02-27
### Fixed
* **Lease Acquisition Reliability**: Hardened `ControllerLease.tryAcquire()` to treat invalid PID leases as non-authoritative and verify lease write/readback success before reporting acquisition, reducing all-follower dead-state risk on Windows lease-file races.
* **Cross-Session Bump Fanout Guard**: `CDPClient.sendMessage()` now hard-blocks follower, hidden, and unfocused sessions before any type/submit fallback path executes, preventing multi-window bump typing when role/focus drift occurs.
* **Legacy Runtime Action Isolation**: Added runtime role + focus/visibility eligibility gates in `full_cdp_script.js` for send/click/bump flows so follower or background windows do not execute interaction actions.

### Changed
* **Role Telemetry Clarity**: `auto-continue` state-change logs now include runtime role (`leader`/`follower`) plus visibility/focus state, making no-leader/follower-only incidents much easier to diagnose from `Antigravity Debug` output.
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.196 VSIX build.

## [5.2.195] - 2026-02-27
### Fixed
* **Pending Bump Submit Recovery**: Added safe submit retry logic in `auto-continue` so typed bump text keeps attempting send-button/form submission for a short window when initial submit click races UI enable/debounce.
* **Loop-Level Submit Recovery**: Added periodic pending-bump submit recovery in the runtime loop (leader-only) to submit already-typed bump text without retyping spam.
* **Bridge Send Robustness**: `full_cdp_script.js` `sendMessage()` now retries send-button discovery/click before keyboard fallback, improving bump submit reliability in AG mode where keyboard submit fallback is intentionally blocked.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.195 VSIX build.

## [5.2.194] - 2026-02-27
### Fixed
* **No-Leader Self-Heal Fallback**: Added automatic controller-lease recovery when a window detects leaderless state (no valid lease leader), including runtime-refresh and activation preflight recovery paths.
* **Role Sync on Manual Leader Override**: `forceAcquireLeader` now immediately syncs controller role into CDP runtime config and refreshes runtime state, preventing stale follower behavior after manual takeover.
* **Startup Role Race Hardening**: `CDPStrategy` now defaults to follower (`controllerRoleIsLeader = false`) until extension lease sync applies, avoiding transient leader actions during bootstrap races.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.194 VSIX build.

## [5.2.193] - 2026-02-27
### Fixed
* **Follower Runtime Fail-Closed**: Changed controller/runtime leader defaults to fail-closed (`follower`) until explicit role sync arrives, preventing follower CDP windows from auto-typing bump text during startup/reinjection races.
* **Retry + Always Approve Coverage**: Expanded action detection/click selectors and semantic matching for `Retry` and `Always Approve` across both injected runtime layers (`auto-continue` + `full_cdp_script`) so these controls are now discovered and clicked with existing safety gates.
* **Submit Detection Breadth**: Added additional send-button aliases/data-testid variants (`Send message`, `send-message`) to improve bump submit clicks in forked chat composers.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` (including activation toast) for the 5.2.193 VSIX build.

## [5.2.192] - 2026-02-27
### Fixed
* **Action Click Recovery for Forked DOMs**: Added semantic action fallback in `tryClick()` so safe action-intent targets (Submit/Run/Expand/Accept/Keep/Continue) are allowed even when strict chat-surface container matching misses fork-specific wrappers.
* **Continue/Keep Detection Coverage**: Expanded Continue/Keep selector set to include title/aria/data-testid variants beyond `.monaco-button` so Keep actions are discoverable in Antigravity fork surfaces.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.192 VSIX build.

## [5.2.191] - 2026-02-27
### Fixed
* **Per-Window Bump Dedupe**: Added runtime per-window bump tracking (`pendingText`, `lastTypedAt`, `lastSubmitAt`, `lastSubmitAttemptAt`) and retry retype window to prevent repeated bump typing spam when submit remains pending.
* **Expand/Run Detection Coverage**: Added explicit `Expand/Run` selector and text-match support so combined action labels are classified as run-capable actions.
* **Submit Telemetry Clarity**: Added explicit pending-unsent submit guard telemetry to distinguish selector miss from typing success.

### Changed
* **Bump/Button Method Documentation**: Expanded `docs/BUMP_AND_BUTTON_METHODS.md` with narrowed known-good method guidance and exact log signatures for rapid diagnostics.
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.191 VSIX build.

## [5.2.190] - 2026-02-27
### Fixed
* **Live Leader/Follower Role Propagation**: `CDPHandler.setControllerRole()` now immediately re-injects runtime automation config into all connected pages/sessions so follower windows stop Smart Resume bump typing without waiting for reconnect.
* **Fork UI Chat-Surface Fallback**: Hardened `isChatActionSurface()` with semantic action fallback + `data-testid`/chat container heuristics for Antigravity fork DOM drift, improving Run/Expand/Accept All/Submit click eligibility while preserving unsafe-shell bans.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.190 VSIX build.

## [5.2.189] - 2026-02-27
### Fixed
* **Bump Multi-Window Spam Guard**: Added focused-window gating for Smart Resume bumping (`requireFocused`) so non-focused windows no longer repeatedly type bump text.
* **Bump Submit Robustness**: Expanded submit button detection selectors (`aria-keyshortcuts`, `data-testid`, additional Send/Submit aliases) to improve submit click recovery when host DOM labels vary.
* **Run Action Regression Hardening**: Removed run signal-count precondition that could skip run attempts when detection counters missed host-specific labels.
* **Accept-All Gate Logic**: Decoupled `acceptAll` gate from `clickAccept`; `clickAcceptAll` now independently enables bulk-accept flow.

### Added
* **Method Reliability Documentation**: Added `docs/BUMP_AND_BUTTON_METHODS.md` with current bump typing/submit method order, successful strategy notes, detection/click matrices, and safety guidance.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.189 VSIX build.

## [5.2.188] - 2026-02-27
### Fixed
* **Leader/Follower Runtime Isolation**: Added explicit runtime role propagation so follower windows skip Smart Resume auto-bump typing/submission paths while leader behavior remains active.
* **Run/Expand/Continue Fallback Routing**: Corrected CDP fallback selector routing so run/expand/continue actions use action-specific selector sets instead of accept-oriented selectors.

### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.188 VSIX build.

## [5.2.187] - 2026-02-27
### Changed
* **Release Metadata Sync**: Bumped version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.187 VSIX build.

## [5.2.186] - 2026-02-27
### Fixed
* **Auto-Continue Action Safety Hardening**: Tightened run-signal detection, blocked unsafe submit/run key fallback paths, improved unknown-sender startup gating for Smart Resume, and added explicit `accept-all` fallback routing across CDP bridge and strategy execution.

### Changed
* **Release Metadata Sync**: Updated version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` for the 5.2.186 VSIX build.

## [5.2.185] - 2026-02-27
### Fixed
* **Unsafe Fallback Type Relay Blocked**: Hardened frontend fallback action routing so `type` fallback events are no longer executed as backend text-input actions, preventing accidental literal `"type"` insertion and cross-session typing fanout.

### Changed
* **Release Metadata Sync**: Updated version metadata across `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` (including runtime activation toast) for the 5.2.185 VSIX build.

## [5.2.168] - 2026-02-26
### Fixed
* **Auto-Continue Cursor Run Action**: Repaired auto-run functionality inside Cursor's Composer and native chat surfaces. Broadened the global workbench chat safety whitelist to include `[class*="composer"]` and `.aichat-container`, and explicitly appended `.codicon-play` matching to the `analyzeChatState` visual signal text detector.

## [5.2.167] - 2026-02-26
### Fixed
* **TypeScript Compilation Errors**: Fixed type mismatch vulnerabilities where explicit configuration arrays (`string[]`) were improperly compared against boolean literals during fallback option derivation.
* **Auto-Continue DOM Selectors**: Refined deeply-nested Shadow DOM queries in `auto-continue.ts` injected context to support native Cursor inputs (`[aria-label="chat input"]`, `.composer-input`) and correctly attribute missing `title` properties on "Expand" / "Accept All" buttons.

## [5.2.166] - 2026-02-26
### Added
* **Comprehensive DOMScanClick Safety Test Suite**: Added 22 new unit tests for `interaction-methods.ts` (35 total, all green). New coverage spans: ban-list completeness (icons, ancestor classes, attribute phrases, tab/tablist roles), wildcard/regex injection via accept/reject patterns, selector injection safety via JSON.stringify escaping, icon-only button classification (play→run, chevron→expand, check→accept), reject-pattern precedence over accept, default pattern safety (no dangerous terms like `install`/`delete`), BridgeCoordinateClick ban-list and disabled-by-default assertion, default config sanitization (dom-scan-click as solitary click method), fallbackSelector emptiness, text length filter, mousedown+mouseup+click dispatch, and visibility check completeness.
### Fixed
* **Pre-existing Phantom Method Test**: Fixed `should support expanded method ID combinations` test that referenced phantom method IDs (`native-accept`, `process-peek`, `visual-verify-click`, `cdp-enter`, `ctrl-enter`, `alt-enter`) never registered in the registry. Updated to reference only actually-registered methods.

## [5.2.84] - 2026-02-23
### Fixed
* Fixed a bug where the native command-based click fallback (`NativeAcceptCommands`) could hang the Interaction Method Registry for upwards of 22 seconds if a VS Code command payload was unhandled or blocked. Injected a strict 500ms `Promise.race` timeout wrapper for all naive UI command dispatches (`interactive.acceptChanges`, `workbench.action.chat.submit`, etc.).

## [5.2.83] - 2026-02-23
### Fixed
* Fixed an infinite loop bug in `AutonomousLoop` where repeated `CDP not available` connection failures (such as those caused by system memory exhaustion) would spam the console and loop instantly. `executeTask` now correctly triggers exponential backoff instead of treating the failure as a completed pass.

## [5.2.82] - 2026-02-23
### Fixed
- **Fallback Interaction Logic Unblocked**: Removed the same generic `/^(run|execute)$/` text filtering RegExp from the backend `DOMScanClick` fallback interaction method. When the primary CDP auto-continue script failed to inject, the fallback automation was incorrectly rejecting exact matches for 'Run', mirroring the bug fixed in 5.2.80.

## [5.2.80] - 2026-02-23
### Fixed
- **Webview Hardware Click Restore (For Real)**: Re-applied the `__ANTIGRAVITY_CLICK__` hardware bridge sequence to `remoteClick` in `full_cdp_script.js`. A previous session incorrectly applied this critical fix to a backup directory, leaving Webview components (which ignore programmatic `el.click()` events) unable to process clicks.
- **Unblocked Run/Expand Signals**: Removed an overly broad filtering block in `isAcceptButton` that explicitly rejected generic 'run' strings. Added 'run' and 'expand' to the `defaultPatterns` unified array so that Copilot Chat Webview inputs are forwarded to the restored hardware click sequence.

## [5.2.76] - 2026-02-22
### Added
- **Guarded HOT Spike Alerts**: Runtime refresh loop now raises operator warnings when safety state transitions to HOT or experiences a significant HOT blocked-count jump, with cooldown protection to prevent notification spam.
- **Safety Spike Diagnostics Logging**: Added structured HOT safety log line capturing total blocked actions and per-category breakdown (`run/expand`, `non-chat`, `submit`, `focus-loss`) when alerts fire.

## [5.2.75] - 2026-02-22
### Added
- **Status Bar Safety Badge**: Added a live `SAFE:QUIET|ACTIVE|HOT` runtime badge in the status bar so safety suppression state is visible without opening dashboard/status menus.
- **Status Bar Safety Tooltip Breakdown**: Status bar tooltips now include blocked-action totals and category breakdown (run/expand, non-chat targets, submit fallback, focus-loss dispatch).

## [5.2.74] - 2026-02-22
### Added
- **Safety Trend Telemetry in Runtime Card**: Runtime dashboard now displays safety trend deltas and blocked-action rate (`/min`) alongside total blocked unsafe actions and per-category counters.
- **Status Menu Safety Line Item**: Added a dedicated safety signal row (`QUIET` / `ACTIVE` / `HOT`) to the status quick menu with blocked totals broken down by run/expand, non-chat targets, submit fallbacks, and focus-loss dispatches.
- **Safety Data in Diagnostics Reports**: Last-resume and escalation diagnostics payloads now embed a normalized safety telemetry summary for faster incident triage.

## [5.2.73] - 2026-02-22
### Added
- **Runtime Safety Counter Dashboard Visibility**: Surfaced blocked-action telemetry in the Runtime State card with explicit fields for total blocked unsafe actions, blocked run/expand actions, blocked non-chat targets, blocked submit-key dispatches, and blocked focus-loss key dispatches.
- **Safety Severity Signal Chip**: Added a QUIET / ACTIVE / HOT runtime chip derived from blocked-action totals to make suppression spikes immediately visible during live monitoring.

## [5.2.72] - 2026-02-22
### Added
- **AG Safety Telemetry Counters**: Added blocked-action counters to both runtime layers so residual unsafe trigger suppression is measurable. `auto-continue` now tracks blocked non-chat clicks, AG run/expand gate blocks, blocked submit-key dispatches, and focus-loss key-dispatch blocks.
- **Injected Runtime Safety Snapshot Metrics**: Added `safetyCounters` and `blockedUnsafeActionsTotal` to runtime state snapshots from `full_cdp_script.js`, including counters for AG forceAction blocks, AG expansion-pass suppression, invalid target filtering, non-chat surface filtering, and stuck-keypress fallback suppression.

## [5.2.71] - 2026-02-22
### Fixed
- **AG Residual Trigger Suppression (Fail-Closed++)**: Disabled `typeAndSubmit` Enter-key fallbacks in Antigravity runtime, suppressed AG keys-fallback dispatch in `auto-continue`, blocked manual `forceAction(run|expand)` in AG mode inside injected runtime, disabled AG expansion pre-pass in `performClick/expandCollapsedSections`, and removed stuck-button keypress fallback invocation from the injected click loop.

## [5.2.70] - 2026-02-22
### Fixed
- **AG Emergency Lockdown (Run/Expand + Enter Fallback)**: Added explicit Antigravity runtime lock that disables run/expand automation gates in `auto-continue`, disables Enter-key submit fallback in AG runtime, and disables injected `submitWithKeys` keyboard fallback in AG mode while rejecting run/expand accept-pattern actions in AG for safety.

## [5.2.69] - 2026-02-22
### Fixed
- **AG Native Command Loop Guard**: Removed native command fallbacks from `antigravity.clickRun` and `antigravity.clickExpand`, blocked command-driven click methods (`vscode-cmd`, `process-peek`) in config sanitization/defaults, and forced run/expand CDP action execution to use command-free click registries.

## [5.2.68] - 2026-02-22
### Fixed
- **AG 2s Layout Toggle Regression (Fail-Closed Gate)**: Enforced chat-surface-only gating across all auto-continue click paths (`tryClick`, continue, feedback, run, expand) and injected click-loop action execution. Non-chat shell/menu/titlebar/menuitem targets are now blocked even if they pass selector matching.

## [5.2.67] - 2026-02-22
### Fixed
- **AG Residual Menu Activation (Further Reduction)**: Added explicit chat-surface gating for `run` and `expand` action execution in `auto-continue` (including scoped selector flows), and hardened injected click classification to reject broad generic run labels unless they are explicit command-intent variants (`run in terminal`, `run command`, `execute command`).

## [5.2.66] - 2026-02-22
### Fixed
- **Residual Run/Menu Cross-Surface Fallbacks**: Removed cross-profile click fallback scanning from `performClick` in the injected runtime so fallback now stays scoped to the active UI mode only, expanded unsafe-menu bans to include explicit menuitem/menubar surfaces, and tightened auto-continue run signal/selectors to explicit command-intent labels (no broad run icon matching).

## [5.2.65] - 2026-02-22
### Fixed
- **Antigravity Run/Menu Misclick Regression**: Hardened `auto-continue` and interaction registry DOM scanning to block menubar/menuitem/titlebar surfaces, removed stale `alt-enter` default run/expand methods, and disallowed bare `run` text matching so only explicit run intents (`Run in Terminal` / command-intent labels) are eligible.

## [5.2.64] - 2026-02-22
### Changed
- Release bump for fresh VSIX packaging and manual validation on Antigravity + VS Code Insiders Copilot.

## [5.2.63] - 2026-02-22
### Fixed
- **Antigravity Target Isolation (Dual VS Code Fork Safety)**: Hardened injected Antigravity click routing to remove broad selectors (`button`, `[role="button"]`, `button.grow`) and block run-labeled send-button matching in Antigravity mode.
- **Antigravity Selector Merge Guard**: Added mode-aware selector merge behavior so broad shared click selectors are no longer merged into Antigravity click scans, reducing cross-surface chrome hits (e.g., Run menu/Customize Layout).
- **Antigravity Tab Detection Hardening**: Replaced broad `button.grow` tab detection with role/chat-oriented tab selectors and stricter filtering.

### Added
- **Remote Control Host Allowlist Security (P4.2 milestone)**:
    - Added localhost-default binding for embedded remote server (`127.0.0.1` when LAN mode is disabled).
    - Added explicit HTTP and WebSocket host allowlist checks with deny logging.
    - Added new settings: `antigravity.remoteControlAllowLan` and `antigravity.remoteControlAllowedHosts`.
    - Added regression coverage in `tests/remote-server-security.test.js`.

## [5.2.62] - 2026-02-22
### Fixed
- **The True Hardware Coordinate Ghost Click (Nuclear Option)**: Version `5.2.61` removed `__ANTIGRAVITY_CLICK__` from the main frontend script, but "Customize Layout" ghost clicks paradoxically persisted. A deep audit revealed a secondary, hidden click vector: the `interaction-methods.ts` backend subsystem (designed for Auto-Accept strategies) also contained independent methods (`CDPMouseEvent` and `BridgeCoordinateClick`) that calculated spatial dimensions, scaled them improperly via VS Code's `window.zoomLevel`, and dispatched physical scaling-cursed coordinate hardware clicks either natively from Node or across the bridge. Both of these strategies were permanently neutered from the core engine flow. Finally, the extension receiver port inside `cdp-handler.ts` was entirely stripped of the `__ANTIGRAVITY_CLICK__` listener to mathematically guarantee that hardware clicks can never execute across the bridge again.

## [5.2.77] - 2026-02-23
### Fixed
- **The Ultimate Ghost Click Truth / WebView Hardware Restore**: The "Customize Layout" ghost clicks were actually caused by the *Node Backend* evaluating broad fallback selectors (like `[aria-label="Run"]`) universally across all sessions, hitting the OS Titlebar's global "Run" menu item on the Main Window. Because of zoom scaling, clicking the exact coordinates of that titlebar item physically landed on "Customize Layout". 
- To fix this, an **Absolute Exclusion Shield** (`el.closest` on all workbench UI shells) was injected directly into the Node Evaluation String for `BridgeCoordinateClick`, protecting the Main Window while simultaneously allowing the restoration of `__ANTIGRAVITY_CLICK__` hardware dispatches. This fixes the regression where WebViews (like Copilot Chat) were failing to process standard DOM `.click()` events on their internal "Run" and "Expand" actions.

## [5.2.61] - 2026-02-22
### Fixed
- **The Simultaneous Ghost Click (Zoom Level Offsets & Settings Toggles)**: Finally discovered the complete multi-causal bug responsible for opening the "Auto proceed" submenu and "Customize Layout" buttons at the exact same moment. 
  1. **Settings Toggles Matching**: The word "proceed" was included in the `defaultPatterns` string matching array for Accept buttons. When Copilot rendered an "Auto proceed" settings toggle next to its "Run in Terminal" button, the script mistook it for a single-use "Allow" button and invoked `remoteClick` on it.
  2. **CDP Hardware Coordinate Desyncs**: The `remoteClick` script natively dispatched a PointerEvent to that button (which opened the "Auto proceed" submenu), but then redundantly transmitted `__ANTIGRAVITY_CLICK__` to the backend for a Chromium-level fallback physical click. Because the user's OS display scaling (`window.devicePixelRatio`) or VS Code `window.zoomLevel` was factored into Chromium's viewport space but not the DOM bounds rect, the physical CDP click struck offset coordinates on the screen... perfectly landing on the Title Bar's "Customize Layout" button at the top right of the application frame! 
  - **Resolution**: `__ANTIGRAVITY_CLICK__` CDP clicks have been completely and permanently retired from the execution loop. `remoteClick` now exclusively relies on completely scale-agnostic native `el.click()` events across all windows. Furthermore, "Auto proceed" was permanently blacklisted.

## [5.2.60] - 2026-02-22
### Fixed
- **Coordinate Bleed True Root Cause (Webview Class Inheriting)**: Uncovered a massive flaw in the frame detection logic added in `5.2.57`. The script assumed that `!!document.querySelector('.monaco-workbench')` would only evaluate to `true` in the main VS Code window context. However, the Microsoft Chat team explicitly wraps their Webview DOMs in a `<div class="monaco-workbench">` to ensure global CSS variable cascading formatting remains identical to native IDE tabs. As a result, the Webviews passed the main window test and continuously transmitted phantom CDP coordinates (`X=800, Y=15`) over the bridge to the main process, which caused Chromium's compositor to click the exact physical coordinates on the main OS application menu bar. Evaluated execution frames now rely on `vscode-webview://` protocol matching and DOM `window.top` boundary checking.

## [5.2.59] - 2026-02-22
### Fixed
- **Alt+Enter Keyboard Bleed (Windows Native Menu Activation)**: Resolved the final missing piece of the "Customize Layout" and "Run" menu bugs. The automation script was utilizing an `Alt+Enter` simulated keypress as a robust fallback for the "Run" and "Expand" actions when normal clicks failed. On Windows running Electron/VS Code, dispatching an `Alt` key simulation bubbles directly to the native OS window manager, causing the top Menu Bar and Layout Controls to gain focus, bypassing all DOM-level filtering. The `alt-enter` strategy has been completely stripped from the extension.

## [5.2.58] - 2026-02-22
### Fixed
- **Synchronized DOM Banlists (Menu & Layout Clicks)**: Fixed a bug where `auto-continue.ts` was bypassing the strict IDE chrome exclusions present in the main automation script. Replicated the exact, exhaustive `bannedAncestors` string from `full_cdp_script.js` directly into `auto-continue.ts`, specifically outlawing `.monaco-menu`, `.monaco-menu-container`, and `.title-actions`. This entirely terminates the ability of `auto-continue.ts` to execute naive `Element.click()` calls against the VS Code native "Run" menu and Custom Title Bar "Customize Layout" buttons.

## [5.2.57] - 2026-02-22
### Fixed
- **Coordinate Bleed (Menu Bar & Layout Clicks)**: Fixed a critical bug where `Input.dispatchMouseEvent` was firing at incorrect coordinates when `full_cdp_script.js` executed inside VS Code Webviews. The script calculated Webview-relative coordinates instead of root window offsets, causing clicks intended for Chat buttons to accidentally strike the main "Run" menu or "Customize Layout" buttons on the Title Bar. Clicks inside Sub-frames are now strictly contained via native `el.click()`, dropping CDP dispatch.

## [5.2.56] - 2026-02-22
### Fixed
- **Phantom Clicks / Layout Flicker**: Fixed a bug where `submitWithKeys` in `full_cdp_script.js` and `auto-continue.ts` would continuously dispatch un-guarded 'Enter' key events to the global `window` object even if the Chat Input text area was completely unfocused. This prevented VS Code's native keyboard interceptors from toggling 'Customize Layout' dialogs constantly during automated cycles.

## [5.2.55] - 2026-02-22
### Added
- **Embedded Remote Control**: Promoted the AntiBridge legacy standalone server into a native VS Code core module (`src/modules/remote/server.ts`). Users can now control Antigravity from their phone's browser or any WebSocket client on port 8000 directly from the IDE's Extension Host, without needing to run separate Node scripts.

## [5.2.54] - 2026-02-21
### Added
- **Dynamic MCP Transport Tools**: The HTTP MCP Server now dynamically exposes `vscode.commands` starting with `antigravity.*` as executing tools over the `/rpc` endpoint, replacing the hardcoded project tracker scaffolds and completing the P1 Real Transport objective.

## [5.2.53] - 2026-02-21
### Fixed
- **Phantom Clicks / Layout Flicker**: Rigidly enforced DOM `.focus()` acquisition checks before emitting simulated `KeyboardEvent` keystrokes. This prevents rapid auto-submit loops from discharging unprotected "Enter" or "Space" keys into the workbench chrome, which natively intercepts them as window/layout command toggles.

## [5.2.52] - 2026-02-21
### Fixed
- **Phantom Clicks / Layout Flicker**: Diagnosed the root cause of the "Customize Layout" dialog flickering. Confirmed via CDP spy that DOM event overrides were not to blame. The phantom toggle is triggered by a combination of loose element focus catching stray keystrokes or `vscode.commands.executeCommand` invocations (e.g., Space/Enter mapping to workbench toggles). 
### Added
- **Global Project Sync**: Unified all agent instructions into `docs/LLM_INSTRUCTIONS.md` and updated `HANDOFF.md`, `DASHBOARD.md`, and `MEMORY.md` to reflect the "Gold Standard" project state.

## [5.2.51] - 2026-02-20
### Fixed
- **CDP Handler**: Fully removed all implicit hardcoded fallbacks to port \`9000\` when scanning or displaying connection strings. 
- **Settings**: The default `cdpPort` configuration value in `package.json` is now **9333**, which aligns with Chrome's standard debugger convention.

## [5.2.23] - 2026-02-20
### Fixed
- **CDP Handler**: Removed all hardcoded fallback ports (9222/9333). The extension will now strictly use and only connect to the CDP Port defined in the dashboard settings, preventing connection anomalies and port collisions.
- **Dashboard UI**: Updated tooltips to clearly reflect that the user's explicit setting is required rather than relying on assumed defaults like 9333.

## [5.2.22] - 2026-02-20

## [5.2.20]
- Fixed issue where all open VS Code windows could become permanently stuck as "FOLLOWER" after a window reload, caused by Windows `EPERM` errors during `fs.renameSync` preventing the Controller Lease file from ever being updated. The lease election system now gracefully falls back to `fs.writeFileSync`.
- Added manual `Antigravity: Force Acquire Leader Role` command to arbitrarily usurp control if the autonomous controller lease ever gets confused.

## [5.2.19]
- Fixed issue where backend "Blind Bump" fallback was running concurrently with the frontend Auto-Continue script, causing duplicate text injection and conflicts.
- Reduced noise and added an exponential backoff to the continuous CDP reconnect attempts in background windows.

## [5.2.18]
- Fixed issue where "Accept All" and "Expand" signals were ignored if they were implemented as generic buttons with purely inner text (instead of `title` or `aria-label`).
- Fixed issue where "Good/Bad" feedback requests caused the AI to hang; it now properly parses text-based feedback buttons and immediately automatically types a Smart Resume bump to bypass it.
- Force compiled the extension before VSCE packaging to resolve the 5.2.16 staleness issue.

## [5.2.17]
- Fix compilation issue: the previous version 5.2.16 released an uncompiled distribution. Repackaging with the fix to `InteractionMethodRegistry` parallel execution.

## [5.2.16]
- Fixed issue where the backend fallback Interaction Mechanism (BlindBumpHandler) would spam "Proceed" multiple times in parallel when "Aggressive" preset or parallel execution mode was enabled.
- Hardcoded InteractionMethodRegistry to enforce strictly sequential execution for all non-click actions like text input to prevent duplicate chat bumps.
- Modified retry count to stop after 1 success for text injection.

## [5.2.14] - 2026-02-20
- **Fixed:** Bulletproofed the "Proceed" check logic by recursively scanning the parent form or container for matching text nodes, ensuring that React `contenteditable` divs cannot falsely report empty states if the text has visibly rendered.
- **Improved:** Form submission simulation now fires `composed: true` for shadow DOM penetration and executes a broader `requestSubmit` fallback. 

## [5.2.13] - 2026-02-20
- **Fixed:** Runaway "Proceed" bug correctly squashed by avoiding text overrides from adjacent `.view-lines` elements, and detecting text inside `contenteditable` React `<divs>`.
- **Improved:** Increased reliability of React form submission defaults by requesting native form submission where available, and injecting `keypress` alongside standard enter keys.

## [5.2.12] - 2026-02-20
ProceedProceedProceedProceedProceedProceedProceedProceedProceedProceedProceedProceed- **Fixed:** Resolved the "ProceedProceedProceed" bug where Monaco editor `.view-lines` text content was not accurately evaluated, causing runaway typing loops without submission.
- **Improved:** `tryClick` correctly resolves `closest('button, a')` before evaluating disabled states, ensuring `.codicon-send` span clicks are no longer artificially swallowed by disabled parent buttons.
- **Improved:** Broadened `sendSelectors` to match "Send (Enter)" variations and standard `button[type="submit"]`.
- **Improved:** Added `keyup` dispatch to Enter key submission fallback to bypass strict React event listeners.

## [5.2.11] - 2026-02-20
- **Configuration Change**: Changed the default "Bump" and "Auto-Reply" text from "continue" to "Proceed" across all profiles and dashboards.
- **Bug Fix**: Migrated deprecated `.vscode/settings.json` keys to modern `actions.bump.text` structure.

## [5.2.10] - 2026-02-20
- **Decoupling Fix**: Decoupled UI automation (cliking Run, Continue, Accept) from the Model and Leader/Follower lease logic. UI actions will now run immediately in every window even if the model is unreachable or another window is leading.
- **Reliability Enhancement**: Added a visibility-state guard to the browser script to ensure thread-bumping only occurs in the active window.

## [5.2.9] - 2026-02-20
- **Reliability Fix**: Repaired a configuration injection bug in `cdp-handler.ts` where uninstantiated array defaults (`config.get('...')`) evaluated to `[]` instead of `undefined`, disabling detection features like `not-generating` and `action-cooldown` globally.
- **Reliability Fix**: Enhanced `auto-continue.ts` DOM heuristics to natively recognize Antigravity's chat UI elements, including AI vs User sender detection, the `.run-action` button, and generic `button[type="submit"]` selectors.

## [5.2.8] - 2026-02-19
- **Model Support**: Corrected latest model lists to feature Claude Opus 4.6, Claude Sonnet 4.6, and Gemini 3.1 Pro High instead of the older targets.


## [5.2.7] - 2026-02-19
- **Bug Fix**: Fixed a Multi-Window Lifecycle bug where a quick window reload caused a 15-second stale lease window, leaving all extensions operating defensively in `FOLLOWER` mode. Leases are now instantly dropped when the governing Extension Host process ID (`pid`) dies.
- **UI Enhancement**: Modified the Dashboard "Bump Text" field to include a `datalist` dropdown with default suggestions (such as "Proceed").
- **Model Support**: Updated model selection lists to natively feature the latest Claude 3.7 Sonnet, Claude 3 Opus, Gemini 2.5 Pro, and Gemini 2.5 Flash targets.

## [5.2.6] - 2026-02-19
- **Bug Fix**: Fixed an issue where follower window Autopilot instances were not receiving the correct `bumpMessage` configuration.
- **Reliability Fix**: Expanded the `isAcceptButton` text heuristics in `AUTO_CONTINUE_SCRIPT` to accurately detect and execute "1 Step Requires Input", "Expand <", and "Run" buttons that lack native title tooltips.
- **Bug Fix**: Replaced incomplete JS KeyboardEvent Dispatch for Enter key (which failed to clear Chat Input focus) with actual CDP Key Events via Bridge execution.

## [5.2.5] - 2026-02-19
- **Bug Fix**: Replaced `requestAnimationFrame` with `setTimeout` inside element tracking loops (`waitForDisappear`, etc.). Chromium pauses `rAF` rendering pipelines entirely when OS windows are minimized or fully backgrounded, which was causing the Follower automation loops to hang indefinitely. Followers will now reliably discover and click elements regardless of window focus state.
- **Bug Fix**: Removed unintended `sendCommandToExtension` prefixing inside keyboard submit fallback which prevented `submit|keys` events from reaching the CDP layer.

## [5.2.4] - 2026-02-19
- **Release/Build Optimization**: Version bump and sync build for latest multi-window target resolution changes.

## [5.2.3] - 2026-02-19
- **Release**: Patch version bump to `5.2.3`.
- **Version Sync**: Updated `package.json`, `src/utils/constants.ts`, and `main_scripts/full_cdp_script.js` runtime toast metadata.
- **Safety Fix**: Hardened automation interaction targeting to ignore panel/workbench chrome controls (`tab`/header/action regions), preventing repeated click loops on UI panel buttons.
- **Selector Guard**: Tightened broad `run` matching to command-specific patterns (`run in terminal` / command-run labels) to reduce false-positive clicks outside chat action surfaces.
- **Test Coverage**: Added `tests/panel-click-guard.test.js` and wired it into `npm run test:quality-gates` to prevent panel/chrome click-loop regressions.
- **Audit Policy**: Added explicit effective high/critical evaluation with a narrow dev-tooling allowlist in `scripts/audit-policy.js` so unresolved upstream advisories in packaging/lint toolchains do not block secure release, while non-allowlisted high/critical findings still fail the gate.

## [5.2.3] - 2026-02-19
- **Fix: Multi-Window Target Resolution**: `CDPStrategy` no longer aggressively filters CDP connections by `vscode.workspace.name`. The active Leader window will now successfully orchestrate chat actions (Expand, Run, Accept All) across all Follower instances connected to the same VS Code CDP debugging port.
- **Fix: CDP Enter Key Dispatch**: Repaired a bridge logic gap where `submitWithKeys` fired an audio feedback event but failed to dispatch the physical Enter keystrokes over CDP. The Leader window will now correctly submit generated bump/continue messages.
- **Feature Check**: `multiTabEnabled` configuration is now defaulted to `true` to empower single-process multi-window orchestration.

## [5.2.2] - 2026-02-19
- **Reliability Fix: CDP Port Discovery Fallbacks**: `scanForInstances()` now prioritizes the configured `antigravity.cdpPort` range and also checks well-known CDP fallbacks (`9222`, `9000`) when needed.
- **Resilience**: Prevents false “CDP unavailable” states when host/editor runtime exposes CDP on a common port different from current user config.
- **Multi-Window Coordination**: Added a cross-window controller lease so only one extension host window actively runs CDP/autonomy modules while other windows enter passive follower mode.
- **Operator UX**: Status menu now shows explicit controller role (`LEADER`/`FOLLOWER`) and includes `Antigravity: Show Controller Lease State` diagnostics command.
- **Test Coverage**: Added `tests/controller-lease.test.js` to validate acquisition, follower blocking, stale takeover, and owner-only release cleanup.
- **Version Sync**: Updated runtime metadata strings to `5.2.2` across extension constants and injected CDP script activation toast.

## [5.2.1] - 2026-02-19
- **Release**: Version bump to `5.2.1` with synchronized manifest/runtime version metadata.

## [5.2.0] - 2026-02-19
- **Release**: Version bump and packaging target for `5.2.0`.
- **Fix**: Restored reliable dashboard/settings navigation by removing a stray activation-breaking token in `src/extension.ts`.
- **Hotfix**: Prevented VS Code bump flow from opening a new chat thread by defaulting hybrid bump `openChat` to opt-in only.
- **Hotfix**: Stopped unintended VS Code page/thread hopping by skipping tab-rotation logic in `vscode` runtime mode.
- **UX**: Added unified settings entrypoints across hosts:
    - New command `Antigravity: Open Extension Settings (Native)`
    - Added status-menu and dashboard button shortcuts to open native extension settings
    - Added dedicated keybindings for dashboard and native settings access
- **Compat**: Added explicit command activation events for dashboard/settings commands to improve host startup behavior.
- **Diagnostics**: Added `Antigravity: Settings Surfaces Health Check` command with status-menu + dashboard access; exports a JSON report validating dashboard/native settings entrypoints and required command availability.

## [5.0.18] - 2026-02-19
- **Fix**: Wrapped all 43 native VS Code command registrations in a `safeRegisterCommand` try-catch block. This prevents the Extension Host from fatal-crashing when activated in multiple Cursor IDE windows sharing the same process.

## [5.0.17] - 2026-02-19
- **Fix**: Removed duplicate registrations of `antigravity.clickAccept`, `clickRun`, and `clickExpand` that caused the extension to fatal-crash on IDE restarts due to leaked context subscriptions. Consolidated their execution paths into a unified fallback model.

## [5.0.16] - 2026-02-19
- **Diagnostics**: Wrapped entire extension activation in a fatal try-catch block to write IDE crash dumps directly to `~/antigravity-activation.log`.

## [5.0.15] - 2026-02-19
- **Release**: Forced clean rebuild and version bump to 5.0.15 to resolve client caching issues.

## [5.0.14] - 2026-02-19
- **Audio**: Implemented robust audio configuration (`antigravity.audio.*`) with master volume and per-action toggles.
- **Reliability**: Implemented MCP dialog evasion and enhanced selector coverage for Run/Expand buttons.
- **Commands**: Added `antigravity.resetConnection` for full strategy restart.
- **Logging**: Enhanced browser-side logging via `__ANTIGRAVITY_LOG__` bridge.

## [5.0.12] - 2026-02-19
- **Release**: Version synchronization across manifest/constants with routine patch bump.

## [5.0.11] - 2026-02-19
- **Maximum Mode**: Added one-click `Enable Maximum Autopilot` command and dashboard control to activate CDP + injected automation + run/expand/accept/continue/submit/bump with debug telemetry.
- **Reliability**: Auto-continue timing now tracks per-control cooldown windows (run/expand/accept/continue/submit/etc.) so configured delays are honored more predictably.
- **Diagnostics**: Added rich action/detection logging from injected automation to `Antigravity Debug`, plus action-group events for troubleshooting missed clicks.
- **Audio**: Added configurable per-action sound routing (`soundEffectsPerActionEnabled`, `soundEffectsActionMap`) for distinct audible feedback by action group.
- **Dashboard**: Fixed method test button wiring, added runtime button-signal visibility, expanded timing/debug controls, and synchronized unified poll controls to `automation.timing.pollIntervalMs`.
- **Stability**: Set `experimental.cdpExplicitDiscovery` default to `false` to reduce intermittent post-restart blank chat panel behavior.


## [5.0.10] - 2026-02-19
- **Dashboard**: Added missing grouped action checkboxes for `Allow-All` (Accept All group) and `Alt+Enter` fallback toggles in both Run and Expand groups.
- **Config Sync**: Aligned injected runtime bump detect defaults with schema to include `skip-ai-question` consistently across script and CDP config injection.
- **UX**: Clarified module label to `Autonomous Mode (Yoke)` for easier mode mapping.


## [5.0.9] - 2026-02-19
- **Hotfix**: Improved auto-bump submission reliability by requiring real composer-state change after submit attempts instead of treating key dispatch as implicit success.
- **Fix**: If Send click / Enter variants do not actually submit, runtime now escalates to bridge-driven hybrid bump submission path.

## [5.0.8] - 2026-02-19
- **Hotfix**: Added blocked-term tab filtering to `antigravityLoop` tab rotation path to prevent switching into Extensions/Marketplace/plugin surfaces.
- **Stability**: Reduced risk of unintended extension-install page activation caused by broad `button.grow` tab cycling.

## [5.0.7] - 2026-02-19
- **Hotfix**: Added strict unsafe-surface guards in injected auto-continue loop to avoid interacting with Extensions/Marketplace/Install UI regions.
- **Safety**: Added bridge command blocking for extension/marketplace/install-like command IDs to prevent accidental extension-install page navigation.

## [5.0.6] - 2026-02-19
- **UX**: Expanded detailed dashboard tooltips across control groups (Bump, Accept, Accept All/Keep, Continue/Keep, Feedback, Run, Expand, Submit) for clearer operator guidance.
- **Behavior**: Treats VS Code `Keep` as equivalent to `Accept All` in runtime automation and configuration defaults.
- **Release**: Version synchronization across manifest/constants with fresh VSIX build.

## [5.0.5] - 2026-02-18
- **Hotfix**: Hardened automation safety filters to avoid interacting with Extensions/Marketplace/MCP plugin-management surfaces.
- **Fix**: Reduced UI thrashing by restricting tab-rotation logic to chat-session targets and excluding marketplace/plugin-like tabs.
- **Fix**: Prevented duplicate bump text insertion fallback that could leave typed bump messages unsent.
- **Added**: New emergency command `antigravity.panicStop` + shortcut (`Ctrl+Alt+Shift+Backspace`) to immediately disable all autonomy systems.

## [5.0.4] - 2026-02-18
- **Architecture**: Removed all git submodules and reference implementations to simplify the codebase.
- **Cleanup**: Updated documentation and removed `SUBMODULES.md`.

## [5.0.3] - 2026-02-18
- **Fixed**: Dashboard "Test" buttons now correctly invoke the backend `antigravity.testMethod` command.
- **Fixed**: Registered missing `antigravity.testMethod` in `package.json`.
- **Refined**: Improved interactions method testing logic in `CDPStrategy`.

## [5.0.2] - 2026-02-19
- **Maximum Autopilot**: Enabled "Auto Feedback" (Good/Bad) and "Accept All" logic in the main automation loop.
- **Dashboard**: Added "Auto Feedback" toggle to the Browser Automation card.
- **Fix**: Resolved issue where "Accept All" button was detected but not clicked.

## [5.0.1] - 2026-02-19
- **Fix**: Resolved critical compilation errors in `InteractionMethodRegistry`.
- **Diagnostics Matrix**: Implemented comprehensive UI element detection (Accept, Run, Expand, Feedback) in `full_cdp_script.js` for "Button Detection" dashboard feature.
- **Reliability**: Enhanced element broadcasting for the diagnostics heartbeat.

## [5.0.0] - 2026-02-18
- **Major Release**: "Gold Standard" Stability achieved.
- **Continuous Mode**: Native support for continuous task execution (formerly 4.10.115).
- **Unified Automation**: Full support for Auto-Run, Auto-Accept, Auto-Expand, Auto-Submit, and Auto-Feedback across VS Code, Cursor, and Antigravity screens.
- **Reliability**: Implemented Smart Target Filtering (multi-window fix), Selector Hardening (no QuickPick interference), and Keypress Fallbacks (for stubborn buttons).
- **Configuration**: Exposed granular timing, throttling, and action toggles.



## [4.10.112] - 2026-02-18
- **Feedback Automation**: Added support for auto-clicking "Helpful" / "Thumbs Up" buttons (configurable via `antigravity.automation.actions.clickFeedback`).
- **Dynamic Mode**: Fixed an issue where the `vscode` profile might be ignored in favor of `antigravity` defaults in some loops.

## [4.10.111] - 2026-02-18
- **Stuck Button Fallback**: Implemented "Keypress Fallback" (Enter, Alt+Enter, Space) for buttons that fail to disappear after clicking (e.g., specific "Run" actions).
- **UX**: Automation now mimics keyboard interaction for higher compatibility.

## [4.10.110] - 2026-02-18
- **Expanded Automation**: Now automatically clicks "1 Step Requires Input" (bell icon) and "Expand <" buttons to reveal hidden "Run" actions.
- **Safety**: Selector exclusions (Command Palette) remain in force.

## [4.10.109] - 2026-02-18
- **Hardened Selectors**: Explicitly excluded Quick Pick, Command Palette, and Settings Editor from automation targets to prevent accidental interaction.
- **Enhanced Self-Test**: Verification report now respects exclusion rules.

## [4.10.108] - 2026-02-18
- **Smart Target Filtering**: Resolved multi-window automation collisions by filtering CDP targets based on the VS Code Workspace Name.
- **Diagnostics Fix**: Fixed `Antigravity: Diagnose CDP` command to report the correct active connection state.
- **Refactor**: Unified `CDPStrategy` and `diagnoseCdp` to use the shared `SharedCDPClient`.
- **Selector Hardening**: Added explicit support for "Allow" and "Accept All" buttons to ensure 100% detection reliability.

## [4.10.107] - 2026-02-18
### Added
- **Multi-Tab Orchestration**: Added `multiTabEnabled` setting and dashboard visibility for active CDP sessions.
- **Dashboard**: Added "Active CDP Sessions" card to monitor browser connections.

## [4.10.106] - 2026-02-18
### Changed
- **Dashboard Polish**: Added extremely detailed tooltips to all configuration settings to explain their function and impact.

## [4.10.105] - 2026-02-18
### Added
- **Voice Control**: Added microphone button to Dashboard.
    - **Commands**: "Approve" (Accept Changes), "Bump" (Continue), "Pause/Resume".
    - **Feedback**: Visual listening state and transcript feedback in Dashboard.

## [4.10.104] - 2026-02-18
### Added
- **Smart Resume**: The automation script now analyzes chat context.
    - **Smart Wait**: Pauses auto-reply if the AI ends with a question (?).
    - **Fast Retry**: Bumps quickly (3s) if the user spoke but the AI stalled.
    - **Network Recovery**: Detects "network error" text and auto-retries.

## [4.10.103] - 2026-02-18
### Added
- **Dashboard Controls**: Added a dedicated "Browser Automation" card to the dashboard with checkboxes for all granular settings (Run, Expand, Accept, Auto-Reply, etc.) and timing controls.
- **Unified Config**: Dashboard toggles now directly update the `antigravity.automation.*` settings used by the injected script.

## [4.10.102] - 2026-02-18
### Changed
- **Aggressive Automation**: Reduced default poll interval to 800ms.
- **Improved Selectors**: Added support for generic `.codicon-play` (Run) and `.codicon-chevron-right` (Expand) to catch more button variations.
- **Selector Precision**: Switched to a unified `tryClick` utility that aggressively finds visible interactive elements.

## [4.10.101] - 2026-02-18
### Changed
- **Auto-Reply Default**: Enabled `autoReply` by default (true).
- **Auto-Reply Delay**: Reduced default delay from 10s to 7s for faster response.
- **Auto-Reply Logic**: Improved text insertion simulation (fallback to `value` setter + dispatch events) and added 'Enter' key fallback if 'Send' button click fails.

## [4.10.100] - 2026-02-18
### Added
- **Auto-Reply (Bump)**: New feature to automatically keep the conversation going.
    - `antigravity.automation.actions.autoReply`: Enable auto-typing a message when idle (default: false).
    - `antigravity.automation.actions.autoReplyText`: Custom text to type (default: "continue").
    - `antigravity.automation.timing.autoReplyDelayMs`: Time to wait before bumping (default: 10000ms).

## [4.10.99] - 2026-02-18
### Added
- **Visual Debugging**: Added `antigravity.automation.debug.highlightClicks` to flash a red border on auto-clicked elements.
- **Timing Randomness**: Added `antigravity.automation.timing.randomness` to add human-like jitter to interaction delays.
- **Auto-Scroll**: Added `antigravity.automation.actions.autoScroll` to keep chat view fresh.
- **Accept All**: Added specific support for "Accept All" buttons via `antigravity.automation.actions.clickAcceptAll`.

## [4.10.98] - 2026-02-18
### Added
- **Detailed Automation Settings**: Expanded `antigravity.automation.actions` with detailed descriptions for Run, Expand, Accept, Continue, Submit, and new `clickFeedback` toggle.
- **Timing Configuration**: Added `antigravity.automation.timing` settings (`pollIntervalMs`, `actionThrottleMs`, `cooldownMs`) for fine-grained performance tuning.

## [4.10.97] - 2026-02-18
### Added
- **Granular Automation Settings**: Added configurable toggles for `clickRun`, `clickExpand`, `clickAccept`, `clickContinue`, and `clickSubmit` in `antigravity.automation.actions.*`.
- **Script Configuration Injection**: `CDPHandler` now injects user preferences directly into the automation script context.

## [4.10.96] - 2026-02-18
### Fixed
- **Stability**: Removed `MutationObserver` and `userGesture` injection from `auto-continue` script to prevent chat panel blanking and improve performance.
- **Auto-Interaction**: Refined `auto-continue.ts` to use safer polling (~1.5s) for Continue, Keep, Run, Accept, and Expand actions.

## [4.10.95] - 2026-02-18
### Changed
- **Enhanced Auto-Continue**: `auto-continue.ts` now aggressively auto-clicks "Run in Terminal", "Expand", "Accept"/"Apply", and "Send" buttons to reduce manual toil.

## [4.10.94] - 2026-02-17
### Added
- **Copilot Auto-Continue**: Integrated `copilot-auto-continue` submodule logic to automatically click "Continue" and "Keep" buttons in Copilot Chat via CDP injection.
- **Configurable Auto-Continue**: Added `antigravity.autoContinueScriptEnabled` setting (default: `true`) to control script injection.

## [4.10.94]
- **Fix**: Intermittent blank screen issue via defensive CDP attachment strategy (try-catch + stabilization delay).
- **Feat**: Added `antigravity.experimental.cdpExplicitDiscovery` (default: true) to gate explicit attachment logic.
- **Feat**: Implemented "Bump on Completion" to ensure thread restart even after task success.
- **Refactor**: Configuration migrated to `antigravity.actions.*` schema.

## [4.10.93]
- Improved: Re-enabled explicit CDP target discovery to ensure automation works for existing chat panels.
- Fixed: Maintained fix for blank side panel by keeping aggressive target discovery (Phase 38) disabled by default.

## [4.10.92]
- Fixed: Side chat panel blank screen issue by disabling aggressive CDP target discovery by default.
- Added: `antigravity.experimental.cdpAggressiveDiscovery` configuration to opt-in to advanced target attachment.

## [4.10.91] - 2026-02-17
### Fixed
- **Dashboard**: Fixed a regression where the settings page failed to open if certain configuration arrays (e.g., `bannedCommands`, interaction methods) were null or undefined in `settings.json`.

## [4.10.90] - 2026-02-17

### Changed
- **Configuration Logic**: `CDPHandler` now respects granular timing controls (`actions.bump.typingDelayMs`, `actions.bump.submitDelayMs`) for hybrid bump interactions, replacing hardcoded delays.
- **Configuration Schema**: Updated `package.json` and `config.ts` to support the new `antigravity.actions.*` structure for bump, auto-accept, run, and expand actions.

## [4.10.89] - 2026-02-17
### Fixed
- **Interaction Logic:** `DOMScanClick` strategy now correctly identifies and clicks icon-only "Run" and "Expand" buttons (e.g. `.codicon-play`, `.monaco-tl-twistie`) that lack text labels.
- **Completion Detection:** Strengthened `ExitDetector` logic to handle negation, future tense, and checklists without false positives.

## [4.10.88] - 2026-02-17

### Changed
- **Release Packaging**: Maintenance release to validate unified release pipeline and ensure clean VSIX generation.

## [4.10.87] - 2026-02-17

### Added
- **Unified Control Compatibility Tests**: Added `tests/config-unified-controls.test.js` to validate grouped autopilot toggle fallback behavior and unified timing fallback semantics in `ConfigManager`.

### Changed
- **Release Metadata Sync**: Updated `package.json` and `src/utils/constants.ts` to `4.10.87`.

## [4.10.86] - 2026-02-17

### Changed
- **Unified Controls Documentation Sync**: Updated `README.md` quick-start and configuration highlights to reference grouped autopilot toggles (`Auto Accept`, `Auto Bump`, `Run/Expand/Continue`) and unified timing settings.
- **Dashboard Snapshot Metadata Refresh**: Updated `DASHBOARD.md` build/version metadata and runtime UX notes to reflect the unified top-level control surface.

## [4.10.85] - 2026-02-17

### Added
- **Unified Autopilot Control Group**: Introduced top-level grouped controls for `Auto Accept`, `Auto Bump`, and `Run/Expand/Continue` behaviors.
- **Unified Timing Controls**: Added explicit `autoAcceptPollIntervalMs` and `autoBumpCooldownSec` settings with dashboard wiring and legacy fallback synchronization.

### Changed
- **Runtime Control Wiring**: `CDPStrategy` now honors unified grouped toggles for auto-accept flow, run/expand/continue click gating, and bump handler activation.
- **Timing Behavior Reliability**: Auto-accept polling now uses unified poll interval, and blind-bump cadence now uses unified bump cooldown (with legacy fallback).
- **Dashboard Simplification**: Consolidated top-level autopilot controls into logical grouped toggles while preserving advanced settings for deeper tuning.

## [4.10.84] - 2026-02-17

### Added
- **Completion Detection Soak Harness**: Added `tests/completion-detection-soak.test.js` to replay deterministic response sequences and assert zero false-complete stops across a mixed scenario corpus.
- **Soak Runner Script**: Added `npm run test:soak:completion` for quick repeatable validation of completion/loop-stop behavior.

### Changed
- **P1.5 Validation Track**: Backlog now explicitly tracks deterministic soak coverage as complete, leaving manual in-product soak verification as the final P1.5 step.

## [4.10.83] - 2026-02-17

### Added
- **Adaptive Test-Loop Calibration**: `src/core/test-loop-detector.ts` now calibrates effective exit thresholds from rolling historical loop signals (test-only dominance lowers threshold; mixed feature-work history raises it).
- **Calibration Telemetry Surface**: Detector checks and status now expose `calibratedThreshold` for clearer operator/debug visibility.

### Changed
- **P1.5 Progress**: Completion-detection pipeline now includes response-signal hardening, stop-cause telemetry, and adaptive threshold calibration; remaining scope is manual soak verification.
- **Detector Test Coverage**: `tests/test-loop-detector.test.js` now covers threshold up/down calibration behavior and threshold metadata assertions.

## [4.10.82] - 2026-02-17

### Added
- **Completion Stop Telemetry**: Autonomous loop now logs structured stop-cause payloads for both exit-detector and test-loop-detector paths, including confidence/reason details.

### Changed
- **Exit Detection Hardening (P1.5 progress)**: `src/core/exit-detector.ts` now evaluates richer response-state signals (completion vs active-work vs uncertainty) with confidence scoring to reduce premature complete exits.
- **Exit Detector Test Coverage**: `tests/exit-detector.test.js` now validates confidence metadata and guards against false-positive completion when active work is still present.
- **Backlog Sync**: Updated `TODO.md` + `task.md` to reflect partial P1.5 completion and remaining threshold calibration work.

## [4.10.81] - 2026-02-17

### Changed
- **Internal Command Policy Documentation (P0.4 complete)**: Documented `antigravity.getChromeDevtoolsMcpUrl` as intentionally internal-only in `README.md`.
- **README Status Synchronization**: Updated root README version and implementation-status note to match current MCP runtime/federation reality.
- **Backlog Tracker Sync**: Updated `TODO.md` and `task.md` to reflect completed P0.4 command-policy documentation state.

## [4.10.80] - 2026-02-17

### Added
- **Federation Auth/Header Coverage**: Added `tests/mcp-federation.test.js` assertions validating outbound HTTP RPC requests include configured custom headers and auth credentials.

### Changed
- **MCP Federation Remote Auth Support (P0.2 complete)**: `src/modules/mcp/federation.ts` now supports per-server outbound auth/header configuration for both HTTP and WebSocket transports.
- **Header Builder for Remote Endpoints**: Added normalization for `bearer`, `basic`, `token`, and API-key style auth injection with optional custom header names.

### Notes
- Remaining P0.2 scope is now limited to intentional stdio transport deferral; remote auth/header support is implemented.

## [4.10.79] - 2026-02-17

### Added
- **Voice Transcript Debug Command**: Added `antigravity.processVoiceTranscript` for manual transcript replay and runtime intent execution diagnostics.
- **Runtime Auto-Resume Soak Harness**: Added deterministic replay coverage in `tests/runtime-auto-resume-soak.test.js` for guard scoring, strict-mode gating, and escalation cooldown/threshold anti-spam checks.
- **Project Manager Integration Tests**: Added `tests/project-manager.test.js` coverage for GitHub + Jira pagination, rate-limit handling, and snapshot persistence semantics.

### Changed
- **Voice Control Bridge (P2.3 complete)**: `src/modules/voice/control.ts` now supports parser-to-runtime execution via `setIntentExecutor(...)`, execution outcome telemetry, command counts, and force-mode transcript processing for debug workflows.
- **Destructive Voice Safety Gate**: `src/extension.ts` now requires explicit confirmation for destructive voice intents before executing mapped runtime actions.
- **Project Manager Hardening (P2.4 complete)**: `src/providers/project-manager.ts` now implements robust GitHub and Jira issue sync with pagination, rate-limit metadata capture, and persisted sync snapshots at `.yoke/project-manager-sync.json`.
- **Runtime Guard Extraction (P3.3 complete)**: Auto-resume guard/escalation decisions now use pure helper logic in `src/core/runtime-auto-resume-guard.ts`, improving deterministic testing and reducing inline state-machine complexity.

### Notes
- P2.3, P2.4, P3.1 (root scope), and P3.3 are now tracked as completed in `TODO.md` / `task.md`.

## [4.10.78] - 2026-02-17

### Added
- **Shared Backoff Utility**: Added `src/core/backoff.ts` with exported `calculateAdaptiveBackoff(...)` for deterministic adaptive interval calculation.

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/backoff-logic.test.js` with source-backed coverage against `src/core/backoff.ts`.
- **Autonomous Loop Backoff Reuse**: `src/core/autonomous-loop.ts` now delegates adaptive interval math to the shared backoff utility.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.77] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/voice-control.test.js` with real-module coverage against `src/modules/voice/control.ts` using TypeScript-on-the-fly source loading.
- **Voice Parser Parity Hardening**: Real parser assertions now validate production command pattern behavior (including model-switch extraction and unknown-intent fallback) instead of duplicated test-only regex logic.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.76] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/test-loop-detector.test.js` with real-module coverage against `src/core/test-loop-detector.ts` using TypeScript-on-the-fly source loading.
- **Config-Aware Loop Exit Validation**: Added deterministic test-side configuration mocks for `maxConsecutiveTestLoops` so exit-threshold behavior is verified against production config lookup paths.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.75] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/progress-tracker.test.js` with real-module coverage against `src/core/progress-tracker.ts` using TypeScript-on-the-fly source loading.
- **Progress Tracker Harness Fidelity**: Added deterministic test-side mocks for `vscode.workspace` and `child_process.exec` so git-diff-backed file-change accounting and error-taxonomy logic are validated from production code paths.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.74] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/rate-limiter.test.js` with real-module coverage against `src/core/rate-limiter.ts` using TypeScript-on-the-fly source loading.
- **Rate Limiter Test Harness Stability**: Added deterministic test-side `vscode` configuration/output-channel mocks so real source logic can run in pure Node test sessions.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.73] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/exit-detector.test.js` with real-module coverage against `src/core/exit-detector.ts` using the TypeScript-on-the-fly source test harness.
- **Node Test Harness Compatibility**: Added a minimal test-side `vscode` module mock for source modules that rely on logger output channels, enabling pure Node execution without VS Code host runtime.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.72] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/circuit-breaker.test.js` with real-module coverage against `src/core/circuit-breaker.ts` using the TypeScript-on-the-fly source test harness.
- **Circuit Breaker Regression Confidence**: Updated threshold/open/half-open/reset assertions to validate true runtime behavior from the production module rather than duplicated test logic.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.71] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 progress)**: Replaced replica-style `tests/project-tracker-logic.test.js` with real-module coverage against `src/core/project-tracker.ts` using temporary fixture files and TypeScript-on-the-fly module loading.
- **Test Harness Reuse**: Extended test-side TS loader approach for source-module tests with `.ts` relative import resolution and lightweight dependency mocks.

### Notes
- P3.1 remains in progress; additional replica-style tests are still queued for migration.

## [4.10.70] - 2026-02-16

### Changed
- **Real-Module Test Modernization (P3.1 partial)**: Replaced replica-style `tests/task-analyzer.test.js` logic with execution against the real `src/core/task-analyzer.ts` module using an on-the-fly TypeScript transpile loader and lightweight dependency mocks.
- **TaskAnalyzer Test Harness Reliability**: Added robust relative `.ts` module resolution in test loader to avoid false failures from unresolved source imports.

### Notes
- P3.1 remains in progress; other replica-style tests are still queued for migration to real source-module coverage.

## [4.10.69] - 2026-02-16

### Changed
- **AST-Backed Test Extraction**: `src/core/test-generator.ts` now uses `vscode.executeDocumentSymbolProvider` for primary function/class discovery with regex fallback only when symbols are unavailable.
- **Metadata Recovery for Generated Tests**: Added function metadata parsing helpers for async/param extraction from symbol-discovered functions, improving generated edge-case coverage quality.
- **P2.2 Completion**: Closed remaining AST extraction gap for test generator hardening.

### Tests
- **Quality Guard Update**: Extended `tests/test-generator-quality-guards.test.js` to enforce AST-backed discovery path plus fallback guards.

## [4.10.68] - 2026-02-16

### Added
- **Test Generator Quality Guard Test**: Added `tests/test-generator-quality-guards.test.js` to prevent placeholder assertions and enforce merge-safe markers + deterministic mirrored output paths.

### Changed
- **Test Generator Assertion Quality**: Replaced placeholder `expect(true).toBe(true)` fallback with executable error-path assertion generation.
- **Generated Import Quality**: Test generation now builds concrete import lists from discovered functions/classes instead of emitting placeholder imports.
- **Merge-Safe Test Writes**: Existing test files now preserve non-generated content and update/append bounded generated blocks using markers.
- **Deterministic Test Paths**: Generated test files now mirror source-relative paths under the configured test directory to reduce collisions.

### Notes
- AST-based extraction remains pending in backlog item `P2.2`; current parser still uses regex-based discovery.

## [4.10.67] - 2026-02-16

### Added
- **Progress Metrics Guard Test**: Added `tests/progress-tracker-real-metrics.test.js` to prevent regression to placeholder hashes/counts and enforce taxonomy coverage fields.

### Changed
- **Real Progress Telemetry**: `src/core/progress-tracker.ts` now computes `filesChanged` from `git diff --name-only`, derives response length/hash from captured response text, and tracks structured error taxonomy (`transport`, `parse`, `timeout`, `policy`, `unknown`).
- **Autonomous Loop Error Classification**: `src/core/autonomous-loop.ts` now passes response text and classified loop error type into progress tracking for audit-quality session metrics.

## [4.10.66] - 2026-02-16

### Added
- **Model Scraper Reliability Guard Test**: Added `tests/model-scraper-reliability.test.js` to prevent non-deterministic async evaluate patterns and enforce bounded retry behavior.

### Changed
- **Deterministic Model Scraping**: Replaced asynchronous timer-injected extraction with synchronous DOM snapshot extraction and bounded retry polling in `src/core/model-scraper.ts`.
- **Retry Telemetry**: Added informational retry-success logging when model scraping recovers on subsequent attempts.

## [4.10.65] - 2026-02-16

### Added
- **Model Selection Compatibility Guard Test**: Added `tests/model-selection-compat.test.js` to protect canonical ID formatting, quick-route typo regression, and legacy ID alias support.

### Changed
- **Model ID Normalization**: Canonicalized Claude model IDs in `src/utils/constants.ts` to dotted `4.5` format to align with config defaults and dashboard values.
- **Model Selector Hardening**: `src/core/model-selector.ts` now routes by `taskAnalyzer` task type, normalizes legacy model ID aliases, and applies deterministic fallback preference order when configured models are unavailable.

## [4.10.64] - 2026-02-16

### Added
- **Command Parity Guard Test**: Added `tests/command-parity.test.js` to enforce manifest-handler parity while supporting an explicit internal-command allowlist.

### Changed
- **Command Discoverability Policy**: Added `antigravity.showStatusMenu` to contributed commands so it is discoverable and no longer an undocumented registered handler.
- **Internal Command Policy Annotation**: Documented internal-only command policy in `src/extension.ts` (currently `antigravity.getChromeDevtoolsMcpUrl`).

## [4.10.63] - 2026-02-16

### Changed
- **Task Source-of-Truth Hardening**: `ProjectTracker` now uses deterministic planner priority order: `task.md` → `TODO.md` → `@fix_plan.md` → `ROADMAP.md` for both next-task resolution and completion writes.
- **Planner Sync Alignment**: `ProjectManager` task sync now resolves planner files using the same canonical order and logs the actual source file used.
- **Status Messaging Clarity**: Updated project task sync command messaging to reflect canonical planner order instead of implying `@fix_plan.md` only.

## [4.10.62] - 2026-02-16

### Changed
- **Dashboard Config Parity Completion**: Added missing dashboard controls for `maxCallsPerHour`, `maxConsecutiveTestLoops`, and `interactionTimings`.
- **Safe Interaction Timing Input**: Added JSON parsing guard for `interactionTimings` updates to prevent invalid payload writes from the dashboard.

## [4.10.61] - 2026-02-16

### Changed
- **Autonomous Loop Status Accuracy**: Replaced placeholder loop status value with real circuit breaker state via `circuitBreaker.getState()`.
- **Circuit Breaker API**: Added `getState()` to expose current breaker status for runtime reporting.
- **DevTools MCP URL Command Hardening**: Replaced hardcoded dummy URL in `antigravity.getChromeDevtoolsMcpUrl` with runtime target discovery from scanned CDP instances and configured-port fallback.

## [4.10.60] - 2026-02-16

### Added
- **Real MCP HTTP Server Runtime**: `src/modules/mcp/server.ts` now starts a real Node HTTP server with JSON-RPC routing on `/rpc` and health endpoints (`/`, `/health`).
- **MCP Tool Introspection Endpoint**: Implemented `tools/list` support with schema metadata for built-in project-task tools.

### Changed
- **Simulation Removal (MCP Server)**: Replaced simulated startup/placeholder server lifecycle with real listen/close lifecycle and structured JSON-RPC errors.
- **Simulation Removal (MCP Federation)**: `src/modules/mcp/federation.ts` now performs real transport calls for `http` and `websocket` servers (including `tools/list` discovery and `tools/call` execution), with timeout and connection-state handling.

### Notes
- `stdio` federation transport remains intentionally unsupported in this in-process runtime and now reports explicit errors instead of silent simulation behavior.

## [4.10.59] - 2026-02-16

### Added
- **Reset Refresh Counters Command**: Added `Antigravity: Reset Status Refresh Counters` (`antigravity.resetStatusRefreshCounters`) to clear session-local refresh guard drop counters.

### Changed
- **Status Menu Ops Control**: Added `Reset Refresh Counters` action next to refresh settings/counter visibility for tighter test-loop measurement.

## [4.10.58] - 2026-02-16

### Changed
- **Refresh Guard Drop Counters**: Status menu now shows session-local drop counters for refresh guard skips (`total`, `in-flight`, `debounce`) to improve rapid-ops observability.
- **Debug Log Enrichment**: Refresh-guard skip logs now include current drop counter totals when debug logs are enabled.

## [4.10.57] - 2026-02-16

### Changed
- **Status Refresh Settings Visibility**: Added status menu info row showing active refresh debounce (`runtimeStatusMenuRefreshDebounceMs`) and refresh debug-logs state (`runtimeStatusMenuRefreshDebugLogs`).

## [4.10.56] - 2026-02-16

### Added
- **Status Refresh Guard Debug Logs**: Added `runtimeStatusMenuRefreshDebugLogs` toggle to emit detailed skip/run reasons for `Refresh Runtime + Reopen Status Menu` (in-flight/debounce paths).

### Changed
- **Dashboard Controls**: Added `Status Refresh Debug Logs` toggle in CDP & Automation settings.

## [4.10.55] - 2026-02-16

### Added
- **Configurable Status Refresh Debounce**: Added `runtimeStatusMenuRefreshDebounceMs` (default `800`) to tune debounce window for `Refresh Runtime + Reopen Status Menu`.

### Changed
- **Dashboard Control Surface**: Added `Status Refresh Debounce (ms)` setting in CDP & Automation section.

## [4.10.54] - 2026-02-16

### Changed
- **Refresh Action Debounce Guard**: `Refresh Runtime + Reopen Status Menu` now ignores overlapping/instant-repeat invocations (in-flight + short cooldown) to prevent runtime refresh flood loops.

## [4.10.53] - 2026-02-16

### Added
- **Rapid Status Recheck Action**: Added `Antigravity: Refresh Runtime + Reopen Status Menu` (`antigravity.refreshRuntimeAndReopenStatusMenu`) for quick stale/fresh reassessment loops.

### Changed
- **Status Menu UX**: Added one-click `Refresh Runtime + Reopen Status Menu` action at the top of status menu.

## [4.10.52] - 2026-02-16

### Changed
- **Status Menu Stale Warning**: Runtime header now shows a warning badge when telemetry age exceeds `runtimeTelemetryStaleSec`, including age and threshold context in the description.

## [4.10.51] - 2026-02-16

### Changed
- **Telemetry Freshness Explainability**: Added inline help text and tooltips in dashboard runtime card/settings to explain stale calculation (`telemetryAgeSec > runtimeTelemetryStaleSec`) and its dependency on runtime `timestamp`.

## [4.10.50] - 2026-02-16

### Added
- **Telemetry Freshness Indicator**: Dashboard runtime card now shows `Telemetry` (FRESH/STALE chip) and `Telemetry Age` for data recency at a glance.
- **Configurable Stale Threshold**: Added `runtimeTelemetryStaleSec` (default `12`) to tune when runtime telemetry is marked stale.

### Changed
- **Runtime Legend**: Added telemetry freshness chips to legend for quick interpretation.

## [4.10.49] - 2026-02-16

### Changed
- **Last Escalation Event Chip**: Dashboard runtime card now displays a color-coded chip for latest escalation event (`ARMED`, `SUPPRESSED`, `RESET`, `CONSUMED`) to accelerate triage.
- **Legend Enrichment**: Runtime legend now includes escalation event chip examples for instant interpretation.

## [4.10.48] - 2026-02-16

### Changed
- **Runtime Chip Legend**: Added compact legend row in dashboard runtime card for escalation/watchdog state chips (`ARMED`, `IDLE`, `RUNNING`) to improve operator readability.

## [4.10.47] - 2026-02-16

### Changed
- **Dashboard Watchdog State Chip**: Runtime card now renders watchdog run state as a visual chip (`RUNNING` blue / `IDLE` neutral) for quick operational scanning.

## [4.10.46] - 2026-02-16

### Changed
- **Dashboard Escalation State Chip**: Replaced plain escalation armed text with a colored status chip (`ARMED` amber / `IDLE` neutral) for faster runtime scanning.

## [4.10.45] - 2026-02-16

### Changed
- **Escalation Next-Eligible Timestamp**: Dashboard runtime card now shows `Escalation Next Eligible` alongside cooldown-left for exact unlock timing.
- **Telemetry + Summary Alignment**: Host telemetry now emits `escalationNextEligibleAt`, and compact escalation health summaries include next eligible time.

## [4.10.44] - 2026-02-16

### Changed
- **Dashboard Escalation ETA**: Runtime card now shows `Escalation Cooldown Left` using host telemetry (`escalationCooldownRemainingMs`) for clearer operator timing decisions.
- **Host Telemetry Enrichment**: Runtime state provider now publishes escalation cooldown total/remaining milliseconds for UI and diagnostics consumers.

## [4.10.43] - 2026-02-16

### Added
- **Escalation Health Summary Command**: Added `Antigravity: Copy Escalation Health Summary` (`antigravity.copyEscalationHealthSummary`) for compact one-line operator diagnostics.

### Changed
- **Status & Escalation Menus**: Added quick actions to copy escalation health summary directly from status menu and Escalation Controls submenu.
- **Dashboard Runtime Actions**: Added `Copy Escalation Health` button for quick sharing without full JSON payloads.

## [4.10.42] - 2026-02-16

### Changed
- **Status Escalation Health Line**: Status menu now shows a one-line escalation summary (`armed/idle`, failure streak, last watchdog outcome, cooldown remaining, and latest reason) with direct jump to Escalation Controls.

## [4.10.41] - 2026-02-16

### Added
- **Escalation Controls Submenu**: Added `Antigravity: Show Escalation Controls` (`antigravity.showEscalationMenu`) with grouped actions for diagnostics export, timeline clear (safe/no-prompt), payload export, and dashboard access.

### Changed
- **Status Menu Navigation**: Added `Escalation Controls` entry for cleaner operator UX with fewer clicks.

## [4.10.40] - 2026-02-16

### Changed
- **Status Menu Power Shortcut**: Added `Clear Escalation Timeline (No Prompt)` action in status menu for fast operator resets.

## [4.10.39] - 2026-02-16

### Added
- **Power-User No-Prompt Clear Command**: Added `Antigravity: Clear Escalation Timeline (No Prompt)` (`antigravity.clearEscalationTimelineNow`) for immediate timeline resets without confirmation dialogs.

### Changed
- **Clear Path Reuse**: Escalation timeline clearing now uses shared host logic so confirmed/no-prompt paths remain behaviorally consistent.

## [4.10.38] - 2026-02-16

### Added
- **Escalation Clear Confirmation Setting**: Added `runtimeEscalationClearRequireConfirm` (default `true`) to require a confirmation dialog before clearing escalation timeline data.

### Changed
- **Clear Command Safety**: `Antigravity: Clear Escalation Timeline` now prompts for confirmation when enabled, with optional bypass for power users via settings.
- **Dashboard Controls**: Added `Confirm Timeline Clear` toggle in CDP & Automation.

## [4.10.37] - 2026-02-16

### Added
- **Clear Escalation Timeline Command**: Added `Antigravity: Clear Escalation Timeline` (`antigravity.clearEscalationTimeline`) to reset in-memory escalation events/flags for clean diagnostics runs.

### Changed
- **Status Menu Control Surface**: Added quick action to clear escalation timeline directly from the status menu.
- **Dashboard Runtime Actions**: Added `Clear Escalation Timeline` button in runtime diagnostics controls.

## [4.10.36] - 2026-02-16

### Added
- **Escalation Timeline Capacity Setting**: Added `runtimeAutoFixWaitingEscalationMaxEvents` to configure how many recent escalation events are retained in telemetry/report exports.

### Changed
- **Runtime Event Buffering**: Watchdog escalation event buffer now uses configurable bounds (3–100) instead of fixed size.
- **Dashboard Controls**: Added `Escalation Max Events` setting in CDP & Automation.

## [4.10.35] - 2026-02-16

### Added
- **Focused Escalation Diagnostics Command**: Added `Antigravity: Copy Escalation Diagnostics Report` (`antigravity.copyEscalationDiagnosticsReport`) for one-click watchdog/escalation triage JSON export.

### Changed
- **Status Menu Shortcut**: Added quick action for escalation diagnostics export in the status menu.
- **Dashboard Runtime Actions**: Added `Copy Escalation Diagnostics` button next to existing runtime diagnostic controls.

## [4.10.34] - 2026-02-16

### Added
- **Escalation Event Timeline**: Host runtime now stores a bounded escalation event buffer (arm/suppress/reset/consume) for watchdog diagnostics.

### Changed
- **Dashboard Runtime Visibility**: Added `Escalation Events` live field in Runtime State card showing recent escalation timeline entries.
- **Resume Payload Report**: Escalation telemetry now includes recent timeline events for richer forensic export.

## [4.10.33] - 2026-02-16

### Changed
- **Resume Forensics Enrichment**: `Copy Last Resume Payload Report` now includes watchdog escalation telemetry (`consecutiveFailures`, `forceFullNext`, `lastTriggeredAt`, `reason`) for faster stuck-loop diagnosis.

## [4.10.32] - 2026-02-16

### Added
- **Escalation Backoff Control**: Added `runtimeAutoFixWaitingEscalationCooldownSec` to throttle re-arming of full-prompt escalation during persistent waiting noise.

### Changed
- **Escalation Arming Logic**: Watchdog escalation now respects cooldown windows before re-arming and records cooldown suppression reason in runtime telemetry.
- **Dashboard Settings Surface**: Added `Escalation Cooldown (s)` control in CDP & Automation section.

## [4.10.31] - 2026-02-16

### Added
- **Watchdog Escalation Policy**: Added `runtimeAutoFixWaitingEscalationEnabled` and `runtimeAutoFixWaitingEscalationThreshold` to arm a one-time full resume prompt after repeated watchdog non-recovery cycles.

### Changed
- **Auto-Resume Send Selection**: Automatic resume now forces a full prompt when escalation is armed, then resets escalation after successful send.
- **Escalation Telemetry**: Runtime host telemetry and dashboard runtime card now expose escalation armed state, consecutive failure streak, last escalation trigger time, and escalation reason.

## [4.10.30] - 2026-02-16

### Added
- **Waiting-State Watchdog Auto-Fix**: Added autonomous watchdog (`runtimeAutoFixWaitingEnabled`) that triggers safe readiness repair when waiting state persists.
- **Watchdog Controls**: Added `runtimeAutoFixWaitingDelaySec` and `runtimeAutoFixWaitingCooldownSec` to tune trigger timing and repeat intervals.

### Changed
- **Watchdog Telemetry Visibility**: Dashboard runtime card now shows watchdog state, last run timestamp, and last outcome.
- **Resilience Loop Hardening**: Waiting state can now self-heal via Auto-Fix before subsequent guard-checked resume attempts, reducing stuck Good/Bad idle loops.

## [4.10.29] - 2026-02-16

### Added
- **Last Resume Payload Report Command**: Added `Antigravity: Copy Last Resume Payload Report` (`antigravity.copyLastResumePayloadReport`) to generate/copy/open structured continuation telemetry.

### Changed
- **Forensic Visibility**: Status menu and dashboard runtime actions now provide one-click access to last resume payload details (kind/profile/preview/outcome/timing).

## [4.10.28] - 2026-02-16

### Added
- **Resume Message Audit Telemetry**: Runtime telemetry now tracks last sent continuation message kind (`full|minimal`), active profile source, and a safe preview snippet.

### Changed
- **Dashboard Runtime Audit Fields**: Added live visibility for last message kind/profile/preview so operators can verify exactly which nudge was sent during waiting-state continuation.

## [4.10.27] - 2026-02-16

### Added
- **Profile-Specific Continue Nudges**: Added `runtimeAutoResumeMinimalMessageVSCode`, `runtimeAutoResumeMinimalMessageAntigravity`, and `runtimeAutoResumeMinimalMessageCursor` for mode-aware continuation prompts.

### Changed
- **Adaptive Resume Selection**: Minimal continue mode now picks the active runtime profile message first, then falls back to global minimal/full resume messages.
- **Dashboard Controls**: Added dedicated textareas for per-profile minimal continuation messages.

## [4.10.26] - 2026-02-16

### Added
- **Adaptive Minimal Continue Mode**: Added `runtimeAutoResumeUseMinimalContinue` and `runtimeAutoResumeMinimalMessage` so waiting-state auto-resume can send concise continuation nudges tailored for Copilot Insiders.

### Changed
- **Resume Send Path Intelligence**: Auto/manual resume now select minimal vs full prompt based on `completionWaiting.readyToResume` to keep chats moving after Good/Bad completion states without overlong nudges.
- **Dashboard Control Surface**: Added new settings controls for minimal continue mode and message customization.

## [4.10.25] - 2026-02-16

### Added
- **Stable Waiting Gate**: Added `runtimeAutoResumeStabilityPolls` to require consecutive `readyToResume` polls before auto-resume sends a continuation message.
- **Feedback Signal Evidence**: Runtime `completionWaiting.evidence` now includes `feedbackSignalDetected` for Good/Bad/Helpful-style idle confirmation.

### Changed
- **Copilot Insiders Idle Detection**: Expanded feedback detection beyond exact `Good/Bad` text to include Helpful/Not Helpful variants, thumbs labels, and feedback-related aria/title signals.
- **Waiting-State Continuation Robustness**: Auto-resume waiting detection now prioritizes explicit `completionWaiting.readyToResume` verdict and tracks streak telemetry in dashboard runtime data.

## [4.10.24] - 2026-02-16

### Added
- **Explicit Completion+Waiting Verdict**: Runtime snapshot now includes `completionWaiting` with `readyToResume`, confidence score/label, reasons, and recommended action.
- **State Detection Command**: Added `Antigravity: Detect Completion + Waiting State` (`antigravity.detectCompletionWaitingState`) to generate a focused JSON verdict report.
- **Dashboard Detection Surface**: Runtime card now shows Ready-to-Resume, completion confidence, reasoning summary, and a one-click detection button.

### Changed
- **State Confidence Pipeline**: Completion/waiting detection is now first-class data from the CDP runtime script instead of only status inference.

## [4.10.23] - 2026-02-16

### Added
- **Guidance Confidence Scoring**: Guard analysis now emits `recommendedNextActionConfidence` (`high|medium|low`) alongside recommended actions.

### Changed
- **Operator Visibility**: Status menu guard snapshot, dashboard runtime telemetry, and guard/fix JSON reports now display action confidence with the recommended next step.

## [4.10.22] - 2026-02-16

### Added
- **Recommended Next Action Engine**: Guard evaluation now computes a single `recommendedNextAction` to guide operators toward the highest-impact fix.

### Changed
- **Diagnostics Guidance Upgrade**: `Explain Auto-Resume Guard`, `Auto-Fix Resume Readiness`, status menu guard snapshot, and dashboard runtime telemetry now surface `recommendedNextAction` directly.

## [4.10.21] - 2026-02-16

### Added
- **Immediate Guarded Retry**: `Auto-Fix Resume Readiness` now attempts an immediate resume message when (and only when) runtime is waiting, auto-resume is enabled, and guard checks pass.

### Changed
- **Auto-Fix Report Enrichment**: Auto-fix diagnostics now include `immediateRetry` metadata (`attempted`, `sent`, `reason`, waiting/enable state) and command summary now reports retry outcome.

## [4.10.20] - 2026-02-16

### Added
- **Auto-Fix Resume Readiness Command**: Added `Antigravity: Auto-Fix Resume Readiness` (`antigravity.autoFixAutoResumeReadiness`) to run safe chat-focus recovery steps and re-evaluate guard readiness.
- **Dashboard Runtime Action**: Added `Auto-Fix Resume Readiness` button in Runtime State card for one-click recovery + verification.
- **Status Menu Action**: Added quick action in status menu to run the same auto-fix workflow without opening dashboard.

### Changed
- **Recovery Diagnostics**: Auto-fix now emits a structured before/after JSON report (copied to clipboard + opened in editor) including command outcomes, guard state changes, and improvement flag.

## [4.10.19] - 2026-02-16

### Added
- **Status Menu Guard Snapshot**: Status menu now includes an auto-resume guard row with allow/block state, score/strict summary, and next eligibility countdown.

### Changed
- **Runtime Check Enrichment**: `Antigravity: Check Runtime State` now reports guard allow/block status and next eligibility timing in its notification/log output.

## [4.10.18] - 2026-02-16

### Added
- **Auto-Resume Timing Telemetry**: Host now tracks waiting-delay and cooldown windows, last resume outcome, and blocked reason.
- **Runtime Countdown Visibility**: Dashboard runtime card now shows next eligible auto-resume time, cooldown remaining, delay remaining, and last resume outcome.

### Changed
- **Explain Guard Report Enrichment**: `Antigravity: Explain Auto-Resume Guard` now includes host telemetry timing details for deeper diagnostics.

## [4.10.17] - 2026-02-16

### Added
- **Explain Auto-Resume Guard Command**: Added `Antigravity: Explain Auto-Resume Guard` (`antigravity.explainAutoResumeGuard`) to produce a JSON diagnostics report with allow/block status, reasons, and targeted suggestions.
- **Status Menu Shortcut**: Added quick action in status menu to inspect auto-resume guard decisions directly.

### Changed
- **Guard Evaluation Reuse**: Runtime auto-resume and diagnostics now share `getAutoResumeGuardReport()` to keep decisions and operator reporting aligned.

## [4.10.16] - 2026-02-16

### Added
- **Dashboard Guard Diagnostics**: Runtime card now shows Auto-Resume guard score, strict-primary pass state, gate allow/block result, and human-readable block reason.

### Changed
- **Live Gate Transparency**: Guard diagnostics are computed from runtime coverage and current settings (`runtimeAutoResumeMinScore`, `runtimeAutoResumeRequireStrictPrimary`) so operators can immediately understand resume decisions.

## [4.10.15] - 2026-02-16

### Added
- **Auto-Resume Guardrail Policy**: Added configurable gate enforcement for automatic resume using `runtimeAutoResumeMinScore` and `runtimeAutoResumeRequireStrictPrimary`.

### Changed
- **Runtime Poller Safety**: Automatic resume now evaluates Cross-UI health score/strict readiness before sending continuation messages.
- **Scoring Consistency**: `runCrossUiSelfTest` now reuses the shared Cross-UI health evaluator used by auto-resume gating to prevent drift.

## [4.10.14] - 2026-02-16

### Added
- **Cross-UI Health Score**: `runCrossUiSelfTest` now computes a weighted score (0–100) and letter grade to quantify runtime readiness.
- **Strict Primary Gates**: Added strict pass/fail checks for VS Code + Antigravity text-input and button/signal readiness.
- **Score Breakdown**: Self-test report now includes component-level scoring (`scoreParts`) and `bothPrimaryProfilesStrictReady` flag.

### Changed
- **Self-Test Summary**: Command summary now reports score, grade, strict readiness status, and profile readiness in one line.

## [4.10.13] - 2026-02-16

### Added
- **Cross-UI Self-Test Command**: Added `Antigravity: Run Cross-UI Self-Test` to generate a structured readiness report for `vscode`, `antigravity`, and `cursor` profiles.
- **Self-Test Report Export**: Self-test now opens a JSON report document and copies it to clipboard for quick troubleshooting handoff.
- **Dashboard Trigger**: Added `Run Cross-UI Self-Test` button in runtime card.

### Changed
- **Dashboard Command Bridge**: Dashboard can now invoke extension commands through a dedicated `runCommand` message path.

## [4.10.12] - 2026-02-16

### Added
- **Cross-UI Coverage Validator**: Added `Antigravity: Validate Cross-UI Coverage` command to quickly verify Antigravity and VS Code runtime detection signals.

### Changed
- **Send Fallback Expansion**: Text sending now attempts current profile first, then explicitly falls back across `vscode`, `antigravity`, and `cursor` selectors before bridge fallback.
- **Click Discovery Expansion**: Button discovery now performs cross-profile selector sweeps when primary selectors return no candidates.

## [4.10.11] - 2026-02-16

### Added
- **Resume Delivery Fallback Matrix**: Auto-resume now attempts CDP bridge delivery first, then falls back to VS Code command-driven chat open/focus/paste/submit flow.
- **Idle Signal Coverage Expansion**: Waiting detection now recognizes additional feedback variants (`Helpful`, `Not Helpful`, thumbs labels) beyond only `Good/Bad`.

### Changed
- **Completion Inference Hardening**: Runtime state now infers completion for no-tab environments using signal-based logic (`isIdle && noPendingActions`) to better support VS Code/Copilot Insider chat panes.
- **Bridge Return Semantics**: `sendHybridBump()` now returns success/failure so higher layers can choose fallback strategies deterministically.

## [4.10.10] - 2026-02-16

### Added
- **Auto-Resume Continuation**: When runtime stays in `waiting_for_chat_message`, extension can now automatically send a configurable resume message to keep Copilot Chat moving.
- **Manual Resume Command**: Added `Antigravity: Resume From Waiting State` command for one-click continuation.
- **Dashboard Coverage Readout**: Runtime card now shows per-profile coverage (`vscode`, `antigravity`, `cursor`) including input/send visibility and pending accept counts.

### Changed
- **Waiting Policy Config**: Added and wired `runtimeAutoResumeEnabled`, `runtimeAutoResumeMessage`, and `runtimeAutoResumeCooldownSec` across manifest, config manager, and dashboard.
- **Status Menu Actions**: Added fast resume action to the status quick menu.

## [4.10.9] - 2026-02-16

### Added
- **Waiting-State Reminder Policy**: Added configurable reminders when runtime remains in `waiting_for_chat_message` state for a defined duration.
- **Reminder Settings**: Added `runtimeWaitingReminderEnabled`, `runtimeWaitingReminderDelaySec`, and `runtimeWaitingReminderCooldownSec` settings (manifest + dashboard controls).
- **Cross-Profile Coverage Metrics**: Runtime snapshot now includes `profileCoverage` for `antigravity`, `vscode`, and `cursor`, exposing send-input/button visibility and pending accept counts per profile.

### Changed
- **Runtime Poller Behavior**: Extension runtime poll loop now tracks waiting-state entry time and throttles notifications via cooldown.

## [4.10.8] - 2026-02-16

### Added
- **Runtime JSON Export**: Added `Antigravity: Copy Runtime State JSON` command (`antigravity.copyRuntimeStateJson`) for fast debugging and external handoff.

### Changed
- **Status Menu Runtime Header**: Status quick menu now begins with a live runtime summary row (status, tabs, pending actions, waiting-for-chat signal).
- **Runtime Cache Wiring**: Extension now caches the latest runtime snapshot for immediate status-menu rendering.

## [4.10.7] - 2026-02-16

### Added
- **Runtime Transition Timeline**: Dashboard now tracks and displays recent runtime status transitions (up to 20 entries) with timestamps.
- **State Duration Metrics**: Added dashboard fields for current-state elapsed duration and waiting-since timestamp when status is `waiting_for_chat_message`.

### Changed
- **Status Menu Shortcut**: Added `Check Runtime State` entry to the status quick menu for faster diagnostics.

## [4.10.6] - 2026-02-16

### Added
- **Dashboard Runtime State Card**: Added live runtime-state section in the dashboard with status chip and fields for mode, idle state, tab completion, pending accept actions, and waiting-for-chat-message detection.
- **Dashboard Runtime Refresh**: Added manual and automatic (3s) runtime-state polling from webview to extension host.

### Changed
- **Dashboard/Host Bridge**: Added `requestRuntimeState` ↔ `runtimeStateUpdate` message channel and provider wiring through `DashboardPanel.setRuntimeStateProvider()`.

## [4.10.5] - 2026-02-16

### Added
- **Runtime State Command**: Added `Antigravity: Check Runtime State` command (`antigravity.checkRuntimeState`) to inspect live automation state, including task completion and waiting-for-chat-message detection.

### Changed
- **Status Bar Runtime Signal**: Status bar now reflects live runtime state labels (`ACTIVE`, `PENDING`, `COMPLETE`, `WAITING`, `IDLE`) while CDP automation is running.
- **CDP Strategy Resolution**: Extension command handlers now resolve the active CDP strategy at execution time, avoiding stale startup references.

## [4.10.4] - 2026-02-16

### Added
- **Runtime State API**: Added `window.__autoAllGetRuntimeState()` snapshot API for live status reporting, including `waiting_for_chat_message`, pending accept button counts, tab completion totals, and mode metadata.
- **Strategy State Accessor**: Added `CDPHandler.getAutomationRuntimeState()` and `CDPStrategy.getRuntimeState()` for extension-side state inspection.
- **Submodule Integration**: Added `Claude-Autopilot` as a tracked git submodule reference (`benbasha/Claude-Autopilot`).

### Changed
- **Cross-UI Message Sending**: `sendMessage()` now attempts DOM-native input + send button/keyboard submit first (Antigravity, Cursor, VS Code profiles), then falls back to hybrid bridge submission.
- **Cross-UI Button Detection**: Unified selector bundles now drive click scanning across Antigravity and VS Code/Cursor surfaces in loop execution and static polling.
- **DOM Scan Click Routing**: `dom-scan-click` now prioritizes profile selectors passed from strategy context before generic fallback selectors.

## [4.10.3] - 2026-02-15

### Changed
- **VSIX Packaging Hygiene**: Excluded `fix_cdp_script.js` from extension artifacts via `.vscodeignore` so maintenance-only helper scripts are not shipped in release packages.

## [4.10.2] - 2026-02-15

### Added
- **Quick Preset Switcher**: Added one-click `Conservative`, `Balanced`, and `Aggressive` preset application in the dashboard.
- **Preset Profile Targeting**: Added preset target selector (`vscode`, `antigravity`, `cursor`) so each profile can be tuned independently.

### Changed
- **Preset Application Logic**: Dashboard now updates per-profile click methods/selectors plus shared execution settings (`interactionParallel`, `interactionRetryCount`) when a preset is applied.

## [4.10.1] - 2026-02-15

### Added
- **UI Profile Routing**: Added `interactionUiProfile` with `auto|vscode|antigravity|cursor` to select the UI targeting stack explicitly.
- **Per-Profile Click Bundles**: Added profile-specific click method settings (`interactionClickMethodsVSCode`, `interactionClickMethodsAntigravity`, `interactionClickMethodsCursor`).
- **Per-Profile Selector Bundles**: Added profile-specific selector lists (`interactionClickSelectorsVSCode`, `interactionClickSelectorsAntigravity`, `interactionClickSelectorsCursor`).

### Changed
- **CDP Strategy Resolution**: Auto-accept now resolves profile-aware selector strings and method bundles so VS Code uses a dedicated element/method path instead of Antigravity-focused defaults.
- **Dashboard Controls**: Added UI Profile selector and editable per-profile method/selector text areas.

## [4.10.0] - 2026-02-15

### Added
- **Expanded Interaction Matrix**: Added selectable methods for text (`cdp-insert-text`, `bridge-type`), click (`dom-scan-click`, `bridge-click`, `native-accept`, `process-peek`, `visual-verify-click`), and submit (`ctrl-enter`).
- **Visual Verification Setting**: New `antigravity.interactionVisualDiffThreshold` setting for screenshot-diff click confirmation sensitivity.
- **CDP Helper APIs**: Added `dispatchMouseEventToAll`, `insertTextToAll`, `executeInAllSessions`, `captureScreenshots`, and `getConnectedPageIds` for richer interaction routing.

### Changed
- **CDP Strategy Execution**: Auto-accept now executes configured click methods through `InteractionMethodRegistry` instead of fixed command-only fallback.
- **Dashboard Controls**: Interaction Methods card now exposes all newly added methods and visual diff threshold tuning.
- **Connection Reliability**: `CDPHandler.connect()` now establishes WebSocket page connections instead of only scanning ports.

## [4.9.4] - 2026-02-15

### Added
- **AntiBridge Remote Coordination (Phase 5)**: WebSocket-based multi-machine coordination with peer management, task/memory/interaction relay, heartbeat monitoring, and peer pruning.
- **MCP Federation (Phase 6)**: Connect to third-party MCP servers with server registration, tool discovery, auto-routing tool invocation, and stats tracking.
- **Voice Control**: Full implementation with 10 command patterns (approve, reject, bump, switch_model, status, pause, resume, dashboard, tests, deploy), wake-word mode, command parser with confidence scoring.
- **Test Coverage**: 91 tests across 12 suites — CircuitBreaker (7), RateLimiter (7), VoiceControl (10), CodeReviewer (12), AntiBridge (10), MCP Federation (10).

### Changed
- **ROADMAP**: Swarm Mode, Configurable Strategies, Remote Bridge, MCP Federation all marked complete.

## [4.9.3] - 2026-02-15

### Added
- **Configurable Interaction Strategy System**: 13 interaction methods across 3 categories (Text Input, Click, Submit) with `InteractionMethodRegistry` pattern.
- **Dashboard Panel**: New "Interaction Methods" card with 13 checkboxes, parallel execution toggle, and retry count.
- **Config Integration**: 6 new VS Code settings (`interactionTextMethods`, `interactionClickMethods`, `interactionSubmitMethods`, `interactionTimings`, `interactionRetryCount`, `interactionParallel`).
- **Test Coverage**: `interaction-methods.test.js` (10 tests). Total: 35 passing tests across 6 suites.

### Changed
- **CDPStrategy**: Replaced 8-line skeleton with full 170-line implementation (CDP connection, BlindBumpHandler lifecycle, auto-accept polling, InteractionMethodRegistry).
- **BlindBumpHandler**: Refactored to use InteractionMethodRegistry for all interactions (open chat, type, submit). Added cycle counter and diagnostics.
- **StrategyManager**: Added `executeAction()`, `getMethodSummary()`, and `dispose()`.
- **Clicker**: Replaced stub with real InteractionMethodRegistry delegation.

## [4.9.2] - 2026-02-15

### Added
- **Swarm Mode (Phase 5)**: Concurrent agent execution via `swarmExecute` with `Promise.allSettled`. Includes `SwarmResult` type and `getSwarmStatus` for monitoring.
- **Test Coverage**: Added `exit-detector.test.js` (5 tests), `mcp-server.test.js` (5 tests), `swarm-mode.test.js` (5 tests). Total: 25 passing tests across 5 suites.
- **ROADMAP Update**: Marked Phase 4 (Intelligence) as complete.

### Fixed
- **project-manager.ts**: Fixed mismatched quote (backtick vs single-quote) causing TS compilation error.

## [4.9.0] - 2026-02-09

### Added
- **ProjectTracker Service**: Centralized task management service that parses `task.md` and `ROADMAP.md` to drive the autonomous loop.
- **Autonomous Loop V2**: Updated `AutonomousLoop` (formerly Director) to dynamically query `ProjectTracker` for next tasks, removing hardcoded dependencies on `@fix_plan.md`.
- **MCP Integration**: Exposed `get_next_task` and `complete_task` tools via the Model Context Protocol server, enabling external agents to participate in task execution.
- **Universal Agent Protocols**: Updated `AGENTS.md` with strict universal rules and clear role definitions.

### Fixed
- **Infrastructure**: Resolved 'connection refused' errors by ensuring Docker containers (Postgres, Redis) are running.

- **Testing**: Switched to native Node.js test runner (`node --test`) to resolve `vitest` conflicts and successfully implemented logic tests for `ProjectTracker`.
- **UI Stability**: Addressed potential infinite loops in UI/Webview related to backend connectivity.

## [4.8.0] - 2026-02-09

### Added
- **Agent Orchestrator (Phase 18)**: Multi-agent system (Planner, Researcher, Implementer) powered by Browser Bridge.
- **Dashboard Update (Phase 17)**: Added Model Selection, Voice Mode, Loop Timing, and pattern configuration arrays.
- **Verification Workflow**: Added `verify-orchestrator.md` for manual testing.

### Changed
- **Agent Logic**: `connection-based` execution replaces stubbed logic.
- **Docs**: Updated `AGENTS.md` and `DASHBOARD.md` to reflect new architecture.

## [4.7.20] - 2026-02-09

### Added
- **Hybrid Bump Strategy**: Combines Browser idle detection with Extension Host command execution.
- **Bridge Handler**: New `__ANTIGRAVITY_HYBRID_BUMP__` signal for safe clipboard-based submission.

### Fixed
- **Renderer Crashes**: Eliminated "No renderer found" errors by bypassing direct DOM manipulation for chat submission.
- **Syntax Errors**: Fixed recursive loop in `full_cdp_script.js`.

## [4.7.19] - 2026-02-09

### Fixed
- **Auto-Bump**: Restored missing `autoBump` and `isConversationIdle` logic from submodule scripts.
- **SendMessage**: Robust multi-strategy submission (Enter, Alt+Enter, Ctrl+Enter, Button Click).

## [4.2.0] - 2026-02-08

### Added
- **Auto-Bump System**: `isConversationIdle()` detects Good/Bad feedback badges; `autoBump()` sends configurable message with cooldown.
- **Multi-Strategy Submit**: `sendMessage()` now tries Enter → Alt+Enter → Ctrl+Enter → send button fallback.
- **Config Injection**: `bumpMessage`, `autoApproveDelay`, `bumpEnabled`, `threadWaitInterval` stored in `__autoAllState`.
- **Dashboard**: Thread Wait (s) and Poll Frequency (ms) controls added.

### Fixed
- **Critical**: `ReferenceError: autoBump is not defined` — race condition between 3 patch scripts caused function definitions to be overwritten while call sites were preserved.
- **Removed dead bump** from `performClick` (only fired after clicking, never when idle).

---

## [4.1.9] - 2026-02-08

### Changed
- **expandCollapsedSections**: Rewritten with 3-strategy aggressive approach (broad toggles, chat chevrons, hidden Run button parent traversal).
- **Dashboard CSS**: Enhanced with number/checkbox input styling, card layouts, section headers.

---

## [4.1.8] - 2026-02-07

### Fixed
- **expandCollapsedSections**: Now targets parent containers of hidden "Run" buttons.
- **performClick**: Re-queries for buttons after expansion.

---

## [4.1.7] - 2026-02-07

### Fixed
- Dashboard settings visibility improvements.
- CDP timeout and port controls added to Dashboard.

---

## [4.1.6] - 2026-02-07

### Fixed
- **sendMessage**: Added Escape key dismissal + ActiveElement fallback.
- Verified dynamic loading of `bumpMessage` from config.

---

## [4.1.5] - 2026-02-07

### Fixed
- "Search/Select Mode" popups from PowerShell (hidden window via `windowsHide: true`).

---

## [4.1.4] - 2026-02-07

### Added
- `antigravity.cdpTimeout` config (default 10000ms).
- `antigravity.cdpPort` config (default 9000).

### Fixed
- CDPHandler timeouts now use config values.
- Relauncher no longer steals focus.
- Bump reliability improved with `execCommand` fallback in `cdp-client.ts`.

---

## [4.1.3] - 2026-02-07

### Added
- `sendMessage` method in `CDPClient` for bump functionality.
- Auto-bump after task completion in `AutonomousLoop`.

### Fixed
- Chat input selector reliability for `sendMessage`.

---

## [4.1.2] - 2026-02-07

### Added
- `antigravity.showStatusMenu` command with Quick Pick menu.
- Status Bar click opens menu (Start Autonomous, Enable Auto-All, Open Dashboard).

---

## [4.1.1] - 2026-02-07

### Fixed
- Duplicate `StatusBarItem` in `CDPStrategy` removed.
- `full_cdp_script.js` ignores Extensions view (no more random sidebar clicks).

---

## [4.1.0] - 2026-02-07

### Added
- Interactive Dashboard with bi-directional config sync.
- CDP Client hardening (real DOM polling replaces mocks).
- Model switching via DOM interaction.

### Changed
- `package.json` bumped to 4.1.0.
- All 5 missing commands registered in `extension.ts`.

---

## [4.0.1] - 2026-02-07

### Fixed
- Auto-clicker no longer blocks "Stop" buttons (added to default rejects).
- `acceptPatterns` and `rejectPatterns` implemented.
- `bumpMessage` configuration injection fixed.
- Logger leak fixed (shared OutputChannel).
- `TaskType` enum/const duplication resolved.
- `CircuitBreaker` singleton usage fixed.

---

## [4.0.0] - 2026-02-07

### Added
- **Unified Architecture**: Merged `AUTO-ALL`, `auto-accept`, `auto-accept-agent`, and `yoke` into single codebase.
- **Strategy Pattern**: Choose between `Simple` (Command) and `CDP` (Browser) drivers.
- **Autonomous Loop**: Full integration of Yoke agent loop with goal tracking.
- **Project Manager**: Jira/GitHub task sync and `@fix_plan.md` support.
- **Advanced Configuration**: 24 configurable settings covering all automation aspects.
- **Chat Bump**: Agent keeps threads alive with configurable bump messages.
- **Comprehensive Documentation**: `LLM_INSTRUCTIONS.md`, `VISION.md`, `DASHBOARD.md`.
