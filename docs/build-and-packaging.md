# Build And Packaging

## Prerequisites

You need:

- `python3`, `7z` or `7zz`, `curl`, `unzip`, `make`, `g++`
- Rust toolchain with `cargo` for `codex-update-manager`,
  `codex-computer-use-linux`, and the Chrome extension host binary

The installer downloads a managed Linux Node.js runtime into
`codex-app/resources/node-runtime` and uses it for `node`, `npm`, and `npx`
during the build. Existing `nvm`, asdf, Volta, NodeSource, or nodejs.org
installs are fine, but no longer required for this project.

Bootstrap dependencies:

```bash
bash scripts/install-deps.sh
```

It detects `apt`, `dnf5`, `dnf`, `pacman`, or `zypper`, installs system
packages, and bootstraps Rust through `rustup` when needed.

## Manual Dependencies

```bash
# Fedora 41+
sudo dnf install python3 7zip curl unzip rpm-build @development-tools

# Fedora < 41
sudo dnf install python3 p7zip p7zip-plugins curl unzip rpm-build
sudo dnf groupinstall 'Development Tools'

# openSUSE
sudo zypper install python3 p7zip-full curl unzip
sudo zypper install -t pattern devel_basis

# Arch / Manjaro
sudo pacman -S --needed python p7zip curl unzip zstd base-devel

# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

On apt-based systems, `scripts/install-deps.sh` can still bootstrap optional
NodeSource Node.js for users who want a system Node.js toolchain:

```bash
bash scripts/install-deps.sh
NODEJS_MAJOR=24 bash scripts/install-deps.sh
```

Ubuntu-family `p7zip-full` can be too old for newer APFS DMGs, so
`install-deps.sh` bootstraps `7zz` into `~/.local/bin` by default.

## Generate The Local App

```bash
make build-app
make build-app-fresh
make build-app DMG=/path/to/Codex.dmg
```

Equivalent direct commands:

```bash
./install.sh
./install.sh /path/to/Codex.dmg
./install.sh --fresh
```

Run the generated app:

```bash
make run-app
./codex-app/start.sh
```

## Running The Generated App

By default, second launches reuse the running app through the Linux warm-start
handoff.

Open an independent app process:

```bash
./codex-app/start.sh --new-instance
```

Configure the port range or make every launch use multi-instance mode:

```bash
CODEX_MULTI_LAUNCH_PORT_RANGE=5175-5199 ./codex-app/start.sh --new-instance
CODEX_MULTI_LAUNCH=1 CODEX_MULTI_LAUNCH_PORT_RANGE=5175-5199 ./codex-app/start.sh
```

## Off-Screen Agent-Browser QA

For UI QA on a workstation you are actively using, run Codex Desktop inside an
isolated Xvfb display and connect `agent-browser` to Electron's Chrome DevTools
Protocol port. This avoids focusing the visible Hyprland/X11 session while
still exercising the real Electron app shell.

```bash
xvfb-run -a -s "-screen 0 1280x900x24" \
  env CODEX_WEBVIEW_PORT=5185 CODEX_MULTI_LAUNCH_PORT_RANGE=5185-5189 \
  /opt/codex-desktop/start.sh --new-instance --x11 -- \
  --remote-debugging-port=9334 \
  --remote-debugging-address=127.0.0.1
```

In another shell:

```bash
AGENT_BROWSER_SESSION=codex-desktop-electron-qa agent-browser connect 9334
AGENT_BROWSER_SESSION=codex-desktop-electron-qa agent-browser snapshot -i
```

Use a fresh `CODEX_WEBVIEW_PORT` and CDP port for each independent QA run.
Do not add `--disable-gpu`; current Electron builds can refuse GPU access and
never expose the debugging target when GPU and software rasterization are both
disabled. Also avoid treating `http://127.0.0.1:<CODEX_WEBVIEW_PORT>` as a
complete substitute for Electron QA: that page can load, but it lacks the
host/preload APIs used by the installed app.

## Package Formats

After `make build-app` or `make build-app-fresh`, build a package from
`codex-app/`:

| Format | Build command | Output | Install |
|---|---|---|---|
| Debian | `make deb` | `dist/codex-desktop_*.deb` | `sudo dpkg -i dist/codex-desktop_*.deb` |
| RPM | `make rpm` | `dist/codex-desktop-*.x86_64.rpm` | `sudo dnf install dist/codex-desktop-*.rpm` or `sudo zypper install dist/codex-desktop-*.rpm` |
| Arch | `make pacman` | `dist/codex-desktop-*.pkg.tar.zst` | `sudo pacman -U dist/codex-desktop-*.pkg.tar.zst` |
| AppImage | `make appimage` | `dist/codex-desktop-*.AppImage` | Run directly |
| Auto-detect | `make package && make install` | matches host distro | handled by `make install` |

Override package version:

```bash
PACKAGE_VERSION=2026.03.24.220723+88f07cd3 make deb
```

The packaging scripts only repackage what is already in `codex-app/`; they do
not download or extract the DMG.

## Custom-Model Package Profile

The public custom-model build is a normal native package generated with a
checked-in feature profile:

```bash
make install-custom-models
```

That command is equivalent to:

```bash
CODEX_LINUX_FEATURES_CONFIG=profiles/custom-models/features.json make install-native
```

It downloads the official upstream app locally, applies the Linux/custom-model
patches, builds the host distro package, and installs it. The profile enables:

- `open-target-discovery`
- `codex-wrapper-updater`
- `custom-model-catalog`

It does not enable `brave-origin-browser-control`; browser target overrides are
local policy choices and should not be part of the public default package.

To build a distributable native package without installing it:

```bash
make package-custom-models
```

The generated artifact lands under `dist/` in the same `.deb`, `.rpm`, or
`.pkg.tar.*` format selected by the host. You can override the feature manifest
for a downstream package with:

```bash
CUSTOM_MODELS_FEATURES_CONFIG=/path/to/features.json make package-custom-models
```

## AppImage Local Self-Build

```bash
make build-app
make appimage
./dist/codex-desktop-*.AppImage
```

The AppImage flow does not include `codex-update-manager`, the systemd user
service, polkit policy, or the native-package update builder.

When upstream Codex Desktop changes:

```bash
git pull --ff-only
make build-app-fresh
make appimage
```

AppImage builds require `appimagetool` on `PATH`, or:

```bash
APPIMAGETOOL=/path/to/appimagetool make appimage
```

## Electron Mirrors

If runtime downloads from GitHub are slow or blocked:

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ make build-app
```

`ELECTRON_HEADERS_URL` is passed to `@electron/rebuild --dist-url` and must
provide both `node-v<version>-headers.tar.gz` and the matching `SHASUMS256.txt`.

## Build Parallelism

```bash
MAX_BUILD_THREADS=8 make build-app-fresh
MAX_BUILD_THREADS=8 make package
MAX_BUILD_THREADS=8 make install-native
```

`MAX_BUILD_THREADS=0` is the default and preserves each tool's automatic
behavior. A nonzero value controls Cargo jobs, native module rebuild jobs,
Debian package compression, pacman package compression, and RPM zstd payload
compression.

## Make Targets

Run:

```bash
make help
```

Common targets:

```bash
make check
make test
make build-updater
make build-app
make build-app-fresh
make bootstrap-native
make install-native
make install-custom-models
make package-custom-models
make update-native
make run-app
make build-dev-app
make run-dev-app
make deb
make rpm
make pacman
make appimage
make package
make install
make service-enable
make service-status
make clean-dist
make clean-state
```
