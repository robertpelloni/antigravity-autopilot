# Project Vision — Antigravity Autopilot

## Mission Statement

**Antigravity Autopilot** is the definitive autonomous AI coding assistant for VS Code and Cursor. It transforms the developer experience from constant context-switching into a seamless human–AI collaboration where the developer architects, reviews, and guides while the AI implements, verifies, and iterates.

> *"The developer is the pilot. The AI is the engine. Antigravity is the autopilot."*

---

## Core Principles

### 1. Autonomy
The agent executes multi-step reasoning, planning, and implementation without constant hand-holding. It detects errors, attempts fixes, retries with backoff, and only escalates to the human when truly stuck. The "auto-bump" system keeps conversations alive even when the developer walks away.

### 2. Immersiveness
The agent lives **inside** the IDE. It sees what you see — File Explorer, Terminal, Editor tabs, Chat panels. It interacts naturally via CDP (Chrome DevTools Protocol), clicking buttons, typing messages, and reading DOM state. No external tools, no separate browser windows.

### 3. Robustness
Unlike fragile UI scripts, Antigravity uses CDP to interface directly with the IDE's Chromium core. The `isAcceptButton()` filter system uses configurable accept/reject patterns. The `isCommandBanned()` system prevents dangerous command execution. Circuit breakers prevent runaway loops.

### 4. Configurability
Every developer has a unique workflow. Every setting is exposed in the interactive Dashboard and VS Code settings:
- Which buttons to click (accept patterns) and which to avoid (reject patterns, banned commands)
- How fast to loop (poll frequency, thread wait interval)
- What to say when idle (bump message) and how often (auto-approve delay)
- Which AI models to prefer for different task types
- CDP connection parameters (port, timeout)

### 5. Transparency
The user always knows what the agent is doing. Status bar indicators, output channel logging with `[Tags]`, and visual overlays provide real-time feedback. "Magic" is good; "mystery" is bad.

---

## The Unified Architecture

Antigravity Autopilot consolidates **9 separate projects** into one coherent extension:

| Original Project | Key Feature Extracted | Status |
|:-----------------|:---------------------|:-------|
| AUTO-ALL-AntiGravity | CDP multi-tab auto-clicker, background mode | ✅ Merged |
| antigravity-auto-accept | Simple command-based auto-accept | ✅ Merged |
| auto-accept-agent | CDP auto-accept variant | ✅ Merged |
| yoke-antigravity | Autonomous loop, MCP, voice control, project manager | ✅ Merged |
| free-auto-accept-antigravity | Community auto-accept patterns | ✅ Referenced |
| AntiBridge-Antigravity-remote | Remote bridge for multi-machine | 📋 Referenced |
| AntigravityMobile | Mobile companion concept | 📋 Referenced |
| antigravity-jules-orchestration | Jules API + MCP orchestration | 📋 Referenced |
| antigravity-multi-purpose-agent | Multi-purpose agent variant | 📋 Referenced |

---

## Roadmap

### Phase 1: Foundation ✅ *(v4.0.0)*
- Unified extension architecture
- CDP + Simple strategy pattern
- Basic auto-click loop with configurable patterns
- Interactive Dashboard (WebView)
- Relauncher for CDP port activation

### Phase 2: Reliability ✅ *(v4.0.1 → v4.1.8)*
- Full codebase audit (29 files, 24 settings verified)
- 5 missing commands registered
- Circuit breaker singleton fix
- CDP client hardening (real DOM polling, model switching)
- Banned commands + accept/reject pattern system
- Extensions viewlet safety (no clicking in Extensions sidebar)
- Collapsed section expansion (find hidden Run buttons)

### Phase 3: Autonomy ✅ *(v4.1.9 → v4.2.0)*
- **Auto-bump system**: `isConversationIdle()` + `autoBump()` with configurable cooldown
- **Multi-strategy submission**: Enter → Alt+Enter → Ctrl+Enter → send button fallback
- **Config pipeline**: All bump/timing settings flow from Dashboard → config → CDP → browser state
- **Dashboard controls**: Bump message, cooldown, thread wait, poll frequency all configurable

### Phase 4: Intelligence *(Next)*
- **Memory Manager**: Long-term semantic memory of actions (successes/failures)
- **Context injection**: Relevant memories appended to prompts
- **Learning**: Agent improves strategies based on user corrections

### Phase 5: Multi-Agent *(Future)*
- **Swarm Mode**: Multiple specialized agents (Architect, Coder, Tester) working in parallel
- **Voice interface**: Natural language conversation for architectural discussions
- **Remote collaboration**: Multi-machine coordination via AntiBridge
- **Mobile companion**: Monitor and control from AntigravityMobile

### Phase 6: Ecosystem *(Vision)*
- **Jules orchestration**: Full integration with Google Jules for PR-level autonomy
- **MCP federation**: Connect to external MCP servers for expanded tool access
- **Marketplace**: Shareable agent configurations and automation profiles

---

## Design Philosophy

### "Click What You'd Click"
The auto-clicker should only click buttons the developer would click themselves. The `isAcceptButton()` → `isCommandBanned()` → `isRejectButton()` pipeline ensures safe, predictable automation.

### "Bump When Idle"
When the AI conversation stalls (Good/Bad feedback visible, no pending buttons), the auto-bump system sends a configurable message to restart the flow. This enables true "walk away" autonomy.

### "Fail Loud, Not Silent"
Every CDP operation is wrapped in try/catch with detailed logging. Circuit breakers prevent infinite loops. Max-loops-per-session enforces hard limits. The developer always knows what happened and why.
