# Auto-Update Manager

Default native packages install `codex-update-manager`, a companion
`systemd --user` service.

It:

- checks upstream `Codex.dmg` on daemon startup, every 6 hours, and in the
  background on app launch when stale
- rebuilds a local native package with `/opt/codex-desktop/update-builder`
- waits for Electron to exit before installing a ready update
- runs unprivileged; the final package install uses the packaged Polkit policy
- first requests graphical authorization with `pkexec --disable-internal-agent`
- if no graphical Polkit agent can authenticate, opens a terminal and retries
  the same constrained Polkit action with its text authentication agent
- keeps package paths as separate process arguments and never stores passwords
- performs best-effort Codex CLI preflight from the launcher
- validates required upstream patch points before publishing a rebuilt package
- keeps the existing install active when a required patch drifts
- records the complete rebuild error chain and log path in updater status

The resident updater is included in native Debian/Ubuntu, Fedora/openSUSE, and
Arch-family packages. AppImage builds do not include it.

Native package post-install hooks reload the user service manager and restart an
already-running updater daemon so the newly installed updater binary takes
effect immediately.

The launcher hashes installed build metadata. After a package changes, it
clears only disposable Electron caches (`Cache`, `Code Cache`, `GPUCache`, and
`DawnCache`) before loading the new webview assets. User profile data, chats,
cookies, and settings are not removed. Cold launches also run Electron in its
own process session and terminate surviving app-server or plugin descendants
after Electron exits, preventing an old process from retaining browser/CDP
ports across updates.

## Normal Update Flow

Most users only need to choose **Update** in Codex Desktop, or close the app when
the ready notification appears. The updater installs the rebuilt package and
reopens Codex Desktop after authorization succeeds.

The same flow is available from a terminal:

```bash
codex-update-manager check-now
codex-update-manager status
codex-update-manager install-ready
```

`install-ready` does not install over a running app. It records that installation
should continue after Codex Desktop exits. A minimal window-manager session does
not need a separately installed graphical Polkit agent as long as a supported
terminal emulator is available. The fallback recognizes `xdg-terminal-exec`,
Debian's `x-terminal-emulator`, GNOME Terminal, Console, Ptyxis, Konsole, Kitty,
Alacritty, WezTerm, Foot, and XTerm.

If neither graphical authorization nor a terminal can be opened, the package
remains ready. `codex-update-manager status` prints the exact recovery command,
using `install-deb`, `install-rpm`, or `install-pacman` for the detected package.

If a rebuild fails before a package is ready, inspect `status` first. Current
builds include the workspace log path in `update_error`; fixing the reported
patch drift and running `check-now` is preferable to deleting updater state.

## Inspect State

```bash
systemctl --user status codex-update-manager.service
codex-update-manager status --json
sed -n '1,160p' ~/.local/state/codex-update-manager/state.json
sed -n '1,160p' ~/.local/state/codex-update-manager/service.log
```

Runtime files:

```text
~/.config/codex-update-manager/config.toml
~/.local/state/codex-update-manager/state.json
~/.local/state/codex-update-manager/service.log
~/.cache/codex-update-manager/
~/.cache/codex-desktop/launcher.log
~/.local/state/codex-desktop/app.pid
```

The update package stays under `~/.cache/codex-update-manager/workspaces/` until
installation succeeds or a newer candidate supersedes it.

## Rollback

If a rebuilt update installs but the previous retained package was better,
close Codex Desktop and run:

```bash
codex-update-manager rollback
```

Rollback uses the last retained known-good package and refuses to run when no
rollback package is available.

## Manual-Update Packages

Build a native package without the resident updater:

```bash
PACKAGE_WITH_UPDATER=0 make package
make install
```

That package omits `codex-update-manager`, the user service unit, updater
polkit policy, `/opt/codex-desktop/update-builder`, desktop updater actions,
and launcher updater startup checks.

Installing a no-updater package over a default package also stops and disables
existing `codex-update-manager.service` instances for active user managers and
removes stale per-user enablement links for inactive users.

Manual updates should come from a checkout you trust:

```bash
PACKAGE_WITH_UPDATER=0 make update-native
```

`make update-native` runs `git pull --ff-only`, regenerates `codex-app/` from a
fresh upstream `Codex.dmg`, builds the native package, and installs it.

## Service Controls

```bash
make service-enable
make service-status
codex-update-manager status --json
```

`make service-enable` is meant for installed packages, not repo-only generated
apps.

## Wrapper Updates

Optional wrapper-update tracking can watch this repository's own Linux wrapper
changes with:

```toml
enable_wrapper_updates = true
```

in `~/.config/codex-update-manager/config.toml`.

This is intended for git-checkout/dev update-builder installs. Frozen
native-package builders without a `.git` directory report no wrapper candidate
and receive wrapper changes through normal package upgrades.
