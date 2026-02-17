# Task Queue (Source-of-Truth Bridge)

This file exists to satisfy components that prioritize `task.md`.

Canonical backlog is maintained in `TODO.md`.

## Current Priority Tasks

- [x] P0.1 Replace simulated MCP server transport in `src/modules/mcp/server.ts`
- [x] P0.2 Replace simulated MCP federation transport in `src/modules/mcp/federation.ts` *(HTTP/WebSocket complete; stdio still pending by design)*
- [x] P0.3 Replace autonomous-loop circuit-state placeholder with real breaker state
- [x] P0.4 Replace hardcoded dummy `antigravity.getChromeDevtoolsMcpUrl` return
- [x] P0.5 Unify project task source-of-truth behavior (`task.md`, `TODO.md`, tracker order)
- [x] P1.1 Add dashboard controls for `maxConsecutiveTestLoops`, `maxCallsPerHour`, `interactionTimings`
- [x] P1.2 Resolve manifest/handler parity for internal commands
- [x] P1.3 Harden model selection and model ID consistency
- [x] P1.4 Improve model scraper reliability
- [x] P2.1 Replace progress tracker placeholder metrics with real telemetry
- [x] P2.2 Upgrade test generator to remove placeholder assertions *(completed with AST-backed extraction + merge-safe generation)*
- [ ] P3.1 Replace replica tests with real source-module tests *(in progress: TaskAnalyzer + ProjectTracker + CircuitBreaker + ExitDetector + RateLimiter now test real src modules; additional replica tests remain)*
