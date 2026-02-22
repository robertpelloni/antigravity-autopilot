# Antigravity Autopilot Dashboard

**Version**: 5.2.63  
**Last Updated**: 2026-02-22  
**Status**: Production hardening in progress (active safety + governance sweep)

## Project Structure at a Glance

- `src/` — TypeScript extension host (commands, orchestrator, CDP strategy, runtime guardrails, remote server)
- `main_scripts/` — injected browser/CDP runtime payload (`full_cdp_script.js`)
- `tests/` — Node test suites (quality gates + behavior regression)
- `assets/remote-ui/` — embedded remote control web UI
- `docs/` — global governance and protocol docs (`LLM_INSTRUCTIONS.md`, `SUBMODULES.md`)
- `dist/` — built extension artifacts

## Runtime Surface Matrix

| Surface | State | Notes |
|---|---|---|
| Core extension host | Active | Command + strategy orchestration in `src/extension.ts` |
| CDP handler/strategy | Active | Multi-target discovery + runtime bridge in `src/services/cdp/` |
| Injected automation script | Active | Antigravity selector hardening shipped in 5.2.63 |
| Runtime auto-resume/watchdog | Active | Telemetry + escalation guardrails operational |
| Embedded remote server | Active | **localhost-default + host allowlist controls** shipped |

## Referenced Module/Repo Matrix

The repository currently contains several sibling projects as tracked directories/gitlinks. Some are historical references, some are active companion projects.

| Module | Current Role | Location |
|---|---|---|
| `AUTO-ALL-AntiGravity` | Historical automation lineage/reference | `AUTO-ALL-AntiGravity/` |
| `antigravity-auto-accept` | Legacy auto-accept implementation reference | `antigravity-auto-accept/` |
| `auto-accept-agent` | Legacy companion agent reference | `auto-accept-agent/` |
| `copilot-auto-continue` | Legacy continuation logic source | `copilot-auto-continue/` |
| `yoke-antigravity` | Legacy Yoke reference | `yoke-antigravity/` |
| `AntiBridge-Antigravity-remote` | Remote-control origin/reference | `AntiBridge-Antigravity-remote/` |
| `AntigravityMobile` | Mobile companion project | `AntigravityMobile/` |
| `Claude-Autopilot` | Companion implementation/reference | `Claude-Autopilot/` |
| `antigravity-multi-purpose-agent` | Companion implementation/reference | `antigravity-multi-purpose-agent/` |
| `free-auto-accept-antigravity` | Community variant reference | `free-auto-accept-antigravity/` |

> Operational note: repository history indicates mixed usage of embedded directories and gitlink/submodule-style pointers. Keep `docs/SUBMODULES.md` aligned to avoid drift.

## Quality/Release Gates

- Compile: `npm run compile`
- Lint: `npm run lint`
- Targeted quality gates: `npm run test:quality-gates`
- Full release verification: `npm run verify:release`
- Secure release verification: `npm run verify:release:secure`

## Current Focus

1. Eliminate remaining Antigravity-only chrome mis-targeting edge cases in mixed VS Code fork setups.
2. Continue roadmap execution on ecosystem hardening (remote permissions complete milestone, mobile telemetry/auth next).
3. Keep all docs/version markers synchronized at each patch release.
