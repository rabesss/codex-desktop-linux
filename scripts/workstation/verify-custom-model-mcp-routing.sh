#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dev_app_dir="${1:-$repo_dir/codex-desktop-control-dev-app}"

if [[ ! -d "$dev_app_dir" ]]; then
  echo "verify-custom-model-mcp-routing: dev app not found at $dev_app_dir" >&2
  exit 1
fi

assets_dir="$dev_app_dir/content/webview/assets"
if [[ ! -d "$assets_dir" ]]; then
  assets_dir="$dev_app_dir/resources/app.asar.unpacked/webview/assets"
fi
signals_bundle="$(find "$assets_dir" -maxdepth 1 \( -name 'app-server-manager-signals-*.js' -o -name 'thread-context-inputs-*.js' \) -print -quit)"
model_query_bundle="$(rg -l 'codexLinuxCustomModelMergeListModels' "$assets_dir" --glob '*.js' | sed -n '1p' || true)"

tmp_asar_dir=""
cleanup() {
  [[ -z "$tmp_asar_dir" ]] || rm -rf "$tmp_asar_dir"
}
trap cleanup EXIT

if [[ -z "${signals_bundle:-}" || -z "${model_query_bundle:-}" ]] && [[ -f "$dev_app_dir/resources/app.asar" ]]; then
  tmp_asar_dir="$(mktemp -d)"
  npx --yes asar extract "$dev_app_dir/resources/app.asar" "$tmp_asar_dir"
  assets_dir="$tmp_asar_dir/webview/assets"
  signals_bundle="$(find "$assets_dir" -maxdepth 1 \( -name 'app-server-manager-signals-*.js' -o -name 'thread-context-inputs-*.js' \) -print -quit)"
  model_query_bundle="$(rg -l 'codexLinuxCustomModelMergeListModels' "$assets_dir" --glob '*.js' | sed -n '1p' || true)"
fi

if [[ -z "${signals_bundle:-}" ]]; then
  echo "verify-custom-model-mcp-routing: app-server manager or thread context bundle missing" >&2
  exit 1
fi
if [[ -z "${model_query_bundle:-}" ]]; then
  echo "verify-custom-model-mcp-routing: custom model query bundle missing" >&2
  exit 1
fi

echo "Checking $signals_bundle"
echo "Checking $model_query_bundle"

rg -q 'function codexLinuxCustomModelApplyRouting' "$signals_bundle"
rg -q 'codexLinuxCustomModelApplyRouting\(c,e\)' "$signals_bundle"
rg -q 'model_catalog_json' "$signals_bundle"
rg -q 'globalThis\.__codexLinuxCustomModelSlugs.*\^\(cursor-' "$signals_bundle"
rg -q 'updateThreadSettingsForNextTurn\([^)]*\)\{[A-Za-z_$][A-Za-z0-9_$]*=codexLinuxCustomModelApplyThreadSettings' "$signals_bundle"
rg -q 'codexLinuxCustomModelNeedsProviderResume\(this\.getConversation' "$signals_bundle"
rg -q 'sendRequest\(`thread/unsubscribe`.*resumeConversationForUnavailableOwner' "$signals_bundle"
rg -q '[A-Za-z_$][A-Za-z0-9_$]*=codexLinuxCustomModelApplyRouting\(\{threadId:.*\},[A-Za-z_$][A-Za-z0-9_$]*\?\?[A-Za-z_$][A-Za-z0-9_$]*\?\.settings\?\.model\),[A-Za-z_$][A-Za-z0-9_$]*=\{threadId:' "$signals_bundle"
rg -q 'codexLinuxCustomModelApplyRouting\(\{config:await .*buildThreadCodexConfig' "$signals_bundle"
rg -q 'sendRequest\(`thread/fork`.*modelProvider:' "$signals_bundle"
rg -q 'globalThis\.__codexLinuxCustomModelSlugs=new Set' "$model_query_bundle"
rg -q 'providerDisplayName.*displayName.*s\.has' "$model_query_bundle"

if rg -q 'skipDynamicTools:!codexLinuxCustomModelCustomSlug' "$signals_bundle"; then
  echo "resume dynamic-tools patch: applied"
else
  echo "resume dynamic-tools patch: not present (optional upstream drift)"
fi

node "$repo_dir/linux-features/custom-model-catalog/test.js"
echo "verify-custom-model-mcp-routing: ok"
