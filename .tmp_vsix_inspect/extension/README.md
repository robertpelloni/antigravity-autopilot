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
3. Enable "Auto-All (CDP)" and configure your settings
4. The extension will prompt to relaunch with CDP if needed

## Configuration

All settings are under `antigravity.*` in VS Code settings. Key ones:

| Setting | Default | Description |
|:--------|:--------|:------------|
| `bumpMessage` | `"bump"` | Text sent when AI is idle |
| `autoApproveDelay` | `30` | Bump cooldown (seconds) |
| `threadWaitInterval` | `5` | Wait between loop cycles (seconds) |
| `bannedCommands` | `[]` | Commands to never auto-click |

## Documentation

- [**Vision & Roadmap**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/VISION.md) — Project goals and planned features
- [**Implementation TODO**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/TODO.md) — Prioritized gap list and execution order
- [**Handoff Analysis**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/HANDOFF.md) — Detailed audit findings and evidence
- [**Changelog**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/CHANGELOG.md) — Version history
- [**Dashboard**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/DASHBOARD.md) — Module status and project structure
- [**Submodules**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/docs/SUBMODULES.md) — Reference implementation details
- [**LLM Instructions**](https://github.com/hyper/antigravity-autopilot/blob/HEAD/docs/LLM_INSTRUCTIONS.md) — Agent development protocol

## Building

```bash
npm install
npm run compile
vsce package
```

## Version

**v4.10.61** — See [CHANGELOG.md](https://github.com/hyper/antigravity-autopilot/blob/HEAD/CHANGELOG.md) for details.

## Implementation Status Note

Core CDP runtime, runtime telemetry, and auto-resume watchdog systems are active.
Some advanced modules (notably MCP server/federation transport, progress analytics depth, and test-generation quality paths) remain partially implemented and are tracked in [TODO.md](https://github.com/hyper/antigravity-autopilot/blob/HEAD/TODO.md).
