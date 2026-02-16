# Changelog

All notable changes to **Antigravity Autopilot (Unified)** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

---

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
