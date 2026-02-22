# Submodule & Companion Reference

The following table tracks projects, experiments, and forks related to the Antigravity Autopilot ecosystem.

Current repository history shows a **mixed state**: several companion directories are present as tracked gitlink-like entries in the root tree, while `.gitmodules` metadata is not consistently available. Treat these as companion modules/references unless/until a dedicated submodule-governance cleanup pass is performed.

| Module | Origin | Purpose | Current role |
|:----------|:-------|:--------|:-------|
| `AUTO-ALL-AntiGravity` | [ai-dev-2024](https://github.com/ai-dev-2024/AUTO-ALL-AntiGravity) | Original CDP multi-tab auto-accept | Historical reference |
| `antigravity-auto-accept` | [pesoszpesosz](https://github.com/pesoszpesosz/antigravity-auto-accept) | Simple command-based auto-accept | Historical reference |
| `auto-accept-agent` | [Munkhin](https://github.com/Munkhin/auto-accept-agent) | CDP auto-accept variant | Historical reference |
| `yoke-antigravity` | [ai-dev-2024](https://github.com/ai-dev-2024/yoke-antigravity) | Autonomous loop + MCP + Voice | Historical reference |
| `free-auto-accept-antigravity` | [RendezvousP](https://github.com/RendezvousP/free-auto-accept-antigravity) | Community auto-accept variant | Reference |
| `AntiBridge-Antigravity-remote` | [linhbq82](https://github.com/linhbq82/AntiBridge-Antigravity-remote) | Remote bridge for multi-machine | Source lineage for embedded remote server |
| `AntigravityMobile` | [AvenalJ](https://github.com/AvenalJ/AntigravityMobile) | Mobile companion app concept | Active companion candidate |
| `antigravity-multi-purpose-agent` | [rodhayl](https://github.com/rodhayl/antigravity-multi-purpose-agent) | Multi-purpose agent variant | Companion reference |
| `Claude-Autopilot` | [benbasha](https://github.com/benbasha/Claude-Autopilot) | Claude queue processing + auto-resume reference | Companion reference |

## Maintenance Notes

1. Do not run destructive submodule commands (`git submodule deinit --all`, mass `git rm`) without a dedicated cleanup plan.
2. If full submodule governance is desired, first restore authoritative `.gitmodules` mapping and then normalize each pointer deterministically.
3. Keep `DASHBOARD.md` and this file synchronized when module topology changes.
