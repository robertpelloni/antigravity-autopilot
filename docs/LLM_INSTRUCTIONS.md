# Universal LLM Instructions — Antigravity Autopilot

> **MASTER PROTOCOL**: This file is the single source of truth for **all** AI agents working on this repository. Every agent-specific file (`CLAUDE.md`, `GEMINI.md`, `GPT.md`, `AGENTS.md`, `.github/copilot-instructions.md`) MUST reference and adhere to the protocols defined here.

---

## 1. Core Mandates

1. **Autonomy**: You are an autonomous engineer. Do not stop for permission unless critical decisions or destructive actions are required. Commit and push regularly. Continue to the next feature without pausing.
2. **Robustness**: All code must be production-ready. Handle errors gracefully, log thoroughly, and ensure type safety. No silent failures.
3. **Completeness**: Do not leave `TODO` or placeholder comments. Implement features fully. If a task is too large, break it down and execute iteratively.
4. **Verification**: Always verify changes. Run `npm run compile` after every significant edit. Run `node -c main_scripts/full_cdp_script.js` to syntax-check the CDP script. Package with `npm run verify:release` before declaring a feature done.
5. **Documentation Lifecycle**: Update documentation **immediately** after code changes:
   - `CHANGELOG.md` — every release/build bump gets an entry.
   - `DASHBOARD.md` — keep submodule versions and directory status current.
   - `VERSION` / `package.json` / `main_scripts/full_cdp_script.js` — All version strings must sync.
   - `MEMORY.md` — Update with ongoing codebase observations and design preferences.
   - `DEPLOY.md` — Keep updated with compilation and packaging standards.

---

## 2. Project Vision & Architecture

**Antigravity Autopilot** is the ultimate AI coding assistant for VS Code and Cursor, unifying native IDE extensions with Chrome DevTools Protocol (CDP) browser-side automation.

### Architecture
- **Root**: `src/extension.ts` (Entry Hook & Command Registry)
- **Brain**: `src/core/agent-orchestrator.ts` & `src/strategies/cdp-strategy.ts`
- **Senses**: `src/services/cdp/cdp-handler.ts` (Direct Chromium WebView connection via Port 9000/9222)
- **Hands**: `main_scripts/full_cdp_script.js` (The injected Payload that actually clicks UI elements)
- **Voice**: `src/modules/voice/control.ts`

### Submodules & Project Root
- Do **not** use `git submodules` arbitrarily. The project has moved away from submodules in favor of flattening the monorepo structure where possible to prevent git-locking states.
- If referencing an external ecosystem, note it in `DASHBOARD.md`.

---

## 3. Workflow Protocols

### A. Git & Versioning Protocol
- **Every build gets a new version number**.
- **Three locations must stay in sync**:
  1. `package.json` → `"version"` field
  2. `main_scripts/full_cdp_script.js` → `ANTIGRAVITY_VERSION` variable
  3. `CHANGELOG.md` → detailed entry at the top (`## [x.x.x] - YYYY-MM-DD`)
- Make sure to git pull, commit, and push routinely.

### B. Code Style & Integrity
- **Language**: TypeScript (strict mode) for `src/`; JavaScript (Vanilla ES2020) for `main_scripts/`.
- **CRLF/LF**: Use consistent line endings. Mixed endings will silently break `full_cdp_script.js` injection.
- **Error Handling**: `src/extension.ts` uses a global try/catch on `activate()` mapping to `~/antigravity-activation.log` to catch hidden VSIX boot crashes. Maintain this paradigm.

### C. The CDP Automation Layer (`full_cdp_script.js`)
This is the most critical and fragile file in the repository. It runs **inside the Chromium render thread** of the IDE.
- **No Node.js APIs** (`fs`, `path`, `require` do not exist).
- **DOM-only manipulation**: Only rely on `document.querySelector`, `Event` dispatch, and specific IDE DOM class structures (e.g. `.monaco-list-row`, `.codicon-play`).
- **Telemetry**: Always wrap `console.log` calls in the custom `__ANTIGRAVITY_LOG__` bridge parser to ensure messages propagate back to the `Antigravity Debug` output channel in the native extension host.

---

## 4. Agent Tool Instructions

When acting as an implementation Agent in this codebase:
1. Always read `task.md` OR `implementation_plan.md` (check the artifact path `~/.gemini/antigravity/brain/{id}`) to orient yourself in the current step.
2. Read `TODO.md` for granular feature backlogs and `ROADMAP.md` for major architectural sweeps.
3. Read `MEMORY.md` before struggling with a bug; historical gotchas (e.g., hidden aria-labels on Buttons) are stored there.

## 5. Agent-Specific Contexts
- **Gemini / Claude / GPT**: You all read this file. You must act decisively, iteratively testing changes using the `test-activation.js` harness or pure `npm run compile`. If you get stuck with an unknown IDE API missing command error, you must aggressively reconstruct the test path or rewrite the VSIX to bypass cache (`npm run verify:release`).
