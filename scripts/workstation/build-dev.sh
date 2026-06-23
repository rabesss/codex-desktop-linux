#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
profile_config="${CODEX_DESKTOP_CONTROL_FEATURES_CONFIG:-$repo_dir/profiles/workstation/features.json}"
dmg_path="${DMG:-${CODEX_DMG:-$HOME/.cache/codex-update-manager/downloads/Codex.dmg}}"
dev_app_id="${DEV_APP_ID:-codex-desktop-control-dev}"
dev_app_name="${DEV_APP_NAME:-Codex Desktop Control Dev}"
dev_app_dir="${DEV_APP_DIR:-$repo_dir/$dev_app_id-app}"
patch_report="${CODEX_DESKTOP_CONTROL_PATCH_REPORT_JSON:-$repo_dir/dist-next/workstation/patch-report.json}"

if [ ! -f "$dmg_path" ]; then
  echo "Codex DMG not found: $dmg_path" >&2
  echo "Set DMG=/path/to/Codex.dmg or run the normal build flow to download it." >&2
  exit 1
fi

cd "$repo_dir"
"$repo_dir/scripts/workstation/verify-policy.sh"
mkdir -p "$(dirname "$patch_report")"
rm -f "$patch_report"
CODEX_LINUX_FEATURES_CONFIG="$profile_config" \
CODEX_PATCH_REPORT_JSON="$patch_report" \
DEV_APP_ID="$dev_app_id" \
DEV_APP_NAME="$dev_app_name" \
DEV_APP_DIR="$dev_app_dir" \
DMG="$dmg_path" \
  make build-dev-app

CODEX_LINUX_FEATURES_CONFIG="$profile_config" \
  node scripts/ci/validate-patch-report.js "$patch_report" --profile controlled-workstation

CODEX_LINUX_SYNC_BUNDLED_PLUGINS_ONLY=1 "$dev_app_dir/start.sh"
"$repo_dir/scripts/workstation/verify-browser-control.sh" "$dev_app_dir"
