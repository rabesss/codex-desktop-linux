# Releasing

Codex Desktop Linux has two release lanes:

- **Linux wrapper releases**: source changes to this repository, including
  installer, patches, package builders, updater, launcher, Linux features, docs,
  and CI.
- **Approved upstream app promotions**: reviewed updates to
  `release/upstream-dmg-lock.json` after a live official `Codex.dmg` candidate
  validates and passes local dogfood.

Public releases must preserve the no-redistribution boundary: do not upload the
OpenAI DMG, extracted app, generated `codex-app/`, AppImage payloads, or native
packages containing OpenAI application code.

## Wrapper Release Checklist

1. Confirm the worktree contains only intended source, docs, metadata, and
   workflow changes.
2. Run focused validation for the touched surface.
3. Run the baseline source checks:

   ```bash
   cargo check -p codex-update-manager
   cargo test -p codex-update-manager
   bash tests/scripts_smoke.sh
   node --test scripts/ci/*.test.js
   node scripts/ci/validate-upstream-dmg-lock.js release/upstream-dmg-lock.json
   node scripts/ci/render-supported-md.js --check
   scripts/workstation/verify-policy.sh
   ```

4. For packaging changes, build and smoke-test fixture packages.
5. For workstation installs, use the workstation feature profile and verify the
   installed app before calling the update complete.
6. Update `CHANGELOG.md` when behavior changes.
7. Push only validated commits.

## Upstream App Promotion Checklist

1. Run or inspect the upstream DMG watcher result.
2. Confirm the candidate artifact contains metadata and patch reports only.
3. Confirm the candidate DMG SHA256, size, ETag, `Last-Modified`, and upstream
   app version.
4. Confirm required patch validation passed.
5. Rebuild a local native package from the candidate.
6. Dogfood launch, session resume, updater UI, browser-control targeting, and
   any touched optional features.
7. Confirm official Codex/OpenAI traffic remains direct.
8. Promote the candidate into `release/upstream-dmg-lock.json`.
9. Regenerate `SUPPORTED.md`.
10. Commit and push the promotion with validation evidence.

Promotion from a candidate manifest:

```bash
node scripts/ci/promote-upstream-dmg-lock.js \
  release/upstream-dmg-lock.json \
  --from-candidate-manifest /path/to/upstream-dmg-candidate.json \
  --repo-dir "$PWD" \
  --approved-by manual \
  --notes "Passed local dogfood."

node scripts/ci/validate-upstream-dmg-lock.js release/upstream-dmg-lock.json
node scripts/ci/render-supported-md.js --output SUPPORTED.md
```

## Failure Recovery

- If CI finds patch drift, fix the patch descriptors or mark the candidate as
  blocked. Do not promote the DMG.
- If a package installs but fails local verification, roll back with
  `codex-update-manager rollback` or the native package manager.
- If metadata was promoted incorrectly, submit a follow-up correction. Avoid
  deleting public history or workflow artifacts that other maintainers may need
  for audit.
