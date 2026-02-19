# Antigravity Autopilot: Project Vision (v5.0.16)

## Ultimate Goal
To evolve **Antigravity Autopilot** from a highly configurable IDE macro-clicker into a **fully autonomous, multi-modal Agent Orchestrator**. Antigravity will serve as the localized "Yoke" of the user's development environment, seamlessly connecting natively-sandboxed AI tools (GitHub Copilot, Cursor AI, local LLMs) with real execution frameworks (MCP, Node, Chromium).

## Core Pillars

### 1. The Autonomous Orchestrator ("Yoke")
Just as a yoke connects oxen to pull an entire plow, Antigravity networks isolated AI chats into a localized, persistent work engine.
- **Unified Control**: The Antigravity extension runs a continuous event loop (`autonomous-loop.ts`). It doesn't just wait for user input; it observes idle intervals, stuck UI states, and compilation errors, and autonomously prompts the active IDE LLM to fix the issue.
- **Deep Memory**: By implementing a local `MemoryManager` reading from `~/.gemini/antigravity/brain`, the AI establishes context continuity across VS Code window reloads and session drops.

### 2. Deep Integration via CDP (Chrome DevTools Protocol)
- **Subverting Sandbox Limitations**: Standard VS Code Extension APIs deliberately sandbox extensions, hiding the DOM. Antigravity connects to port `9000` to execute `main_scripts/full_cdp_script.js` directly inside the Chromium render thread.
- **Micro-Automation**: This script precisely targets invisible `.monaco-list-row` DOM elements to force "Accept", "Run", or "Expand" buttons without human interaction, overcoming the native LLM's inability to actuate its own UI.

### 3. Agentic & Tool Federation (Phase 5.1+)
- **MCP Server integration**: Antigravity is not just an executor; it broadcasts an MCP layer (`src/modules/mcp/server.ts`) so *other* AI agents can command it.
- **Voice Control**: The foundation is laid in `src/modules/voice/control.ts` to allow hands-free "intent routing," parsing transcripts into strict Extension commands.

### 4. Smart Self-Correction & Watchdogs
- **Deterministic Escaping**: Replacing simplistic "blind tick" loops with the newly configured `RuntimeStatus` evaluation. The watchdog monitors for `pendingAccept` or `waiting_for_chat_message` states, ensuring it never bumps an LLM that is actively generating logic.

## Roadmap to Singularity (Phase 5.1)
1. **The Orchestrator Awakening**: Connect `AgentOrchestrator` to read from a master `task.md` checklist and map out its own workflow.
2. **Persistent Context**: Wire `MemoryManager` to funnel actual errors caught by the CDP script back into the extension to dynamically update the agent on what failed.
3. **Robust Text Interface**: Move beyond `submit` to `typeAndSubmit()`, letting Antigravity inject "Fix line 43" instead of just "continue."
4. **LLM Agnosticism Hand-off**: Enable Antigravity to generate `HANDOFF.md` summaries automatically and switch from Gemini (planning) to Claude (refactoring) mid-stream.
