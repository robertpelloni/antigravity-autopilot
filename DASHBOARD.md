# Antigravity Autopilot — Project Dashboard

**Version**: 4.10.26
**Build Date**: 2026-02-16
**Status**: ✅ Active Development

---

## Project Structure

```
antigravity-autopilot/
├── src/                              # TypeScript source (active development)
│   ├── core/                         # Autonomous loop, orchestrator, memory
│   │   ├── autonomous-loop.ts        # Main agent loop (ProjectTracker integrated)
│   │   ├── project-tracker.ts        # Task/Roadmap management service
│   │   ├── circuit-breaker.ts        # Safety limits
│   │   ├── agent-orchestrator.ts     # Internal multi-agent orchestration
│   │   ├── memory-manager.ts         # Short/Long-term memory injection
│   │   ├── model-selector.ts         # AI model routing
│   │   ├── model-scraper.ts          # Available model detection
│   │   ├── code-reviewer.ts          # Automated code review
│   │   ├── test-generator.ts         # Test case generation
│   │   ├── test-loop-detector.ts     # Infinite test loop prevention
│   │   ├── task-analyzer.ts          # Task decomposition
│   │   ├── exit-detector.ts          # Session exit detection
│   │   ├── progress-tracker.ts       # Stats & history
│   │   └── rate-limiter.ts           # API rate limiting
│   ├── strategies/                   # Click strategy pattern
│   │   ├── interface.ts              # IStrategy interface
│   │   ├── cdp-strategy.ts           # CDP-based (primary)
│   │   ├── simple-strategy.ts        # Command-based (fallback)
│   │   └── manager.ts               # Strategy lifecycle
│   ├── services/cdp/                 # Low-level CDP
│   │   └── cdp-handler.ts           # WebSocket connection manager
│   ├── providers/                    # High-level providers
│   │   ├── cdp-client.ts            # CDP operations (inject, switch, wait)
│   │   └── project-manager.ts       # Jira/GitHub sync
│   ├── modules/                      # Feature modules
│   │   ├── clicker/clicker.ts       # Simple clicker module
│   │   ├── mcp/server.ts            # MCP server integration
│   │   └── voice/control.ts         # Voice control interface
│   ├── ui/                           # User interface
│   │   ├── dashboard.ts             # Interactive WebView settings
│   │   └── status-bar.ts            # Status bar management
│   ├── utils/                        # Utilities
│   │   ├── config.ts                # ConfigManager + AntigravityConfig
│   │   ├── constants.ts             # VERSION, names, ports
│   │   └── logger.ts               # SharedOutputChannel logger
│   └── extension.ts                 # Entry point
├── main_scripts/                     # Browser-injected JavaScript
│   ├── full_cdp_script.js           # Core automation (50KB, 1250 lines)
│   └── relauncher.js                # CDP port relauncher
├── dist/                             # Compiled output
│   └── extension.js                 # Bundled (esbuild)
├── docs/                             # Documentation
│   ├── LLM_INSTRUCTIONS.md          # Universal agent protocol
│   └── SUBMODULES.md                # Submodule reference
└── *.vsix                            # Packaged extension artifacts
```

---

## Module Status

| Module | Status | Implementation | Notes |
|:-------|:-------|:---------------|:------|
| **CDP Auto-Clicker** | ✅ Active | `full_cdp_script.js` | Multi-tab, background mode, accept/reject patterns |
| **Auto-Bump** | ✅ Active | `autoBump()` in CDP script | Idle detection + configurable cooldown |
| **Simple Strategy** | ✅ Active | `simple-strategy.ts` | Command-based fallback |
| **Dashboard** | ✅ Active | `dashboard.ts` | Interactive WebView with all settings |
| **Interaction Matrix** | ✅ Active | `interaction-methods.ts` + `dashboard.ts` | Multi-method text/click/submit, visual verification threshold |
| **Status Bar** | ✅ Active | `status-bar.ts` | Quick Pick menu, state indicators |
| **Autonomous Loop** | ✅ Active | `autonomous-loop.ts` | Full loop with Memory & Orchestrator |
| **Circuit Breaker** | ✅ Active | `circuit-breaker.ts` | Loop limits, error counting |
| **Memory Manager** | ✅ Active | `memory-manager.ts` | Phase 14 — Integrated in `autonomous-loop.ts` |
| **Project Manager** | ✅ Active | `project-tracker.ts` | Centralized task tracking | 
| **Agent Orchestrator** | ✅ Active | `agent-orchestrator.ts` | Phase 18 — Browser-based multi-agent |
| **MCP Server** | ✅ Active | `mcp/server.ts` | Tools: `get_next_task`, `complete_task` |
| **Voice Control** | ✅ Wired | `voice/control.ts` | Interface scaffolded |
| **Model Selector** | ✅ Wired | `model-selector.ts` | Routing logic present |
| **Code Reviewer** | ✅ Wired | `code-reviewer.ts` | Review scaffolded |
| **Test Generator** | ✅ Wired | `test-generator.ts` | Generation scaffolded |

---

## Submodules

| Submodule | Origin | Purpose | Status |
|:----------|:-------|:--------|:-------|
| `AUTO-ALL-AntiGravity` | [ai-dev-2024](https://github.com/ai-dev-2024/AUTO-ALL-AntiGravity) | Original CDP multi-tab auto-accept | 📚 Reference |
| `antigravity-auto-accept` | [pesoszpesosz](https://github.com/pesoszpesosz/antigravity-auto-accept) | Simple command-based auto-accept | 📚 Reference |
| `auto-accept-agent` | [Munkhin](https://github.com/Munkhin/auto-accept-agent) | CDP auto-accept variant | 📚 Reference |
| `yoke-antigravity` | [ai-dev-2024](https://github.com/ai-dev-2024/yoke-antigravity) | Autonomous loop + MCP + Voice | 📚 Reference |
| `free-auto-accept-antigravity` | [RendezvousP](https://github.com/RendezvousP/free-auto-accept-antigravity) | Free community auto-accept | 📚 Reference |
| `AntiBridge-Antigravity-remote` | [linhbq82](https://github.com/linhbq82/AntiBridge-Antigravity-remote) | Remote bridge for multi-machine | 📚 Reference |
| `AntigravityMobile` | [AvenalJ](https://github.com/AvenalJ/AntigravityMobile) | Mobile companion app concept | 📚 Reference |
| `antigravity-jules-orchestration` | [Scarmonit](https://github.com/Scarmonit/antigravity-jules-orchestration) | Jules API + MCP orchestration | 📚 Reference |
| `antigravity-multi-purpose-agent` | [rodhayl](https://github.com/rodhayl/antigravity-multi-purpose-agent) | Multi-purpose agent variant | 📚 Reference |
| `Claude-Autopilot` | [benbasha](https://github.com/benbasha/Claude-Autopilot) | Claude queue processing + auto-resume reference | 📚 Reference |

---

## Quick Links
- [Vision & Roadmap](./VISION.md)
- [Changelog](./CHANGELOG.md)
- [Universal LLM Instructions](./docs/LLM_INSTRUCTIONS.md)
- [Submodule Reference](./docs/SUBMODULES.md)
