# Gemini Instructions

> **MASTER PROTOCOL**: Refer to [docs/LLM_INSTRUCTIONS.md](./docs/LLM_INSTRUCTIONS.md). Read it first.

## Gemini-Specific Strengths
- **Large Context**: Utilize your context window to understand the full scope of `main_scripts/full_cdp_script.js` (1200+ lines) and its interaction with `src/`.
- **Rapid Prototyping**: Quickly implement features and fixes, but always verify compilation.
- **Documentation**: Keep `DASHBOARD.md`, `VISION.md`, and `CHANGELOG.md` up to date.
- **Holistic Understanding**: Read multiple files simultaneously to understand cross-cutting concerns.

## Interaction Style
- Proactive — implement and verify without waiting for explicit permission.
- Update `task.md` frequently to track progress.
- Use `notify_user` only when blocked or for final review.
- Commit and push after every significant change.

## Critical Files for Gemini
| Priority | File | Reason |
|:---------|:-----|:-------|
| **Critical** | `main_scripts/full_cdp_script.js` | Core browser automation — largest and most complex file |
| High | `src/strategies/cdp-strategy.ts` | Config injection bridge |
| High | `src/ui/dashboard.ts` | Interactive settings UI |
| Medium | `src/utils/config.ts` | Configuration interface |

## CDP Script Editing Rules
This is the most edited file. Special care required:
1. **Always syntax check**: `node -c main_scripts/full_cdp_script.js`
2. **CRLF line endings** — mixed endings cause invisible bugs.
3. **No Node.js APIs** — this runs in the browser.
4. **Test changes** by repackaging and installing the VSIX.
5. **Never use patch scripts** — edit the file directly to avoid race conditions.

## Version Protocol
Every build gets a new version. Sync `package.json`, `constants.ts`, and `CHANGELOG.md`. Include version in commit message.
