# Active Agents & Modules

## 1. The Core Extension (Antigravity)
- **Role**: The Host / Orchestrator.
- **Responsibilities**:
  - Manages the lifecycle of all other strategies.
  - Hosting the Dashboard UI (`dashboard.ts`).
  - Managing Configuration (`config.ts`).
  - Connecting to the CDP Port (`cdp-handler.ts`).

## 2. The CDP Strategist (`cdp-strategy.ts`)
- **Role**: The Browser Automation Expert.
- **Capabilities**:
  - Connects to `localhost:9xxx` to control the VS Code Window.
  - Injects `auto-continue.ts` into the renderer process.
  - Polling DOM state for "Accept", "Run", "Chat Input" elements.
  - Executing "Hybrid Bumps" (typing + clicking submit).

## 3. The Auto-Continue Agent (`auto-continue.ts`)
- **Role**: The Injected Field Agent.
- **Location**: Runs *inside* the VS Code renderer process (browser context).
- **Behavior**:
  - Extremely fast polling (800ms) for UI elements.
  - Aggressive clicking of "Run in Terminal" and "Accept" buttons.
  - "Auto-Reply" functionality to keep the conversation going.
  - **Self-Preservation**: It detects if it has been disconnected and attempts to re-hook.

## 4. The Voice Module (`modules/voice/`)
- **Role**: The Auditory Interface.
- **Status**: *Under Construction / Stubbed*.
- **Plan**: Implement local whisper integration or browser-based Speech API for seamless voice commands.

## 5. The Interaction Registry (`interaction-methods.ts`)
- **Role**: The Tool Belt.
- **Function**: A library of atomic actions (click, type, submit) that can be swapped out based on the user's "UiProfile" (VS Code vs Cursor vs Antigravity).

## 6. The Watchdogs
- **Role**: Reliability Engineers.
- **Logic**: 
  - `BlindBumpHandler`: Dumb interval-based keep-alive.
  - *Planned*: `SmartResumeHandler`: State-aware keep-alive based on DOM text analysis.

---
*Maintained by Antigravity System*
