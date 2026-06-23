# Brave Origin Browser Control

This optional Linux feature targets Codex browser control at Brave Origin
Nightly and the official Codex Chrome Web Store extension:

```text
hehggadaopoacecdllhhajmbjkdcmajg
```

It is disabled by default. Enable it when the browser-control target is Brave
Origin Nightly instead of stable Brave, Chrome, Chromium, or the system default
browser:

```json
{
  "enabled": [
    "brave-origin-browser-control"
  ]
}
```

When enabled, the feature:

- adds Brave Origin Nightly native-messaging manifest locations for the
  generated launcher
- patches the staged Chrome plugin scripts to detect Brave Origin Nightly
  installs, profiles, running processes, default-browser desktop IDs, and launch
  commands
- adds Brave Origin Nightly to the Electron-side Chrome extension
  settings/status helper
- fails the build when the enabled feature cannot find or fully patch the
  staged Chrome plugin

Install the extension in Brave Origin Nightly, then rebuild the app with this
feature enabled so the native host manifest is synchronized into the matching
browser profile root.

For the general browser target guide, supported browser list, setup prompt for
agents, and limitations, see [Browser Control](../../docs/browser-control.md).

Run the focused tests with:

```bash
node --test linux-features/brave-origin-browser-control/test.js
```

After building a side-by-side app, verify the built artifact and
live Brave Origin wiring without launching or replacing the installed app:

```bash
scripts/workstation/verify-browser-control.sh
```

The verifier also launches Brave Origin Nightly with a temporary profile to
exercise CDP `Page.captureScreenshot`. Set
`CODEX_BROWSER_CONTROL_SKIP_CDP_SCREENSHOT=1` only when the current environment
cannot launch the browser.

`scripts/workstation/build-dev.sh` runs this verification automatically after a
successful side-by-side build.

The extension backend has additional cross-browser API constraints, including
invisible `target="_blank"` tabs and snapshot-scoped locators. See
[Browser Control](../../docs/browser-control.md#backend-constraints).
