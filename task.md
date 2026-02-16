# Task Queue (Source-of-Truth Bridge)

This file exists to satisfy components that prioritize `task.md`.

Canonical backlog is maintained in `TODO.md`.

## Current Priority Tasks

- [x] P0.1 Replace simulated MCP server transport in `src/modules/mcp/server.ts`
- [x] P0.2 Replace simulated MCP federation transport in `src/modules/mcp/federation.ts` *(HTTP/WebSocket complete; stdio still pending by design)*
- [ ] P0.3 Replace autonomous-loop circuit-state placeholder with real breaker state
- [ ] P0.4 Replace hardcoded dummy `antigravity.getChromeDevtoolsMcpUrl` return
- [ ] P0.5 Unify project task source-of-truth behavior (`task.md`, `TODO.md`, tracker order)
- [ ] P1.1 Add dashboard controls for `maxConsecutiveTestLoops`, `maxCallsPerHour`, `interactionTimings`
- [ ] P1.2 Resolve manifest/handler parity for internal commands
- [ ] P2.1 Replace progress tracker placeholder metrics with real telemetry
- [ ] P2.2 Upgrade test generator to remove placeholder assertions
- [ ] P3.1 Replace replica tests with real source-module tests
