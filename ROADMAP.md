# Antigravity Autopilot Roadmap (Scope Pruned)

Last reconciled: **2026-02-25**

This roadmap reflects the strictly enforced "Auto-Clicker Only" scope constraint mandate.

## Current State Snapshot

### Completed foundations
- [x] Hyper-reliable CDP DOM Scan Click execution
- [x] Runtime state telemetry + status/dashboard diagnostics
- [x] Auto-resume guard and escalation recovery loops
- [x] Antigravity click safety hardening (menu/layout anti-mistarget protections)
- [x] Complete eradication of legacy aliases, wildcards, and runaway KeyboardEvents
- [x] Complete removal of MCP, Voice, Remote Control, and extraneous integrations

## Next Delivery Phases

### Phase S1 — Selector Safety Hardening
- [ ] Complete dual-fork mixed-environment soak matrix (Antigravity + VS Code Insiders + Cursor combinations)
- [ ] Add structured runtime counters for blocked unsafe targets (menu/layout/chrome banlist hits)
- [ ] Add dashboard card for selector health and blocked-hit trends

### Phase S2 — Execution Isolation
- [ ] Investigate migrating DOM interactions to purely isolated contexts (to prevent any `window` cross-talk)
- [ ] Strengthen verification routines around `insertText` fallbacks

### Phase S3 — Release Governance
- [ ] Introduce `VERSION` single-source file
- [ ] Add CI check that fails on version drift (`package.json` / constants / script metadata / changelog header)

## Exit Criteria for "Feature Complete"
- [ ] Exhaustive proof that no broad CSS selector can trigger workbench chrome actions across supported UIs
- [ ] Total zero-leak guarantee on keypress dispatches
- [ ] Absolute isolation from legacy extensions and competing polling loops
