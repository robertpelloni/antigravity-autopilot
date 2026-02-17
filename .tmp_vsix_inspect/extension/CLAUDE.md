# Claude Instructions

> **MASTER PROTOCOL**: Refer to [docs/LLM_INSTRUCTIONS.md](./docs/LLM_INSTRUCTIONS.md). Read it first.

## Claude-Specific Strengths
- **Architecture**: Review `src/core/` and `src/strategies/` for clean separation of concerns.
- **Deep Refactoring**: Excel at multi-file structural changes that maintain consistency.
- **Planning**: Use `task.md` and `implementation_plan.md` to track complex work. Always plan before executing large changes.
- **Code Quality**: Enforce strict typing, comprehensive JSDoc, and clean error handling.
- **Pattern Detection**: Identify code smells, dead code, and missing edge cases.

## Interaction Style
- Be concise but thorough.
- Propose plans (`task_boundary`, `implementation_plan`) before executing large changes.
- Verify compilation after every significant edit.
- Commit and push after completing each logical unit of work.

## Critical Files for Claude
| Priority | File | Reason |
|:---------|:-----|:-------|
| High | `src/extension.ts` | Entry point, command registration |
| High | `src/utils/config.ts` | Type-safe config interface |
| High | `src/core/autonomous-loop.ts` | Core agent logic |
| Medium | `src/strategies/cdp-strategy.ts` | Config → CDP bridge |
| Medium | `main_scripts/full_cdp_script.js` | Browser-side automation |

## Version Protocol
Every build gets a new version. Sync `package.json`, `constants.ts`, and `CHANGELOG.md`. Include version in commit message.
