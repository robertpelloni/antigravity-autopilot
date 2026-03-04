# Fork Compatibility Matrix & Historical Selectors

This document preserves the hard-earned DOM parsing heuristics required for different IDE forks (`antigravity`, `cursor`, `vscode`). 

As of the "Autopilot Core Simplification", the system has entirely moved away from brittle DOM manipulation towards **Native VS Code Command Execution**. 

## 1. The Unified Native Command Strategy
Instead of scraping the webview for "Run" or "Accept" buttons, Autopilot now intercepts React/CDP state events at the lowest level (`Runtime.bindingCalled`) and invokes the corresponding native VS Code commands. This guarantees fork compatibility because the commands are registered at the Extension Host level.

### Command Execution Map:
- **Run**: `workbench.action.terminal.chat.runCommand` (VS Code) + `antigravity.terminalCommand.run` (Antigravity SDK)
- **Expand**: `workbench.action.terminal.chat.viewInEditor` (VS Code) + `antigravity.command.accept` (Antigravity SDK)
- **Accept / Keep**: `antigravity.agent.acceptAgentStep`
- **Retry**: `antigravity.agent.rejectAgentStep`
- **Bump (Text Entry)**: `antigravity.sendTextToChat`

*(Note: Native standard commands like `interactive.acceptChanges` or `chat.open` were observed to trigger layout configurations on the Antigravity fork, and are strictly avoided).*

---

## 2. Legacy DOM Profiles (Preserved for Reference)

The following selectors were historically used by `auto-continue.ts` before being ripped out in favor of structural state probes:

### Antigravity, Cursor, and VS Code (Unified Selectors)
- **Root Containers:**
  `.interactive-input-part, .chat-input-widget, .interactive-editor, .chat-editing-session-container, .aichat-container, [data-testid*="chat" i], [data-testid*="composer" i], [class*="chat" i], [class*="composer" i], [class*="interactive" i], .chat-input-container, .monaco-editor`
- **Input Fields (Textareas & Editor inputs):**
  `textarea, .monaco-editor textarea, [contenteditable="true"], [role="textbox"], [aria-label*="chat" i], [placeholder*="message" i], [placeholder*="ask" i], [id*="chat-input" i]`
- **Send Buttons / Submit:**
  `[title*="Send" i], [aria-label*="Send" i], [title*="Send message" i], [aria-label*="Send message" i], [title*="Submit" i], [aria-label*="Submit" i], [title*="Continue" i], [aria-label*="Continue" i], [data-testid*="send" i], [data-testid*="submit" i], [class*="send-button" i], [class*="chat-submit" i], button[type="submit"], .codicon-send`
- **Generating Indicators (Stop Buttons & Activity spinners):**
  `[title*="Stop" i], [aria-label*="Stop" i], .codicon-loading, .typing-indicator`

### Blocked Surfaces & Chrome
- **Blocked Chrome Ancestors:**
  `.part.titlebar, .part.activitybar, .part.statusbar, .menubar, .monaco-menu, [role="menu"], [role="menuitem"], [role="menubar"], .settings-editor, .extensions-viewlet`
- **Terminal Blacklist:**
  `.terminal-instance, .terminal-wrapper, .xterm, [data-testid*="terminal" i], [class*="terminal" i]`
- **Additional Exclusions (from interaction-methods.ts):**
  - Node attributes containing: `open in`, `view as`, `attach a file`, `attach context`, `add context`
  - Ancestor classes: `.chat-header`, `.welcome-view`, `.notifications-center`

### Action Detection Regexes
- **Run/Execute**: `/(^|\b)(run(\s+in\s+terminal|\s+command)?|execute)(\b|$)/i`
- **Expand/Requires Input**: `/(expand|requires\s*input|step\s*requires\s*input)/i`
- **Always Allow**: `/(always\s*allow|always\s*approve)/i`
- **Retry**: `/\bretry\b/i`
- **Accept All**: `/(accept\s*all|apply\s*all|accept\s*all\s*changes|apply\s*all\s*changes)/i`

## 3. Terminal Auto-Execute
The patched implementation now directly rewrites the `IWorkspaceConfiguration` for `terminal.integrated.shellIntegration.suggestAlwaysProceed`, removing the need for DOM terminal traversal logic.
