# Antigravity Autopilot

> **The ultimate AI coding assistant for VS Code and Cursor.**

Antigravity Autopilot merges auto-accept, auto-click, autonomous agent mode, and intelligent conversation bumping into one powerful, deeply configurable extension.

## Features

- **🎯 Auto-Click**: Automatically clicks Accept, Run, and Continue buttons in AI chat panels
- **🔄 Auto-Bump**: Detects idle conversations (Good/Bad feedback visible) and sends configurable messages to keep the AI working
- **📑 Multi-Tab**: Cycles through multiple chat tabs and handles them in background mode
- **🛡️ Safety**: Configurable accept/reject patterns, banned commands, circuit breakers, max loop limits
- **⚡ Strategies**: Choose between CDP (browser protocol) for power or Simple (commands) for speed
- **📊 Dashboard**: Interactive WebView with all settings — no JSON editing required
- **🤖 Autonomous Mode**: Goal-driven agent loop with task decomposition and model routing

## Quick Start

1. Install the `.vsix` file: `Extensions → ⋯ → Install from VSIX`
2. Open Command Palette → `Antigravity: Open Dashboard`
3. Enable unified autopilot controls (`Auto Accept`, `Auto Bump`, and `Run/Expand/Continue`) and configure timings
4. The extension will prompt to relaunch with CDP if needed

## Configuration

All settings are under `antigravity.*` in VS Code settings. Key ones:

| Setting | Default | Description |
|:--------|:--------|:------------|
| `bumpMessage` | `"bump"` | Text sent when AI is idle |
| `autopilotAutoAcceptEnabled` | `false` | Unified toggle for automatic accept/action handling |
| `autopilotAutoBumpEnabled` | `true` | Unified toggle for idle bump/resume behavior |
| `autopilotRunExpandContinueEnabled` | `true` | Unified toggle for Run/Expand/Continue click actions |
| `autoAcceptPollIntervalMs` | `1000` | Unified polling interval for action scanning (ms) |
| `autoBumpCooldownSec` | `30` | Unified bump cooldown (seconds) |
| `threadWaitInterval` | `5` | Wait between loop cycles (seconds) |
| `bannedCommands` | `[]` | Commands to never auto-click |

## Documentation

- [**Vision & Roadmap**](VISION.md) — Project goals and planned features
- [**Implementation TODO**](TODO.md) — Prioritized gap list and execution order
- [**Handoff Analysis**](HANDOFF.md) — Detailed audit findings and evidence
- [**Changelog**](CHANGELOG.md) — Version history
- [**Dashboard**](DASHBOARD.md) — Module status and project structure
- [**Submodules**](docs/SUBMODULES.md) — Reference implementation details
- [**LLM Instructions**](docs/LLM_INSTRUCTIONS.md) — Agent development protocol

## Internal Commands (Intentional)

- `antigravity.getChromeDevtoolsMcpUrl` is intentionally **internal-only**.
- It is used for runtime diagnostics/programmatic consumers and is excluded from user-facing command contributions by design.
- Public command parity is enforced by automated tests, with this command explicitly allowlisted as internal.

## Building

```bash
npm install
npm run verify:release
npm run verify:release:secure
```

This one command compiles, lints, runs tests, packages the VSIX, and prints the artifact SHA256/size.
Use `verify:release:secure` when you want policy-test + audit-gate enforcement before the release pipeline.

## Version

**v4.10.86** — See [CHANGELOG.md](CHANGELOG.md) for details.

## Implementation Status Note

Core CDP runtime, runtime telemetry, auto-resume watchdog systems, and real MCP server/federation HTTP+WebSocket execution are active.
Remaining planned work is focused on higher-level reliability tuning and ecosystem expansion (see [TODO.md](TODO.md)).
