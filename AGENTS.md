# Agent Instructions

> **MASTER PROTOCOL**: Refer to [docs/LLM_INSTRUCTIONS.md](./docs/LLM_INSTRUCTIONS.md) for the complete protocol. **Read that file first.**

## Universal Rules (All Agents)

1. **Every build gets a new version number.** Update these three locations in sync:
   - `package.json` → `"version"`
   - `src/utils/constants.ts` → `VERSION`
   - `CHANGELOG.md` → new entry
2. **Commit with version in message**: `feat: v4.2.1 - description` or `fix: v4.2.1 - description`.
3. **Git push after every commit.** Keep remote in sync.
4. **Compile check**: Run `npm run compile` after every significant code change.
5. **Syntax check CDP script**: Run `node -c main_scripts/full_cdp_script.js` after editing it.
6. **Update docs**: `CHANGELOG.md`, `DASHBOARD.md`, `VISION.md` as applicable.
7. **No TODOs or placeholders.** Implement fully or break into tracked sub-tasks.
8. **Line endings**: CRLF (`\r\n`) for all files in this Windows project.
9. **The CDP script (`full_cdp_script.js`) runs in the browser** — no Node.js APIs, no `require`, no `fs`.

## Quick Actions

| Action | Command |
|:-------|:--------|
| Build | `npm run compile` |
| Syntax Check | `node -c main_scripts/full_cdp_script.js` |
| Package | `vsce package` |
| Test | `npm test` |

## Key Architecture Points

- **Config flow**: `package.json` schema → `config.ts` interface → `dashboard.ts` UI → `cdp-strategy.ts` injection → `full_cdp_script.js` state
- **Strategy pattern**: `IStrategy` interface in `strategies/interface.ts`, implemented by `simple-strategy.ts` and `cdp-strategy.ts`
- **Browser script**: `full_cdp_script.js` is an IIFE that runs inside VS Code's Chromium process via CDP `Runtime.evaluate`
- **State**: All runtime state stored on `window.__autoAllState` in the browser context

## Project Structure

```
src/core/           → Autonomous loop, orchestrator, circuit breaker, memory
src/strategies/     → CDP vs Simple strategy implementations
src/services/       → CDP handler (low-level WebSocket connection)
src/providers/      → CDP client (high-level), project manager
src/modules/        → Clicker, MCP server, voice control
src/ui/             → Dashboard (WebView), status bar
src/utils/          → Config manager, logger, constants
main_scripts/       → Browser-injected JavaScript (CDP script, relauncher)
```
