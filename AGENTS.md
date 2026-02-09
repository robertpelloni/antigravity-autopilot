# Agent Instructions

> **MASTER PROTOCOL**: Refer to [docs/LLM_INSTRUCTIONS.md](./docs/LLM_INSTRUCTIONS.md) for the complete protocol. **Read that file first.**

## Universal Rules (All Agents)

1. **Version Control**: Every build gets a new version number. Sync `package.json`, `src/utils/constants.ts`, and `CHANGELOG.md`.
2. **Commit Protocol**: `feat: vX.Y.Z - description`. Push after every commit.
3. **Compilation**: Run `npm run compile` after significant changes.
4. **CDP Script Safety**: Run `node -c main_scripts/full_cdp_script.js` after edits. No Node.js APIs allowed in browser context.
5. **Task Tracking**: use `task.md` as the single source of truth. Mark tasks as `[x]` when done.
6. **Autonomous Ops**: Use `ProjectTracker` service for task discovery in autonomous mode.

## Agent Roles

### 1. The Director (Autonomous Loop)
- **Goal**: End-to-end task completion.
- **Mechanism**: Queries `ProjectTracker` -> Selects Model -> Injects Prompt via CDP.
- **File**: `src/core/autonomous-loop.ts`

### 2. The Orchestrator (Multi-Agent)
- **Goal**: Complex task decomposition.
- **Mechanism**: Breaks tasks into JSON subtasks -> Delegates to specific agents.
- **File**: `src/core/agent-orchestrator.ts`

### 3. The Coding Agent (Gemini/Claude)
- **Goal**: Implementation and Refactoring.
- **Mechanism**: Reads `task.md`, edits files, runs tests.

## Documentation Standards
- Update `CHANGELOG.md` for every version.
- Update `DASHBOARD.md` if UI changes.
- Update `VISION.md` if roadmap changes.
