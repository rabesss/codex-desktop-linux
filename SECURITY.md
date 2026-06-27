# Security Policy

Report suspected vulnerabilities privately with GitHub Security Advisories:

https://github.com/rabesss/codex-linux/security/advisories/new

Do not open a public issue with credentials, provider keys, request dumps,
tokens, private model catalogs, local paths that identify a machine, or
unredacted logs.

## Scope

In scope for this repository:

- installer, launcher, and package-builder behavior;
- Linux patch descriptors and injected compatibility code;
- `codex-update-manager`, rollback, Polkit, and package install paths;
- Linux feature framework and bundled Linux integration resources;
- browser-control and computer-use Linux glue shipped by this repository;
- CI workflows, release metadata, no-payload artifact boundaries, and
  promotion automation.

Out of scope for this repository:

- vulnerabilities in the official Codex Desktop app itself;
- vulnerabilities in OpenAI APIs, services, or accounts;
- issues caused solely by custom third-party model providers or local adapters
  outside this repository.

If a wrapper change makes an upstream issue worse on Linux, report it here and
describe the wrapper-specific exposure.

## Distribution Boundary

This repository does not publish OpenAI DMGs, extracted `.app` payloads,
generated `codex-app/` trees, AppImages, or native packages that contain OpenAI
application code. Public artifacts may contain source, metadata, hashes, logs,
patch reports, and review records only.

## What To Include

- affected wrapper commit or package version;
- upstream app version and approved DMG SHA when relevant;
- package format and distribution;
- exact reproduction steps;
- redacted `codex-desktop-doctor --json` output when useful;
- whether the issue affects source builds, installed packages, updater rebuilds,
  or optional Linux features.
