module.exports = [
  {
    // ES6 modules (most files in web/js/)
    files: ["src/webview/web/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        navigator: "readonly",
        URLSearchParams: "readonly",
        confirm: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly"
      }
    },
    rules: {
      "indent": ["error", 4],
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-unused-vars": "warn",
      "no-console": "warn",
      "no-undef": "error"
    }
  },
  {
    // Script files (extension/script.js and others)
    files: ["src/webview/extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        acquireVsCodeApi: "readonly",
        navigator: "readonly",
        URLSearchParams: "readonly",
        confirm: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly"
      }
    },
    rules: {
      "indent": ["error", 4],
      "quotes": ["error", "single"],
      "semi": ["error", "always"],
      "no-unused-vars": "warn",
      "no-console": "warn",
      "no-undef": "error"
    }
  }
];