# Universal LLM Instructions — Antigravity Autopilot

> **MASTER PROTOCOL**: This file is the single source of truth for **all** AI agents working on this repository. Every agent-specific file (`CLAUDE.md`, `GEMINI.md`, `GPT.md`, `AGENTS.md`, `.github/copilot-instructions.md`) MUST reference and adhere to the protocols defined here.

---

## 1. Core Mandates

1. **Autonomy**: You are an autonomous engineer. Do not stop for permission unless critical decisions or destructive actions are required. Commit and push regularly. Continue to the next feature without pausing.
2. **Robustness**: All code must be production-ready. Handle errors gracefully, log thoroughly, and ensure type safety. No silent failures.
3. **Completeness**: Do not leave `TODO` or placeholder comments. Implement features fully. If a task is too large, break it down and execute iteratively.
4. **Verification**: Always verify changes. Run `npm run compile` after every significant edit. Run `node -c main_scripts/full_cdp_script.js` to syntax-check the CDP script. Package with `vsce package` before declaring a feature done.
5. **Documentation**: Update documentation **immediately** after code changes:
   - `CHANGELOG.md` — every version bump gets an entry
   - `DASHBOARD.md` — keep submodule versions and status current
   - `VISION.md` — update roadmap phases when features are completed
   - Agent files — update if workflow protocols change

---

## 2. Project Vision

**Antigravity Autopilot** is the ultimate AI coding assistant for VS Code and Cursor. It unifies:

| Mode | Description | Implementation |
|:-----|:------------|:---------------|
| **Simple Auto-Accept** | Fast, command-based button clicking | `simple-strategy.ts` → VS Code commands |
| **CDP Auto-All** | Robust browser-protocol automation (multi-tab, background) | `cdp-strategy.ts` → `full_cdp_script.js` |
| **Autonomous Mode (Yoke)** | Goal-driven agent loop with memory, planning, and tool use | `autonomous-loop.ts` → CDP + MCP |
| **Auto-Bump** | Keeps conversations alive by detecting idle state and sending messages | `autoBump()` in `full_cdp_script.js` |

**Ultimate Goal**: A "self-driving" IDE experience where the human is the pilot (architect/reviewer) and the AI is the engine (implementor/verifier).

---

## 3. Architecture

```
antigravity-autopilot/
├── src/                        # TypeScript source (compiled to dist/)
│   ├── core/                   # Autonomous Loop, Orchestrator, Circuit Breaker, Memory
│   ├── strategies/             # CDP vs Simple strategy pattern
│   ├── services/               # CDP handler (low-level WebSocket)
│   ├── providers/              # CDP client, Project Manager
│   ├── modules/                # Clicker, MCP Server, Voice Control
│   ├── ui/                     # Dashboard (WebView), Status Bar
│   └── utils/                  # Config, Logger, Constants
├── main_scripts/               # Browser-injected JS (runs inside VS Code's Chromium)
│   ├── full_cdp_script.js      # THE core automation script (auto-click, bump, loops)
│   └── relauncher.js           # OS-level CDP port relauncher
├── docs/                       # Documentation
│   └── LLM_INSTRUCTIONS.md    # THIS FILE - universal agent protocol
├── dist/                       # Compiled output (esbuild)
└── *.vsix                      # Packaged extension artifacts
```

### Key Files

| File | Purpose | Edit Frequency |
|:-----|:--------|:---------------|
| `main_scripts/full_cdp_script.js` | Browser-side automation (clicks, bumps, loops) | High |
| `src/strategies/cdp-strategy.ts` | Config injection bridge (TS → JS) | Medium |
| `src/utils/config.ts` | All settings interface + ConfigManager | Medium |
| `src/ui/dashboard.ts` | Interactive settings WebView | Medium |
| `package.json` | Extension manifest, settings schema, commands | Low |
| `src/extension.ts` | Entry point, command registration | Low |

### Data Flow

```
User toggles setting in Dashboard
  → dashboard.ts postMessage → config.update()
  → cdp-strategy.ts reads config → injects into __autoAllStart({...})
  → full_cdp_script.js stores in __autoAllState
  → cursorLoop / antigravityLoop / staticLoop use state values
```

---

## 4. Workflow Protocols

### A. Git Management
- **Commit after every significant logical step** (feature, fix, version bump).
- **Semantic commit messages**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- **Always include version in commit message** when bumping: `fix(critical): v4.2.0 - description`.
- **Push after every commit** — keep remote in sync.
- **Submodules**: Run `git submodule update --init --recursive` if needed. Ensure submodules are clean before committing parent.

### B. Versioning Protocol
- **Semantic Versioning**: `MAJOR.MINOR.PATCH`.
- **Every build gets a new version number** — no two builds share a version.
- **Three locations must stay in sync**:
  1. `package.json` → `"version"` field
  2. `src/utils/constants.ts` → `export const VERSION`
  3. `CHANGELOG.md` → new entry at the top
- **Bump PATCH** for bug fixes, **MINOR** for new features, **MAJOR** for breaking changes.

### C. Code Style
- **Language**: TypeScript (strict mode) for `src/`; JavaScript (ES2020) for `main_scripts/`.
- **Line endings**: CRLF for all files (Windows environment).
- **Comments**: JSDoc for public functions/classes. Explain "WHY", not just "WHAT".
- **Error handling**: Always wrap CDP operations in try/catch. Log errors with `log()`.
- **Naming**: camelCase for functions/variables, PascalCase for classes, SCREAMING_SNAKE for constants.

### D. Testing & Verification
1. `npm run compile` — must succeed with zero errors.
2. `node -c main_scripts/full_cdp_script.js` — syntax check the CDP script.
3. `vsce package` — must produce a valid `.vsix`.
4. Manual test: Install VSIX, enable Auto-All, verify buttons are clicked.

### E. CDP Script Rules (`full_cdp_script.js`)
This file runs **inside the browser** (VS Code's Chromium process). Special rules:
- **No Node.js APIs** — no `require`, `fs`, `process`, etc.
- **No ES Modules** — must use IIFE pattern `(function() { ... })()`.
- **DOM-only**: Use `document.querySelector`, `document.querySelectorAll`, `dispatchEvent`.
- **`queryAll(selector)`**: Helper that returns Array from querySelectorAll.
- **`isElementVisible(el)`**: Helper checking offsetParent, getBoundingClientRect, etc.
- **Async patterns**: Use `async/await` with `workerDelay(ms)` for setTimeout-based delays.
- **State**: Everything stored on `window.__autoAllState`.

---



## 6. Configuration Reference

All settings live under the `antigravity.*` namespace in VS Code settings. The authoritative list is in `package.json` → `contributes.configuration` and `src/utils/config.ts` → `AntigravityConfig`.

### Key Settings

| Setting | Type | Default | Description |
|:--------|:-----|:--------|:------------|
| `strategy` | `simple\|cdp` | `cdp` | Click strategy |
| `autoAllEnabled` | boolean | false | Master toggle for CDP auto-clicker |
| `bumpMessage` | string | `"bump"` | Text sent when AI is idle |
| `autoApproveDelay` | number | 30 | Bump cooldown in seconds |
| `threadWaitInterval` | number | 5 | Wait between loop cycles (seconds) |
| `pollFrequency` | number | 1000 | Poll interval for static loop (ms) |
| `bannedCommands` | string[] | `[]` | Commands to never auto-click |
| `acceptPatterns` | string[] | `[]` | Custom accept button text patterns |
| `rejectPatterns` | string[] | `[]` | Custom reject button text patterns |
| `cdpPort` | number | 9000 | CDP debugging port |
| `cdpTimeout` | number | 10000 | CDP connection timeout (ms) |

---

## 7. Agent-Specific Notes

- **Claude (Anthropic)**: Excellent at architectural planning, deep refactoring, and complex multi-file edits. Use for core logic changes.
- **Gemini (Google)**: Great at large context handling and rapid prototyping. Use for understanding `full_cdp_script.js` holistically.
- **GPT (OpenAI)**: Solid for code generation, logic verification, and debugging. Use for isolated bug fixes.
- **Copilot (GitHub)**: Best for inline completions and small edits. Follows `.github/copilot-instructions.md`.

All agents **must read this file first** before making changes.
