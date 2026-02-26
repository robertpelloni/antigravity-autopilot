# Antigravity Autopilot — Master TODO 

Last updated: **2026-02-26**

This file represents the immediate backlog for the dramatically simplified, ultra-stable Auto-Clicker extension.

---

## Technical Debt & Cleanup
- [x] Eradicate remaining legacy wildcard click interaction methods from `interaction-methods.ts`
- [x] Safely enforce `dom-scan-click` as the solitary default in `config.ts` fallback behavior
- [x] Purge dashboard UI of obsolete textareas for generic CSS selectors
- [x] Remove any dead code related to MCP, Voice, or Network serving if missed in initial sweeps

## Core Stability P0
- [x] Ensure that `DOMScanClick` evaluates purely visually and adheres strictly to ban lists.
- [x] Extend unit test suite explicitly for `strategies/interaction-methods.ts` to assert that no wildcards can be parsed maliciously.
- [ ] Complete robust QA on specific IDE forks (VS Code vs Cursor vs Antigravity).

## Testing Architecture P1
- [ ] Add Cypress or Playwright end-to-end sandbox tests asserting that IDE chromes are never clicked.
- [ ] Run headless test loop asserting that `blindBumpHandler` successfully routes without hitting `VSCodeCommand` fallbacks.
- [ ] Confirm extension size reductions via `esbuild metafile` audits after module pruning.

## Documentation Sync
- [x] Keep `README.md`, `ROADMAP.md`, `TODO.md` strictly synchronized with "auto-clicker only" scope
- [ ] Revise `VISION.md` assuming it previously advertised Voice/Remote/MCP capabilities.

