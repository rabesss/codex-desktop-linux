# Architecture

This repository adapts the upstream macOS Codex Desktop DMG into Linux app and
package artifacts.

## Build Pipeline

1. `install.sh` extracts `Codex.dmg` with `7z` / `7zz`.
2. It detects the Electron version from upstream metadata, with a pinned
   fallback.
3. It extracts and patches `app.asar` with fail-soft Linux compatibility
   patches.
4. It rebuilds native Node modules such as `better-sqlite3` and `node-pty` for
   Linux through `@electron/rebuild`.
5. It downloads a matching Linux Electron runtime.
6. It stages bundled plugins and any enabled optional `linux-features/`.
7. It writes the Linux launcher to `codex-app/start.sh` from
   `launcher/start.sh.template`.
8. Package builders repackage `codex-app/` into `.deb`, `.rpm`,
   `.pkg.tar.zst`, or AppImage artifacts.
9. Default native packages install `codex-update-manager` and a
   `systemd --user` service.

The installer replaces the macOS Electron binary with a Linux build, recompiles
native modules, and removes macOS-only pieces such as Sparkle.

## Patch System

Core Linux compatibility patches live under `scripts/patches/core/`.
Descriptors declare phase, order, target filters, and CI policy. They are
fail-soft unless explicitly marked as required for upstream-build validation.

Optional additions belong under `linux-features/`. Feature descriptor ids are
namespaced in patch reports and are optional by default.

The generic build flow remains fail-soft. The controlled workstation build
uses the stricter `controlled-workstation` report profile, which requires every
applicable, enabled core and feature descriptor and rejects partially applied
descriptors that emitted patch warnings.

## Launcher

The launcher serves extracted webview assets from `content/webview/` on
`127.0.0.1` (`5175` by default, `5176` for the dev app), validates the origin,
then starts Electron.

When installed build metadata changes, the launcher invalidates only
disposable Electron web caches so new hashed asset contents cannot be hidden by
an old cache entry. Electron cold starts use an isolated process session; when
the main process exits, remaining app-server and plugin descendants from that
session are terminated before after-exit update hooks run.

Warm-start launches hand off actions such as `--new-chat` over a Unix-domain
socket instead of spawning a second app process.

Native-package-only launcher behavior, such as desktop-entry hints and default
update-manager startup, lives in:

```text
packaging/linux/codex-packaged-runtime.sh
```

The current evaluation for a future Rust replacement of the local webview
server lives in [webview-server-evaluation.md](webview-server-evaluation.md).

## Chrome Plugin

The build stages the upstream Chrome plugin, patches its Linux compatibility
paths, builds the native messaging host from Rust, and installs browser
manifests for Chrome, Brave, and Chromium.

## Custom Model Integration

Custom models use explicit catalog rows instead of changing the global Codex
provider:

```text
custom catalog JSON or optional codex-shim /api/models
  -> Desktop model picker and thread lifecycle
  -> selected row's model_provider
  -> configured provider endpoint
```

[`rabesss/codex-linux`](https://github.com/rabesss/codex-linux)
owns the Desktop bundle patches. Its `custom-model-catalog` feature merges the
custom catalog and preserves the selected custom model, provider, session
config, and dynamic tools across thread start, fork, and resume.
It also stages a Desktop-only Codex CLI wrapper that launches `codex app-server`
with a merged `model_catalog_json`, so custom context windows, compaction
thresholds, truncation limits, reasoning levels, image support, and verified
tool support reach Codex core instead of only decorating picker labels.

[`rabesss/codex-shim`](https://github.com/rabesss/codex-shim) is the optional
CLIProxyAPI/local-adapter source. It owns a loopback catalog and request
translation for rows that use `codex_shim`, flattens namespaced Desktop tools
for OpenAI-chat and Anthropic-compatible providers, then restores namespace and
child-name fields in returned calls so Codex can dispatch them.
The shared catalog owns clean `display_name` values, provider provenance in
`provider_display_name`, and visible-row de-duplication for matching provider
plus display labels.

Official rows bypass both local services and continue to use
`model_provider = "openai"`. This is an architectural invariant, not a setup
preference.

## Validation

Run the subset that matches your change. For installer, packaging, patcher, or
updater changes:

```bash
bash -n install.sh scripts/lib/*.sh launcher/start.sh.template scripts/build-deb.sh scripts/build-rpm.sh scripts/build-pacman.sh scripts/build-appimage.sh scripts/install-deps.sh
node --check scripts/patch-linux-window-ui.js
node --test scripts/patch-linux-window-ui.test.js
node --test linux-features/*/test.js
bash tests/scripts_smoke.sh
cargo check -p codex-update-manager
cargo test -p codex-update-manager
cargo check -p codex-computer-use-linux
cargo test -p codex-computer-use-linux
make package
```

For contribution policy and review expectations, see [CONTRIBUTING.md](../CONTRIBUTING.md).
