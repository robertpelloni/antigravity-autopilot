# copilot-auto-continue

A tiny console snippet that automatically clicks the **Continue** button in GitHub Copilot Chat Agent Mode, so you can keep your workflow moving without manual approval.

## Description

When using Copilot’s **Agent Mode**, every action (even harmless ones like `git status`) prompts you to click **Continue**. This snippet removes that friction by auto‑clicking the button as soon as it appears—no more endless taps!
![image](https://github.com/user-attachments/assets/b66a5766-bd1c-4e44-a33c-6006904209e9)

## ⚠️ Important: Script Persistence

**Scripts pasted into the Developer Console are NOT saved and will be lost when you restart VS Code.**

### For Permanent Auto-Loading (Recommended)

Use the [**Custom CSS and JS Loader**](https://marketplace.visualstudio.com/items?itemName=be5invis.vscode-custom-css) extension to automatically load your script on every VS Code startup:

1. Install the extension from the marketplace
2. Save the script to a `.js` file
3. Configure the extension to load your file
4. Enable custom CSS/JS and restart

This way, the auto-continue functionality will work immediately every time you open VS Code!

---

## Installation

### Console Paste Method (Temporary)

1. Open **VS Code** (Desktop or Web).  
2. Go to **Help → Toggle Developer Tools**.  
3. Switch to the **Console** tab, type:
   ```js
   allow pasting
   ```
   and press Enter.  
4. Paste the snippet below into the console and hit Enter:

```js
(function(){
  const COOLDOWN_MS = 2500;
  let lastClick = 0;

  function clickIfFound() {
    const now = Date.now();
    if (now - lastClick < COOLDOWN_MS) return;

    // Continue
    const continueBtn = Array.from(
      document.querySelectorAll('a.monaco-button[role="button"], button.monaco-button')
    ).find(el => /continue/i.test(el.textContent?.trim()));
    if (continueBtn) {
      continueBtn.click();
      lastClick = now;
      console.log('[auto] Clicked Continue');
    }

    // Keep
    const keepBtn = Array.from(
      document.querySelectorAll('a.action-label[role="button"]')
    ).find(el => /^keep$/i.test(el.textContent?.trim()));
    if (keepBtn) {
      keepBtn.click();
      lastClick = now;
      console.log('[auto] Clicked Keep');
    }
  }

  const intervalId = setInterval(clickIfFound, 1000);
  const observer   = new MutationObserver(clickIfFound);
  observer.observe(document.body, { childList: true, subtree: true });

  window.stopAutoContinue = () => {
    clearInterval(intervalId);
    observer.disconnect();
    console.log('[auto] stopped.');
  };
})();
```

## Usage

Once pasted, the script immediately begins watching for and clicking the **Continue** button whenever it appears.  

You’ll see logs in your console each time it clicks.

## Stopping

To halt the auto‑clicker at any time, switch to the console and run:

```js
window.stopAutoContinue();
```
