# Antigravity Autopilot Dashboard

**Version**: 5.2.52
**Status**: Production / Sovereign Execution

## Architecture Map

- `src/` - Typescript Extension Backend (Native Node.js / VS Code API)
- `main_scripts/` - Vanilla Javascript CDP Payload (Chromium Render Context)
- `tests/` - High-fidelity Module test vectors
- `yoke-antigravity/` - Deprecated reference implementation (Do not mutate natively)
- `docs/` - Global unified protocol (`LLM_INSTRUCTIONS.md`)

## Submodule Matrix

*Note: Live git submodules were phased out of core ops to reduce detached-HEAD breakage loop during autonomous iteration. Virtual tracking maintained here.*

| Component | Status | Version / Sync | Directory |
|-----------|--------|----------------|-----------|
| **Core AI Orchestrator** | Active | `v5.2.52` | `src/core/` |
| **CDP Bridge** | Active | `v5.2.52` | `src/services/cdp/` |
| **Copilot Auto-Continue (Legacy)**| Merged | N/A | `main_scripts/full_cdp_script.js` |
| **Yoke System** | Deprecated / Ref | `v4.1.0` | `yoke-antigravity/` |

## Deployment Metrics
- Auto-Release Verification: **Enabled**
- CI High Advisories Gating: **Enabled** (strict allowlist)
- MCP Server Status: **Running (Port 9333)**
