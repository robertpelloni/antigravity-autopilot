# Antigravity Autopilot — Project Dashboard

**Version**: 4.10.59
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
| **CDP Auto-Clicker** | ✅ Active | `main_scripts/full_cdp_script.js` | Multi-tab + runtime state + click pipeline are operational |
| **Auto-Bump / Auto-Resume** | ✅ Active | `full_cdp_script.js`, `extension.ts` | Waiting-state detection, reminder, guarded auto-resume, watchdog escalation |
| **Simple Strategy** | ✅ Active | `src/strategies/simple-strategy.ts` | Command-based fallback strategy |
| **Dashboard Runtime UX** | ✅ Active | `src/ui/dashboard.ts` | Comprehensive runtime controls and diagnostics |
| **Interaction Matrix** | ✅ Active | `src/strategies/interaction-methods.ts` | Multi-method text/click/submit routing with profile bundles |
| **Status Bar + Status Menu** | ✅ Active | `src/ui/status-bar.ts`, `src/extension.ts` | Runtime labels and operator quick actions |
| **Autonomous Loop** | 🟡 Partial | `src/core/autonomous-loop.ts` | Functional loop, but still has placeholder circuit-state reporting and simplistic completion path |
| **Circuit Breaker** | ✅ Active | `src/core/circuit-breaker.ts` | Limits and error counting in use |
| **Memory Manager** | 🟡 Partial | `src/core/memory-manager.ts` | Session memory works; relevance/indexing is heuristic |
| **Project Tracking** | 🟡 Partial | `src/core/project-tracker.ts`, `src/providers/project-manager.ts` | Markdown-driven task sync works; source-of-truth is inconsistent (`task.md` vs `@fix_plan.md` vs roadmap) |
| **Agent Orchestrator** | 🟡 Partial | `src/core/agent-orchestrator.ts` | Queue/swarm works; decomposition and role execution are heuristic and fragile |
| **MCP Server** | 🔴 Scaffolded | `src/modules/mcp/server.ts` | Simulated startup and minimal in-process handler; no production transport/server lifecycle |
| **MCP Federation** | 🔴 Scaffolded | `src/modules/mcp/federation.ts` | Simulated connect/call flow; no real protocol transport wiring |
| **Voice Control** | 🟡 Partial | `src/modules/voice/control.ts` | Parser/intents implemented; no speech-capture/audio pipeline wiring |
| **Model Selector/Scraper** | 🟡 Partial | `src/core/model-selector.ts`, `src/core/model-scraper.ts` | Routing exists; scraper reliability and model-ID consistency need hardening |
| **Code Reviewer** | ✅ Active | `src/core/code-reviewer.ts` | Rule-based static scan and diagnostics pipeline |
| **Test Generator** | 🔴 Scaffolded | `src/core/test-generator.ts` | Regex-based generation with placeholder assertions and weak import synthesis |

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
