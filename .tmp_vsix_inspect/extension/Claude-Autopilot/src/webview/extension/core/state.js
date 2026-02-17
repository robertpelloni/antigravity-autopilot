// Global state management for the Claude Autopilot extension
// Centralized store for all application state

// VS Code API reference
const vscode = acquireVsCodeApi();

// Core application state
let messageQueue = [];
let sessionState = {
  isSessionRunning: false,  // Claude session/process is active
  isProcessing: false,      // Currently processing messages
  wasStopped: false,        // User manually stopped processing
  justStarted: false        // Just clicked start (prevent backend override)
};
let historyData = [];
let draggedIndex = -1;
let allowDangerousXssbypass = false;

// Terminal output state
let debugTerminalContent = '';

// Claude output state
let claudeContent = '';
let lastRenderedContent = '';
let pendingClaudeOutput = null;
let claudeRenderTimer = null;
let lastClaudeRenderTime = 0;
let lastParsedContent = '';
let lastParsedHtml = '';
let lastContentHash = '';
// Dynamic throttling: slower in development mode to reduce overhead
function getClaudeRenderThrottleMs() {
  return isDevelopmentMode ? 1000 : 500; // 1s in dev mode, 500ms in normal mode
}
const CLAUDE_RENDER_THROTTLE_MS = 500; // Fallback for static imports

// File autocomplete state
let fileAutocompleteState = {
  isOpen: false,
  query: '',
  selectedIndex: 0,
  files: [],
  atPosition: -1,
  pagination: null,
  currentPage: 0,
  isLoading: false,
  pageScrollHandler: null
};

// Development mode state
let isDevelopmentMode = false;

// Web interface state
let webServerStatus = {
  running: false,
  url: '',
  isExternal: false,
  hasPassword: false,
  blockedIPs: 0
};

// ANSI Color palette for 256-color mode
const ansiColors = {
  // Standard colors (0-15)
  0: '#000000', 1: '#cd0000', 2: '#00cd00', 3: '#cdcd00', 4: '#0000ee', 5: '#cd00cd', 6: '#00cdcd', 7: '#e5e5e5',
  8: '#7f7f7f', 9: '#ff0000', 10: '#00ff00', 11: '#ffff00', 12: '#5c5cff', 13: '#ff00ff', 14: '#00ffff', 15: '#ffffff',
  // More colors including common Claude colors
  52: '#5f0000', 88: '#870000', 124: '#af0000', 160: '#d70000', 196: '#ff0000',
  114: '#87d787', 118: '#87ff00', 148: '#afd700', 154: '#afff00', 190: '#d7ff00',
  174: '#d787af', 175: '#d787d7', 176: '#d787ff', 177: '#d7af5f', 178: '#d7af87',
  179: '#d7afaf', 180: '#d7afd7', 181: '#d7afff', 182: '#d7d75f', 183: '#d7d787',
  184: '#d7d7af', 185: '#d7d7d7', 186: '#d7d7ff', 187: '#d7ff5f', 188: '#d7ff87',
  189: '#d7ffaf', 190: '#d7ffd7', 191: '#d7ffff', 192: '#ff5f5f', 193: '#ff5f87',
  194: '#ff5faf', 195: '#ff5fd7', 196: '#ff5fff', 197: '#ff875f', 198: '#ff8787',
  199: '#ff87af', 200: '#ff87d7', 201: '#ff87ff', 202: '#ffaf5f', 203: '#ffaf87',
  204: '#ffafaf', 205: '#ffafd7', 206: '#ffafff', 207: '#ffd75f', 208: '#ffd787',
  209: '#ffd7af', 210: '#ffd7d7', 211: '#ffd7ff', 212: '#ffff5f', 213: '#ffff87',
  214: '#ffffaf', 215: '#ffffd7', 216: '#ffffff',
  // Claude specific colors
  220: '#ffd700', 231: '#ffffff', 244: '#808080', 246: '#949494',
  // Grays and commonly used colors
  232: '#080808', 233: '#121212', 234: '#1c1c1c', 235: '#262626', 236: '#303030', 237: '#3a3a3a',
  238: '#444444', 239: '#4e4e4e', 240: '#585858', 241: '#626262', 242: '#6c6c6c', 243: '#767676',
  244: '#808080', 245: '#8a8a8a', 246: '#949494', 247: '#9e9e9e', 248: '#a8a8a8', 249: '#b2b2b2',
  250: '#bcbcbc', 251: '#c6c6c6', 252: '#d0d0d0', 253: '#dadada', 254: '#e4e4e4', 255: '#eeeeee'
};

// Export all state for use by other modules
export {
  vscode,
  messageQueue,
  sessionState,
  historyData,
  draggedIndex,
  allowDangerousXssbypass,
  debugTerminalContent,
  claudeContent,
  lastRenderedContent,
  pendingClaudeOutput,
  claudeRenderTimer,
  lastClaudeRenderTime,
  lastParsedContent,
  lastParsedHtml,
  lastContentHash,
  CLAUDE_RENDER_THROTTLE_MS,
  getClaudeRenderThrottleMs,
  fileAutocompleteState,
  isDevelopmentMode,
  webServerStatus,
  ansiColors
};

// State update functions
export function updateMessageQueue(queue) {
  messageQueue = Array.isArray(queue) ? queue : [];
}

export function updateSessionState(updates) {
  Object.assign(sessionState, updates);
}

export function updateHistoryData(history) {
  historyData = history;
}

export function updateFileAutocompleteState(updates) {
  Object.assign(fileAutocompleteState, updates);
}

export function getFileAutocompleteState() {
  return fileAutocompleteState;
}

export function updateWebServerStatus(status) {
  webServerStatus = status;
}

export function setAllowDangerousXssbypass(value) {
  allowDangerousXssbypass = value;
}

export function setIsDevelopmentMode(value) {
  isDevelopmentMode = value;
}

export function setDraggedIndex(index) {
  draggedIndex = index;
}

export function getDraggedIndex() {
  return draggedIndex;
}

// Claude output state management
export function setClaudeContent(content) {
  claudeContent = content;
}

export function setLastRenderedContent(content) {
  lastRenderedContent = content;
}

export function setPendingClaudeOutput(output) {
  pendingClaudeOutput = output;
}

export function setClaudeRenderTimer(timer) {
  claudeRenderTimer = timer;
}

export function setLastClaudeRenderTime(time) {
  lastClaudeRenderTime = time;
}

export function setLastParsedContent(content) {
  lastParsedContent = content;
}

export function setLastParsedHtml(html) {
  lastParsedHtml = html;
}

export function setLastContentHash(hash) {
  lastContentHash = hash;
}

// Terminal output state management
export function setDebugTerminalContent(content) {
  debugTerminalContent = content;
}

export function appendDebugTerminalContent(content) {
  debugTerminalContent += content;
}

export function getDebugTerminalContent() {
  return debugTerminalContent;
}

// Getters for Claude output state
export function getClaudeContent() {
  return claudeContent;
}

export function getLastRenderedContent() {
  return lastRenderedContent;
}

export function getPendingClaudeOutput() {
  return pendingClaudeOutput;
}

export function getClaudeRenderTimer() {
  return claudeRenderTimer;
}

export function getLastClaudeRenderTime() {
  return lastClaudeRenderTime;
}

export function getLastParsedContent() {
  return lastParsedContent;
}

export function getLastParsedHtml() {
  return lastParsedHtml;
}

export function getLastContentHash() {
  return lastContentHash;
}

// Reset functions for clearing state
export function resetClaudeOutputState() {
  claudeContent = '';
  lastRenderedContent = '';
  lastParsedContent = '';
  lastParsedHtml = '';
  lastContentHash = '';
  pendingClaudeOutput = null;
  if (claudeRenderTimer) {
    clearTimeout(claudeRenderTimer);
    claudeRenderTimer = null;
  }
  lastClaudeRenderTime = 0;
}

export function resetTerminalOutputState() {
  debugTerminalContent = '';
}