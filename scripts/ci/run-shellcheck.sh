#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_dir"

scripts=(
  install.sh
  scripts/build-deb.sh
  scripts/build-rpm.sh
  scripts/build-pacman.sh
  scripts/build-appimage.sh
  scripts/ci/update-nix-hashes.sh
  scripts/ci/validate-nix-pins.sh
  scripts/ci/run-shellcheck.sh
  scripts/ci-local.sh
  tests/fixtures/create-packaged-app-fixture.sh
  tests/test-package-artifact.sh
)

existing=()
for script in "${scripts[@]}"; do
  if [[ -f "$script" ]]; then
    existing+=("$script")
  fi
done

shellcheck -x --severity=warning "${existing[@]}"
