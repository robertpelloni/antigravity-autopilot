# Antigravity Autopilot Roadmap (Reality-Based)

Last reconciled: **2026-02-22**

This roadmap reflects implementation truth in the root extension (`src/`, `main_scripts/`) and current release line (`5.2.63`).

## Current State Snapshot

### Completed foundations
- [x] CDP runtime + multi-target bridge orchestration
- [x] Runtime state telemetry + status/dashboard diagnostics
- [x] Auto-resume guard, watchdog escalation, and recovery command surfaces
- [x] MCP server/federation real HTTP + WebSocket execution
- [x] Antigravity click safety hardening (menu/layout anti-mistarget protections)
- [x] Embedded remote server promotion into root extension
- [x] **Remote host security baseline**: localhost default + explicit host allowlist/LAN gate

### Partially complete / active hardening
- [~] Completion detection manual soak validation (deterministic soak is complete; long-run product soak remains)
- [~] Multi-fork UI isolation tuning under dual-open environments (ongoing edge-case hardening)
- [~] Governance/doc sync discipline (improved, but requires continued per-release enforcement)

### Not yet complete
- [ ] Mobile companion first-class telemetry/auth integration
- [ ] Remote control role/permission model beyond host allowlist
- [ ] Enterprise policy layers (audit retention/export, SSO/multi-user controls)
- [ ] Single-source version automation (eliminate drift-prone multi-file version literals)

## Next Delivery Phases

### Phase R1 — Runtime Safety Continuation
- [ ] Complete dual-fork mixed-environment soak matrix (Antigravity + VS Code Insiders + Cursor combinations)
- [ ] Add structured runtime counters for blocked unsafe targets (menu/layout/chrome banlist hits)
- [ ] Add dashboard card for selector-profile health and blocked-hit trends

### Phase R2 — Remote Ecosystem Hardening
- [x] Add host allowlist + localhost default binding
- [ ] Add optional auth token / session handshake for remote clients
- [ ] Add role-based action restrictions (read-only telemetry vs control actions)
- [ ] Add explicit allowlist UX in dashboard settings with validation

### Phase R3 — Mobile/Companion Integration
- [ ] Implement read-only runtime telemetry endpoint tailored for mobile dashboard consumption
- [ ] Add signed command channel for safe remote control actions
- [ ] Add integration tests across extension remote server + mobile companion client

### Phase R4 — Release Governance
- [ ] Introduce `VERSION` single-source file and generate/sync package + runtime constants during release build
- [ ] Add CI check that fails on version drift (`package.json` / constants / script metadata / changelog header)
- [ ] Add docs freshness check for dashboard/roadmap/vision/handoff timestamps

## Exit Criteria for “Feature Complete”

- [ ] No unsafe broad selectors can trigger workbench chrome actions across supported UIs
- [ ] Remote control path has host allowlist + auth + role constraints + audit visibility
- [ ] Versioning is single-source and drift-proof
- [ ] Roadmap/TODO/dashboard/handoff remain synchronized at each release
- [ ] Runtime and docs both reflect the same operational truth
