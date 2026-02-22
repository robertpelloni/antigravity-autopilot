# Antigravity Autopilot: Deployment & Packaging Guide

This document contains the authoritative steps for building, packaging, and installing the Antigravity Autopilot extension.

## 1. Version Bumping Protocol

Before deploying, ensure release version is synced in **all active version markers**:
1. `package.json` → `"version"`
2. `src/utils/constants.ts` → `EXTENSION_VERSION`
3. `main_scripts/full_cdp_script.js` → `ANTIGRAVITY_VERSION` and startup toast string
4. `CHANGELOG.md` → top entry `## [x.y.z] - YYYY-MM-DD`

Recommended sequence:
- Apply code/docs changes
- Bump version markers
- Add changelog entry
- Run validation and package

## 2. Compilation and Release

We execute compilation, linting, testing, and packaging via a single unified command:

```bash
npm run verify:release
```

For policy-hardened release validation (audit policy + release gate), run:

```bash
npm run verify:release:secure
```

**What this script does:**
- Runs `esbuild` to compile `src/extension.ts` into `dist/extension.js`.
- Runs `eslint` on the `src/` directory.
- Runs the Node.js built-in test suite (`node --test`, via `npm test`).
- Runs `vsce package` to bundle the `.vsix` file.
- Outputs the generated VSIX file name, SHA256 checksum, and file size.

## 2.1 Fast Validation During Iteration

Use this flow before full release packaging when iterating quickly:

1. `node --test tests/panel-click-guard.test.js tests/remote-server-security.test.js`
2. `node -c main_scripts/full_cdp_script.js`
3. `npm run compile`
4. `npm run lint`
5. `npm run package`

## 3. Installation Scenarios

### Installing in VS Code
You can install the generated VSIX file directly via CLI:
```bash
code --install-extension antigravity-autopilot-<VERSION>.vsix
```

### Installing in Cursor (Critical Deviation)
If using Cursor, running `code --install-extension` will mistakenly install it into vanilla VS Code's extension directory. You MUST run:
```bash
cursor --install-extension antigravity-autopilot-<VERSION>.vsix
```
*Alternatively: Drag-and-drop the `.vsix` file from your system File Explorer directly into the Extensions sidebar in Cursor.*

### Reloading
Always run the VS Code Command: `Developer: Reload Window` after installing a new version to ensure the old VSIX instance is evicted from memory.

## 4. Debugging Activation Crashes

If commands like `command 'antigravity.showStatusMenu' not found` occur immediately after window boot:
1. Check `~/antigravity-activation.log` (in your user home directory). The extension is wrapped in a fatal-level try/catch that dumps native load errors there.
2. Verify you didn't accidentally include Node.js modules (like `fs` or `path`) inside `main_scripts/full_cdp_script.js`.
3. Verify the VSIX was actually successfully applied by opening the Extensions sidebar and checking the Version string.

## 5. Remote Control Security Deployment Checklist

When enabling remote control (`antigravity.remoteControlEnabled`):

1. Keep `antigravity.remoteControlAllowLan=false` unless LAN access is explicitly required.
2. If LAN mode is required, configure `antigravity.remoteControlAllowedHosts` to a strict host/IP allowlist.
3. Verify startup logs indicate expected bind mode (`localhost-only` or `LAN-enabled`).
4. Validate blocked-host behavior before exposing on broader networks.
