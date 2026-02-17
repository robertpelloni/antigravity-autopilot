# Task Queue (Source-of-Truth Bridge)

This file exists to satisfy components that prioritize `task.md`.

Canonical backlog is maintained in `TODO.md`.

## Current Priority Tasks

- [x] Ops.1 Add one-command release verification (`npm run verify:release`) and document usage
- [x] Ops.2 Remove unused root `vitest` dependency; confirm root `npm audit` is clean
- [x] Ops.3 Add CI audit policy gate (fail on high/critical advisories only)
- [x] Ops.4 Add secure release path (`npm run verify:release:secure`) with policy-test + audit gate
- [x] Ops.5 Add root CI workflow for compile + lint + tests + audit policy
- [x] Ops.6 Add root quality-gate tests (schema parity + command parity + runtime placeholder policy)

- [x] P0.1 Replace simulated MCP server transport in `src/modules/mcp/server.ts`
- [x] P0.2 Replace simulated MCP federation transport in `src/modules/mcp/federation.ts` *(HTTP/WebSocket complete with remote auth/header support; stdio still pending by design)*
- [x] P0.3 Replace autonomous-loop circuit-state placeholder with real breaker state
- [x] P0.4 Replace hardcoded dummy `antigravity.getChromeDevtoolsMcpUrl` return *(runtime-resolved URL implemented; command is intentionally documented as internal-only)*
- [x] P0.5 Unify project task source-of-truth behavior (`task.md`, `TODO.md`, tracker order)
- [x] P1.1 Add dashboard controls for `maxConsecutiveTestLoops`, `maxCallsPerHour`, `interactionTimings`
- [x] P1.2 Resolve manifest/handler parity for internal commands
- [x] P1.3 Harden model selection and model ID consistency
- [x] P1.4 Improve model scraper reliability
- [ ] P1.5 Strengthen autonomous completion detection *(signal/telemetry hardening + adaptive threshold calibration + deterministic soak replay landed; manual in-product soak validation remains)*

- [ ] Ops.RELEASE Release v4.10.88 (Continuenew VSIX)
- [x] P2.1 Replace progress tracker placeholder metrics with real telemetry
- [x] P2.2 Upgrade test generator to remove placeholder assertions *(completed with AST-backed extraction + merge-safe generation)*
- [x] P3.1 Replace replica tests with real source-module tests *(root extension scope complete: TaskAnalyzer + ProjectTracker + CircuitBreaker + ExitDetector + RateLimiter + ProgressTracker + TestLoopDetector + VoiceControl + Backoff + AgentOrchestrator swarm aggregation + MCPFederation + InteractionMethodRegistry + CodeReviewer now test real src modules; remaining replica-style tests are in reference submodules)*
- [x] P2.3 Voice control parser-to-runtime bridge *(intents now execute mapped extension actions, destructive intents require explicit confirmation, and manual transcript debug command + execution telemetry are implemented)*
- [x] P2.4 Project manager integrations hardening *(complete: GitHub + Jira issue sync now support pagination/rate-limit handling, and sync snapshots with conflict metadata persist to `.yoke/project-manager-sync.json`)*
- [x] P3.3 Deterministic runtime waiting/auto-resume soak harness *(complete: extracted `runtime-auto-resume-guard` pure module, wired extension guard/escalation decisions to pure helpers, and added deterministic replay + no-spam/deadlock escalation assertions)*
