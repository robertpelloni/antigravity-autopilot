# Copilot Instructions — Antigravity Autopilot

> For the full development protocol, see [docs/LLM_INSTRUCTIONS.md](../docs/LLM_INSTRUCTIONS.md).

## Project Context
This is the **Antigravity Autopilot** VS Code extension — an autonomous AI coding assistant that auto-clicks buttons, bumps conversations, and manages multi-tab automation via CDP (Chrome DevTools Protocol).

## Code Conventions
- **TypeScript** (strict mode) for all `src/` files.
- **JavaScript** (ES2020, IIFE pattern) for `main_scripts/full_cdp_script.js`.
- **CRLF** line endings (Windows project).
- **camelCase** for functions/variables, **PascalCase** for classes, **SCREAMING_SNAKE** for constants.
- All public functions/classes must have JSDoc comments.
- All errors must be caught and logged — no silent failures.

## Key Patterns
- **Config**: All settings in `antigravity.*` namespace. Read via `config.get<T>(key)`.
- **Strategy Pattern**: `IStrategy` interface → `CDPStrategy` or `SimpleStrategy`.
- **CDP Script**: Browser-side code injected via `Runtime.evaluate`. No Node.js APIs allowed.
- **Auto-bump**: `isConversationIdle()` → `autoBump()` → `sendMessage()` pipeline.

## When Completing Code
- Prefer existing helpers (`queryAll`, `isElementVisible`, `workerDelay`) over raw DOM.
- Use `window.__autoAllState` for all runtime state in the CDP script.
- Always add a `log()` call for significant actions.
- Respect `isAcceptButton()` → `isCommandBanned()` filter chain for button clicks.

## Version Management
When bumping version, update: `package.json`, `src/utils/constants.ts`, `CHANGELOG.md`.
