#!/usr/bin/env bash
set -euo pipefail

chrome_plugin="$INSTALL_DIR/resources/plugins/openai-bundled/plugins/chrome"
patcher="$SCRIPT_DIR/linux-features/brave-origin-browser-control/patch-chrome-plugin.js"
manifest_paths_dir="$INSTALL_DIR/.codex-linux"
manifest_paths_file="$manifest_paths_dir/chrome-native-host-manifest-paths"
manifest_location=".config/BraveSoftware/Brave-Origin-Nightly/NativeMessagingHosts"

mkdir -p "$manifest_paths_dir"
touch "$manifest_paths_file"
if ! grep -Fxq "$manifest_location" "$manifest_paths_file"; then
    printf '%s\n' "$manifest_location" >> "$manifest_paths_file"
fi

if [ ! -d "$chrome_plugin" ]; then
    echo "ERROR: Chrome plugin not found; Brave Origin browser control cannot be staged" >&2
    exit 1
fi

node "$patcher" "$chrome_plugin" >&2
