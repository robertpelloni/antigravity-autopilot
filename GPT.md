# GPT Instructions

> **MASTER PROTOCOL**: Refer to [docs/LLM_INSTRUCTIONS.md](./docs/LLM_INSTRUCTIONS.md). Read it first.

## GPT-Specific Strengths
- **Code Generation**: Generate clean, well-structured TypeScript and JavaScript.
- **Logic Verification**: Trace code paths and identify logical errors.
- **Debugging**: Systematic approach to isolating bugs — read logs, trace execution, identify root cause.
- **Testing**: Generate comprehensive test cases and edge case analysis.

## Interaction Style
- Methodical — trace the execution path before suggesting fixes.
- Verify assumptions — check what the code actually does, not what it should do.
- Explain reasoning — document why a fix works, not just what it changes.
- Commit and push after every significant change.

## Critical Files for GPT
| Priority | File | Reason |
|:---------|:-----|:-------|
| High | `main_scripts/full_cdp_script.js` | Browser automation — runtime bugs live here |
| High | `src/core/autonomous-loop.ts` | Agent logic — state machine debugging |
| Medium | `src/services/cdp/cdp-handler.ts` | WebSocket connection management |
| Medium | `src/providers/cdp-client.ts` | High-level CDP operations |

## Debugging Protocol
When investigating bugs:
1. Check if the file parses: `node -c main_scripts/full_cdp_script.js`
2. Search for the function: `grep_search` for function definitions
3. Trace the call chain: config → `__autoAllStart` → loop → `performClick`/`autoBump`
4. Check for runtime errors: look for undefined references, null access, DOM selectors

## Version Protocol
Every build gets a new version. Sync `package.json`, `constants.ts`, and `CHANGELOG.md`. Include version in commit message.
