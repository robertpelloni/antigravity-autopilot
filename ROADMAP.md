# Antigravity Autopilot Roadmap (Reality-Based)

Last reconciled: **2026-02-16**

This roadmap reflects current implementation truth in `src/` + `main_scripts/`, not historical intent claims.

## Current Readiness Snapshot

### Production-ready core (implemented and wired)
- [x] CDP connection + runtime state polling (`src/services/cdp/cdp-handler.ts`, `src/strategies/cdp-strategy.ts`)
- [x] Auto-All runtime telemetry UX (status menu + runtime dashboard card)
- [x] Cross-UI selector/method routing (`interactionUiProfile` + per-profile method bundles)
- [x] Runtime waiting detection, guarded auto-resume, watchdog escalation controls
- [x] Basic simple-mode command strategy (`src/strategies/simple-strategy.ts`)

### Partially implemented (works, but not complete/robust)
- [~] Autonomous loop (`src/core/autonomous-loop.ts`) — operational but still includes placeholder circuit-state reporting and simplistic completion pipeline
- [~] Agent orchestrator (`src/core/agent-orchestrator.ts`) — queue/swarm exists; decomposition/execution reliability is heuristic
- [~] Project tracking (`src/core/project-tracker.ts`, `src/providers/project-manager.ts`) — works for markdown parsing but weak source-of-truth consistency
- [~] Model routing (`src/core/model-selector.ts`) — wired but uses heuristic/fragile model availability and string matching

### Scaffolded / simulation-level modules (not production-ready)
- [ ] MCP server transport (`src/modules/mcp/server.ts`) — simulated lifecycle + limited in-process request handler
- [ ] MCP federation transport (`src/modules/mcp/federation.ts`) — simulated connection/tool invocation path
- [ ] Progress tracker depth (`src/core/progress-tracker.ts`) — placeholder metrics (`responseLength`, `responseHash`, files changed inference)
- [ ] Test generator quality (`src/core/test-generator.ts`) — regex extraction and placeholder error tests
- [ ] Voice control capture path (`src/modules/voice/control.ts`) — parser exists; no actual speech capture pipeline wiring

## Phased Delivery Plan

## Phase A — Platform Truth & Safety (P0)
- [ ] Replace simulated MCP server with real transport (HTTP/SSE or stdio) and typed request dispatch
- [ ] Implement real MCP federation client lifecycle (connect/list/call with retries, auth, per-server health)
- [ ] Replace autonomous-loop placeholder circuit status with actual circuit breaker state
- [ ] Remove hardcoded dummy command return (`antigravity.getChromeDevtoolsMcpUrl`)
- [ ] Standardize task source-of-truth (`TODO.md`/`task.md`/`ROADMAP.md`) and enforce single authoritative source

## Phase B — Core Loop Robustness (P1)
- [ ] Upgrade `ProgressTracker` to derive real file/response telemetry from workspace and runtime data
- [ ] Harden response completion detection (reduce false-positive “done” exits)
- [ ] Add structured failure taxonomy and recovery policy for loop/orchestrator failures
- [ ] Improve model selection reliability and fix identifier mismatch/drift

## Phase C — UX Coverage & Config Completeness (P1)
- [ ] Add missing dashboard controls for manifest settings:
	- `maxConsecutiveTestLoops`
	- `maxCallsPerHour`
	- `interactionTimings`
- [ ] Ensure command discoverability parity (manifest vs registered handlers)
- [ ] Add context help/tooltips for advanced runtime guard/escalation settings

## Phase D — Quality Automation (P2)
- [ ] Replace placeholder-generated tests with semantic source analysis and framework-aware assertions
- [ ] Convert mocked/replicated tests to real module tests for root `src/` implementation
- [ ] Expand CI checks to include extension command/config parity and dashboard-schema parity

## Phase E — Ecosystem Integration (P2/P3)
- [ ] AntiBridge remote control integration from reference to active root module wiring
- [ ] Mobile companion telemetry endpoint + auth + basic control actions

## Phase F — Commercial/Enterprise (P4)
- [ ] Multi-tenant memory service
- [ ] Audit logging policy + export
- [ ] SSO and deployment hardening

## Exit Criteria for “Feature Complete”

- [ ] No simulation/placeholder logic remains in active root modules
- [ ] Every config in `package.json` has explicit UI representation or documented rationale
- [ ] Every user-facing command is both registered and manifest-declared (or intentionally private/documented)
- [ ] Root tests validate real implementations (not replicas) for core modules
- [ ] Runtime/manual docs align with code behavior and current version
