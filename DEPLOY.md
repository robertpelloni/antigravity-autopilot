# Antigravity Autopilot: Deployment & Packaging Guide

This document contains the authoritative steps for building, packaging, and installing the Antigravity Autopilot extension.

## 1. Version Bumping Protocol

Before deploying, **you must ensure the version is perfectly synced** in three places:
1. `package.json` -> `"version"` field
2. `main_scripts/full_cdp_script.js` -> runtime version metadata/toast string (e.g. `Antigravity vX.Y.Z Active 🚀`)
3. `CHANGELOG.md` -> Add a new header `## [x.y.z] - YYYY-MM-DD`

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
