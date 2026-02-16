# Changelog

All notable changes to **Antigravity Autopilot (Unified)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

---

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
