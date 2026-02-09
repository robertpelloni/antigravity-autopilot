# Submodule Reference — Antigravity Autopilot

This document provides detailed documentation for each submodule in the workspace. All submodules are **reference implementations** — the active unified code lives in `src/` and `main_scripts/`.

---

## 1. AUTO-ALL-AntiGravity

| Field | Value |
|:------|:------|
| **Path** | `AUTO-ALL-AntiGravity/` |
| **Origin** | [ai-dev-2024/AUTO-ALL-AntiGravity](https://github.com/ai-dev-2024/AUTO-ALL-AntiGravity) |
| **Language** | JavaScript |
| **Purpose** | The original CDP-based multi-tab auto-accept extension |

### Key Features Extracted
- Multi-tab background mode with automatic tab switching
- CDP connection bootstrapping and auto-reconnection
- `window.__autoAllState` global state pattern
- Analytics system (clicks, verified actions, away mode)
- Visual overlay for status feedback
- `isAcceptButton()` / `isCommandBanned()` filter pipeline

### Why Selected
This was the most feature-complete CDP implementation. Its multi-tab design, analytics system, and robust button detection formed the foundation of the unified `full_cdp_script.js`.

---

## 2. antigravity-auto-accept

| Field | Value |
|:------|:------|
| **Path** | `antigravity-auto-accept/` |
| **Origin** | [pesoszpesosz/antigravity-auto-accept](https://github.com/pesoszpesosz/antigravity-auto-accept) |
| **Language** | TypeScript |
| **Purpose** | Simple, lightweight command-based auto-accept |

### Key Features Extracted
- `vscode.commands.executeCommand` approach (no CDP restart required)
- Minimal configuration surface
- Fast toggle on/off

### Why Selected
Provides the "Simple Strategy" fallback when CDP isn't available or the user doesn't want to restart their IDE. Quick zero-config auto-accept.

---

## 3. auto-accept-agent

| Field | Value |
|:------|:------|
| **Path** | `auto-accept-agent/` |
| **Origin** | [Munkhin/auto-accept-agent](https://github.com/Munkhin/auto-accept-agent) |
| **Language** | JavaScript/TypeScript |
| **Purpose** | CDP auto-accept variant with agent-like behavior |

### Key Features Extracted
- Alternative CDP connection patterns
- Agent-style state management
- Different button detection heuristics

### Why Selected
Provided cross-reference for CDP implementation patterns and alternative button detection strategies that were merged into `isAcceptButton()`.

---

## 4. yoke-antigravity

| Field | Value |
|:------|:------|
| **Path** | `yoke-antigravity/` |
| **Origin** | [ai-dev-2024/yoke-antigravity](https://github.com/ai-dev-2024/yoke-antigravity) |
| **Language** | TypeScript |
- **Purpose** | Full autonomous agent with MCP, Voice, Project Manager |

### Key Features Extracted
- `AutonomousLoop`: Goal-driven agent loop with task decomposition (Active in `src/core/autonomous-loop.ts`)
- `MemoryManager`: Semantic memory for action persistence
- `MCPServer`: Model Context Protocol tool and resource exposure (Active in `src/modules/mcp/server.ts`)
- `VoiceControl`: Push-to-talk and always-listening modes
- `ProjectManager`: Jira/GitHub task sync
- `AgentOrchestrator`: Multi-agent coordination
- `ModelSelector`: AI model routing by task type
- `TestGenerator`, `CodeReviewer`: Automated quality tools

### Why Selected
The most ambitious submodule — provided the entire `src/core/`, `src/modules/`, and `src/providers/` codebases. Yoke represents the "intelligence layer" that transforms simple auto-clicking into autonomous software development.

---

## 5. free-auto-accept-antigravity

| Field | Value |
|:------|:------|
| **Path** | `free-auto-accept-antigravity/` |
| **Origin** | [RendezvousP/free-auto-accept-antigravity](https://github.com/RendezvousP/free-auto-accept-antigravity) |
| **Language** | JavaScript |
| **Purpose** | Community-maintained free auto-accept |

### Key Features Extracted
- Community-tested button detection patterns
- Lightweight implementation reference

### Why Selected
Reference for community patterns and user-facing simplicity.

---

## 6. AntiBridge-Antigravity-remote

| Field | Value |
|:------|:------|
| **Path** | `AntiBridge-Antigravity-remote/` |
| **Origin** | [linhbq82/AntiBridge-Antigravity-remote](https://github.com/linhbq82/AntiBridge-Antigravity-remote) |
| **Language** | JavaScript |
| **Purpose** | Remote bridge for multi-machine Antigravity operation |

### Future Integration (Phase 5)
- Multi-machine coordination
- Remote session management
- Cross-network CDP tunneling

---

## 7. AntigravityMobile

| Field | Value |
|:------|:------|
| **Path** | `AntigravityMobile/` |
| **Origin** | [AvenalJ/AntigravityMobile](https://github.com/AvenalJ/AntigravityMobile) |
| **Language** | Mobile framework |
| **Purpose** | Mobile companion app for monitoring and control |

### Future Integration (Phase 5)
- Real-time status monitoring from phone
- Remote start/stop control
- Push notifications for agent completions

---

## 8. antigravity-jules-orchestration

| Field | Value |
|:------|:------|
| **Path** | `antigravity-jules-orchestration/` |
| **Origin** | [Scarmonit/antigravity-jules-orchestration](https://github.com/Scarmonit/antigravity-jules-orchestration) |
| **Language** | JavaScript (Node.js) |
| **Purpose** | Full Jules API + MCP orchestration system |

### Architecture
- **Orchestrator**: Node.js MCP server for task lifecycle management
- **Jules API**: Express service for code execution
- **Dashboard**: React web interface ("Mission Control")
- **Infrastructure**: Docker Compose + PostgreSQL + Redis

### Integration Status
- **Agent Orchestrator**: Partially integrated into `src/core/agent-orchestrator.ts` (Phase 18).
- **Jules API**: Remains external for now (Dockerized service).

### Future Integration (Phase 6)
- Jules PR-level autonomy
- MCP federation with external servers
- Orchestrated multi-agent workflows

---

## 9. antigravity-multi-purpose-agent

| Field | Value |
|:------|:------|
| **Path** | `antigravity-multi-purpose-agent/` |
| **Origin** | [rodhayl/antigravity-multi-purpose-agent](https://github.com/rodhayl/antigravity-multi-purpose-agent) |
| **Language** | TypeScript |
| **Purpose** | Multi-purpose agent variant with expanded capabilities |

### Key Features
- Broader agent action set
- Alternative orchestration patterns

### Why Selected
Reference for expanded agent capabilities and alternative approaches to multi-purpose automation.
