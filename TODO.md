# Antigravity Autopilot — Master TODO (Reality-Based)

Last updated: **2026-02-16**

This file is the ordered implementation backlog for implementor models.
Priority order is strict: **P0 → P1 → P2 → P3 → P4**.

---

## How this backlog was derived

- Audited active root extension code in `src/` + `main_scripts/`
- Compared feature claims in `README.md`, `ROADMAP.md`, `VISION.md`, `DASHBOARD.md`, `CHANGELOG.md`
- Ran manifest/UI/command parity checks (`package.json` vs `dashboard.ts` vs `extension.ts`)
- Reviewed root tests in `tests/` for implementation vs mocked-replica coverage
- Sampled `antigravity-jules-orchestration/docs/reports/*` for claim drift and unresolved TODOs

---

## P0 — Critical platform completion (must-do first)

### P0.1 Replace simulated MCP server with real transport
- [x] Implement real MCP server lifecycle in `src/modules/mcp/server.ts`
- [x] Support transport mode(s): stdio and/or HTTP/SSE with clear config *(HTTP JSON-RPC implemented at `/rpc`; stdio remains backlog)*
- [x] Implement typed `tools/list`, `tools/call`, errors, and health endpoint
- [x] Remove simulated startup logs and timeout-based faux "listening" behavior
- **Evidence:** `src/modules/mcp/server.ts` currently logs `simulated` and uses placeholder server field
- **Definition of done:** external MCP client can discover and invoke root tools end-to-end

### P0.2 Replace simulated MCP federation with real client execution
- [x] Implement real connection adapters for configured `transport` values *(HTTP + WebSocket implemented; stdio intentionally unsupported for now)*
- [x] Perform actual MCP handshake + `tools/list` pull per server *(discovery call path implemented)*
- [x] Implement resilient `tools/call` with timeout/retry/backoff and per-server state *(timeout + state handling implemented; advanced retry policy still improvable)*
- [ ] Add auth/headers support for remote endpoints
- **Evidence:** `src/modules/mcp/federation.ts` explicitly simulates connect/call
- **Definition of done:** federation calls real downstream tools and returns true protocol responses

### P0.3 Eliminate runtime placeholders in active loop status
- [x] Replace `circuitState: CircuitState.CLOSED // Placeholder` with real breaker state
- [x] Ensure status is surfaced consistently in runtime telemetry and status menu
- **Evidence:** `src/core/autonomous-loop.ts`
- **Definition of done:** loop status reflects true runtime protection state under failure tests

### P0.4 Remove dummy command wiring
- [x] Replace hardcoded dummy result for `antigravity.getChromeDevtoolsMcpUrl`
- [x] Derive endpoint from active CDP connection context/config
- [ ] Either expose command in manifest or document as intentionally internal
- **Evidence:** `src/extension.ts` returns `'ws://localhost:9222'` dummy
- **Definition of done:** command returns actual runtime-resolved value (or is removed)

### P0.5 Establish a single task source-of-truth
- [x] Decide canonical planning file (`TODO.md` or `task.md`)
- [x] Update `ProjectTracker` and `ProjectManager` to consistent file order
- [x] Update docs that currently refer to missing `task.md`
- **Evidence:** `AGENTS.md` mandates `task.md`, but root lacked it; tracker falls back across multiple files
- **Definition of done:** autonomous task selection is deterministic and documented

---

## P1 — Core reliability and control-surface completeness

### P1.1 Fix dashboard-config parity gaps
- [x] Add controls for:
  - [x] `maxConsecutiveTestLoops`
  - [x] `maxCallsPerHour`
  - [x] `interactionTimings` (structured editor)
- [x] Ensure values are validated before `updateConfig`
- **Evidence:** automated parity check found 3 manifest settings not represented in dashboard
- **Definition of done:** every public setting is represented in UI or explicitly documented as advanced-only

### P1.2 Command manifest parity and discoverability
- [x] Decide policy for internal commands (`showStatusMenu`, `getChromeDevtoolsMcpUrl`)
- [x] Either add to `package.json` command contributions or mark internal and remove UI dependencies
- [x] Add parity test for manifest vs registered handlers
- **Evidence:** registered handlers exceed manifest commands by 2
- **Definition of done:** intentional parity with automated guard

### P1.3 Harden model selection and model ID consistency
- [x] Normalize model IDs across `constants.ts`, `config` defaults, and scraper output
- [x] Fix typo/keyword bug in quick-task routing (`brieft`)
- [x] Improve fallback policy when preferred models unavailable
- **Evidence:** `src/core/model-selector.ts`, `src/utils/constants.ts`
- **Definition of done:** deterministic model selection with stable fallback and validation

### P1.4 Improve model scraper reliability
- [x] Replace asynchronous `setTimeout`-inside-evaluate pattern with deterministic extraction
- [x] Add retries and UI-open/close synchronization
- [x] Add testable adapter seam for scraper
- **Evidence:** `src/core/model-scraper.ts` likely returns before delayed collection completes
- **Definition of done:** scraper reproducibly returns live model list when available

### P1.5 Strengthen autonomous completion detection
- [ ] Integrate richer response-state signals and avoid premature “complete” exits
- [ ] Calibrate `TestLoopDetector` thresholds using real historical runs
- [ ] Add structured confidence + reason telemetry for loop stop causes
- **Definition of done:** significantly fewer false-complete stops in manual soak testing

### P1.6 Dependency security hardening (non-breaking first)
- [x] Remove unused root `vitest` dependency to eliminate vulnerable transitive `vite`/`esbuild` chain
- [x] Confirm root `npm audit --json` reports zero vulnerabilities after dependency pruning
- [x] Apply non-breaking `npm audit fix` updates at root
- [x] Add CI gate to fail on new high/critical advisories (allowlist moderate dev-only with explicit policy)
- **Evidence:** root `npm audit --json` now reports 0 vulnerabilities after removing unused root `vitest`
- **Definition of done:** `npm audit` reports no unresolved high/critical issues and documented policy for any future dev-only advisories

---

## P2 — Quality and implementation-depth upgrades

### P2.1 Replace placeholder progress metrics
- [x] Compute real `filesChanged` from git diff or workspace snapshot
- [x] Compute actual response length/hash from captured response
- [x] Add error taxonomy fields (transport, parse, timeout, policy)
- **Evidence:** `src/core/progress-tracker.ts` returns placeholder values
- **Definition of done:** progress report is audit-grade and actionable

### P2.2 Upgrade test generator from scaffold to production utility
- [x] Replace naive regex parser with AST-based extraction
- [x] Remove placeholder `expect(true).toBe(true)` generation
- [x] Generate framework-correct imports and deterministic paths
- [x] Add safe overwrite/merge strategy for existing tests
- **Evidence:** `src/core/test-generator.ts`
- **Definition of done:** generated tests compile and meaningfully assert behavior

### P2.3 Voice control: parser-to-runtime command execution bridge
- [x] Wire parsed intents to real extension commands
- [x] Add secure confirmation flow for destructive voice intents
- [x] Add telemetry + manual transcript input panel for debug
- **Definition of done:** voice command path is functional beyond parser-only state

### P2.4 Project manager integrations hardening
- [x] Add robust Jira support (currently interface-only)
- [x] Add pagination/rate-limit handling for GitHub issues
- [x] Persist sync snapshots and conflict resolution metadata
- **Definition of done:** reliable bi-directional task sync with audit trail

---

## P3 — Testing architecture corrections (high leverage)

### P3.1 Convert replica tests to real module tests
- [x] Stop testing duplicated mock classes where possible
- [x] Add tests importing actual `src` modules with VS Code test harness/mocks
- [x] Cover command registration, runtime guard behavior, and parity checks
- [x] Migrate `CircuitBreaker` tests to execute real `src/core/circuit-breaker.ts` module
- [x] Migrate `ExitDetector` tests to execute real `src/core/exit-detector.ts` module
- [x] Migrate `RateLimiter` tests to execute real `src/core/rate-limiter.ts` module
- [x] Migrate `ProgressTracker` tests to execute real `src/core/progress-tracker.ts` module
- [x] Migrate `TestLoopDetector` tests to execute real `src/core/test-loop-detector.ts` module
- [x] Migrate `VoiceControl` tests to execute real `src/modules/voice/control.ts` module
- [x] Migrate `Backoff` tests to execute real `src/core/backoff.ts` module
- [x] Migrate `Swarm` aggregation tests to execute real `src/core/agent-orchestrator.ts` module
- [x] Migrate `MCPFederation` tests to execute real `src/modules/mcp/federation.ts` module
- [x] Migrate `InteractionMethodRegistry` tests to execute real `src/strategies/interaction-methods.ts` module
- [x] Migrate `CodeReviewer` tests to execute real `src/core/code-reviewer.ts` module
- **Evidence:** root `tests/` now execute real `src/` modules for migrated systems; remaining replica-style tests are in reference submodules
- **Definition of done:** regressions in source modules are caught by tests automatically

### P3.2 Add CI quality gates
- [x] Compile + lint + test on PR
- [x] Add schema parity test: `package.json` settings vs dashboard controls
- [x] Add command parity test: manifest vs registered handlers
- [x] Add placeholder/simulated-string policy check for active root modules

### P3.3 Add deterministic soak harness for runtime waiting/auto-resume
- [x] Replay runtime states into guard/watchdog logic
- [x] Assert no spam, no deadlock, correct escalation behavior

---

## P4 — Ecosystem expansion and productization

### P4.1 Root extension integration with Jules orchestration
- [ ] Add explicit command surface for Jules workflows
- [ ] Add connection profile management and auth checks
- [ ] Add runtime status cards for Jules session lifecycle

### P4.2 AntiBridge remote integration in root extension
- [ ] Promote reference bridge patterns to active root module with security model
- [ ] Add permissions and host allowlist

### P4.3 Mobile companion integration
- [ ] Implement read-only telemetry endpoint first
- [ ] Add remote control actions with role-based guardrails

### P4.4 Enterprise/commercial layers
- [ ] Audit logs, retention policy, export
- [ ] SSO and multi-user governance
- [ ] Cloud memory + project-scoped policy controls

---

## UX and documentation debt (cross-cutting)

- [ ] Keep `README.md`, `ROADMAP.md`, `DASHBOARD.md`, `VISION.md`, `CHANGELOG.md` synchronized at every release
- [ ] Add admin/operator manual for runtime guard/escalation settings
- [ ] Add advanced settings docs for interaction matrix and profile selectors
- [ ] Remove or clearly mark aspirational claims in docs/reports that are not yet rooted in active code

---

## Recommended execution order for implementor models

1. **MCP reality conversion** (`mcp/server.ts`, `mcp/federation.ts`)  
2. **Loop/runtime truth fixes** (`autonomous-loop.ts`, `extension.ts`)  
3. **UI/config parity completion** (`dashboard.ts`, `package.json`)  
4. **Telemetry and quality-depth upgrades** (`progress-tracker.ts`, `test-generator.ts`)  
5. **Testing modernization + CI gates** (`tests/*`, workflows)  
6. **Ecosystem integrations** (Jules/bridge/mobile)

---

## Validation checklist (must pass before claiming completion)

- [x] `npm run compile` passes
- [x] Root tests pass and include real-module coverage for changed systems
- [x] `npm run lint` passes
- [x] No placeholder/simulated behavior remains in active root runtime paths
- [x] Dashboard parity test passes for config + command surfaces
- [x] Docs updated with exact implementation status and version
