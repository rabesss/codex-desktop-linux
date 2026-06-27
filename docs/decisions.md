# Decision Log

This log records direction-level choices for Codex Desktop Linux. Decisions are
append-only. If a decision changes, add a new entry and mark the old one
superseded rather than deleting the history.

## Index

| ID | Status | Date | Title |
| --- | --- | --- | --- |
| [D-001](#d-001--do-not-redistribute-openai-app-payloads) | Accepted | 2026-06-27 | Do not redistribute OpenAI app payloads |
| [D-002](#d-002--keep-upstream-app-and-linux-wrapper-update-channels-separate) | Accepted | 2026-06-27 | Keep upstream app and Linux wrapper update channels separate |
| [D-003](#d-003--official-openai-routing-stays-direct-by-default) | Accepted | 2026-06-27 | Official OpenAI routing stays direct by default |
| [D-004](#d-004--system-package-installs-require-explicit-os-authorization) | Accepted | 2026-06-27 | System package installs require explicit OS authorization |

## D-001 — Do Not Redistribute OpenAI App Payloads

- **Status:** Accepted
- **Date:** 2026-06-27

This repository may publish source code, metadata, hashes, patch reports, logs,
and review records. It must not publish the OpenAI DMG, extracted `.app`
payloads, generated `codex-app/` directories, AppImages, or native packages
that contain OpenAI application code.

CI jobs that touch the live upstream DMG must keep uploaded artifacts
metadata-only and run no-payload validation before upload.

## D-002 — Keep Upstream App And Linux Wrapper Update Channels Separate

- **Status:** Accepted
- **Date:** 2026-06-27

The official upstream Codex Desktop app channel is represented by approved DMG
metadata and SHA256 pins. The Linux wrapper channel is this repository's
installer, patches, updater, launcher, package builders, feature framework, and
docs.

New upstream DMGs become candidates until CI validation, maintainer review, and
local dogfood promote them into the approved lock. Wrapper changes can ship
independently when they improve rebuild machinery or Linux behavior.

## D-003 — Official OpenAI Routing Stays Direct By Default

- **Status:** Accepted
- **Date:** 2026-06-27

Official Codex/OpenAI traffic uses the first-party route by default. Optional
custom-model support must be route-explicit and must not mutate global Codex
configuration into a shim or proxy path for official traffic.

`rabesss/codex-shim` remains an optional companion for custom providers that
need protocol translation. It is not a dependency of the official OpenAI path.

## D-004 — System Package Installs Require Explicit OS Authorization

- **Status:** Accepted
- **Date:** 2026-06-27

The updater may rebuild packages as the user, but final native package install
and rollback operations require explicit operating-system authorization.
Polkit or the user's package manager is the boundary. The project should not
ship broad passwordless sudo rules or unattended privileged package installs.
