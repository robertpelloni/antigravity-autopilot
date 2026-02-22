# Antigravity Autopilot Vision (v5.2.63)

## Product North Star

Antigravity Autopilot should be a **safe, transparent, self-driving IDE operations layer** for AI-assisted coding:

- It must keep work moving when chat UIs stall.
- It must never trigger destructive or unrelated IDE chrome actions.
- It must expose enough telemetry that operators can explain every autonomous decision.

## Core System Design

### 1) Runtime Autonomy Engine

`src/core/autonomous-loop.ts` and related guardrails drive continuous execution:

- task progression
- waiting-state detection
- guarded auto-resume
- escalation/watchdog behavior

Design principle: **autonomy without opacity** (every automated decision should be diagnosable via runtime/state reports).

### 2) CDP + Injected Interaction Layer

`src/services/cdp/cdp-handler.ts` + `main_scripts/full_cdp_script.js` provide browser-surface control where standard extension APIs cannot.

Design principle: **interaction precision over breadth**. Broad selectors and global key/mouse fallbacks are treated as high-risk and must be constrained.

### 3) Strategy + Profile Routing

`src/strategies/` routes behavior across VS Code/Cursor/Antigravity UI profiles.

Design principle: **profile isolation**. Each UI surface should use narrowly-scoped selectors/methods to avoid cross-surface mis-targeting.

### 4) Ecosystem Interfaces

- MCP server/federation for tool interoperability
- embedded remote server (`src/modules/remote/server.ts`)
- mobile/companion integration path

Design principle: **secure-by-default remote control** (localhost-only defaults, explicit allowlist, and progressive auth/permission controls).

## Current Reality (2026-02-22)

### Achieved
- Robust runtime telemetry and diagnostics surfaces
- Runtime waiting/escalation control plane
- CDP hardening against menu/layout ghost interactions
- Embedded remote server with host allowlist baseline

### In Progress
- Dual-fork mixed-environment soak hardening
- Remote control auth/role model
- Documentation/governance synchronization discipline

### Next Strategic Milestones
1. Ship remote auth + role-scoped permissions.
2. Complete mobile telemetry integration with safe command channel.
3. Introduce single-source version governance and drift-proof CI checks.

## Non-Negotiables

- Safety > speed when interaction confidence is low.
- Every release updates version markers and changelog in lockstep.
- TODO/ROADMAP/HANDOFF must reflect code truth, not aspiration.
