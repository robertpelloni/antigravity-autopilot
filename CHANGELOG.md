# Changelog

All notable changes to **Antigravity Autopilot (Unified)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

---

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
