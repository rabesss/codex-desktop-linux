# REVIEW.md — codex-desktop-linux

Canonical PR review guide. See [`AGENTS.md`](AGENTS.md) for architecture and maintainer rules.

## Reviewer routing

| Reviewer | Config file it reads |
|----------|----------------------|
| OpenAI Codex (`chatgpt-codex-connector`) | `AGENTS.md` |
| Google Jules (`google-labs-jules`) | `AGENTS.md` |

## Severity calibration

- **Critical:** credential leaks, broken official OpenAI routing, reintroducing removed features without review, packaging/updater regressions.
- **Warning:** missing tests for patch/feature changes, cross-format packaging drift, manual edits to generated `codex-app/` output.
- **Do not flag:** formatting-only diffs, speculative refactors outside PR scope.
