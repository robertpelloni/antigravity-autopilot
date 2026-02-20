# Changelog

All notable changes to **Antigravity Autopilot (Unified)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [5.2.13] - 2026-02-20
- **Fixed:** Runaway "Proceed" bug correctly squashed by avoiding text overrides from adjacent `.view-lines` elements, and detecting text inside `contenteditable` React `<divs>`.
- **Improved:** Increased reliability of React form submission defaults by requesting native form submission where available, and injecting `keypress` alongside standard enter keys.

## [5.2.12] - 2026-02-20
- **Fixed:** Resolved the "ProceedProceedProceed" bug where Monaco editor `.view-lines` text content was not accurately evaluated, causing runaway typing loops without submission.
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
- **Build System**: Fixed `npm build` failures by updating `jules-api` Dockerfile to use `npm install --omit=dev` instead of strict `npm ci`.
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
