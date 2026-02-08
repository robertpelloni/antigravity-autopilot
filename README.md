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

- [**Vision & Roadmap**](VISION.md) — Project goals and planned features
- [**Changelog**](CHANGELOG.md) — Version history
- [**Dashboard**](DASHBOARD.md) — Module status and project structure
- [**Submodules**](docs/SUBMODULES.md) — Reference implementation details
- [**LLM Instructions**](docs/LLM_INSTRUCTIONS.md) — Agent development protocol

## Building

```bash
npm install
npm run compile
vsce package
```

## Version

**v4.2.0** — See [CHANGELOG.md](CHANGELOG.md) for details.
