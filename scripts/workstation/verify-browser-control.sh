#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app_dir="${1:-$repo_dir/codex-desktop-control-dev-app}"
brave_bin="${CODEX_BRAVE_ORIGIN_EXECUTABLE:-/usr/bin/brave-origin-nightly}"
brave_root="${CODEX_BRAVE_ORIGIN_USER_DATA_DIR:-$HOME/.config/BraveSoftware/Brave-Origin-Nightly}"
brave_profile="${CODEX_BRAVE_ORIGIN_PROFILE:-Default}"
expected_default_browser="${CODEX_DESKTOP_CONTROL_EXPECTED_DEFAULT_BROWSER:-zen.desktop}"
extension_id="hehggadaopoacecdllhhajmbjkdcmajg"
plugin_dir="$app_dir/resources/plugins/openai-bundled/plugins/chrome"
scripts_dir="$plugin_dir/scripts"
manifest="$brave_root/NativeMessagingHosts/com.openai.codexextension.json"
staged_host="$plugin_dir/extension-host/linux/x64/extension-host"
fail=0
cdp_screenshot_dir=""

cleanup() {
  if [ -n "$cdp_screenshot_dir" ]; then
    rm -rf "$cdp_screenshot_dir"
  fi
}

trap cleanup EXIT

pass() {
  echo "OK: $*"
}

error() {
  echo "FAIL: $*" >&2
  fail=1
}

require_file() {
  local label="$1"
  local path="$2"
  if [ -f "$path" ]; then
    pass "$label"
  else
    error "$label is missing: $path"
  fi
}

require_executable() {
  local label="$1"
  local path="$2"
  if [ -x "$path" ]; then
    pass "$label"
  else
    error "$label is missing or not executable: $path"
  fi
}

require_marker() {
  local label="$1"
  local path="$2"
  local marker="$3"
  if [ -f "$path" ] && rg -Fq "$marker" "$path"; then
    pass "$label"
  else
    error "$label marker is missing from $path"
  fi
}

require_file "side-by-side build info" "$app_dir/.codex-linux/build-info.json"
require_file "side-by-side launcher" "$app_dir/start.sh"
require_file "Brave native-host path list" "$app_dir/.codex-linux/chrome-native-host-manifest-paths"
require_executable "staged vetted Linux extension host" "$staged_host"

if [ -f "$app_dir/.codex-linux/build-info.json" ] &&
  jq -e '.linuxFeatures.enabled | index("brave-origin-browser-control") != null' \
    "$app_dir/.codex-linux/build-info.json" >/dev/null; then
  pass "Brave Origin feature is recorded in side-by-side build provenance"
else
  error "Brave Origin feature is absent from side-by-side build provenance"
fi

if [ -f "$app_dir/.codex-linux/chrome-native-host-manifest-paths" ] &&
  rg -Fxq '.config/BraveSoftware/Brave-Origin-Nightly/NativeMessagingHosts' \
    "$app_dir/.codex-linux/chrome-native-host-manifest-paths"; then
  pass "side-by-side launcher stages the Brave Origin native-host location"
else
  error "side-by-side launcher does not stage the Brave Origin native-host location"
fi

require_marker "manifest installer targets Brave Origin" "$scripts_dir/installManifest.mjs" \
  "Brave-Origin-Nightly/NativeMessagingHosts"
require_marker "browser client discovers Brave Origin profiles" "$scripts_dir/browser-client.mjs" \
  'Brave-Origin-Nightly'
require_marker "extension checker prefers Brave Origin" "$scripts_dir/check-extension-installed.js" \
  "linuxBraveOriginUserDataDirectory"
require_marker "window opener launches Brave Origin" "$scripts_dir/open-chrome-window.js" \
  'commandPath("brave-origin-nightly")'
require_marker "running-browser probe recognizes Brave Origin" "$scripts_dir/chrome-is-running.js" \
  "brave-origin-nightly"
require_marker "browser inventory includes Brave Origin" "$scripts_dir/installed-browsers.js" \
  "Brave Origin Nightly"

require_executable "Brave Origin Nightly executable" "$brave_bin"
if [ -x "$brave_bin" ]; then
  "$brave_bin" --version
fi

if [ "${CODEX_BROWSER_CONTROL_SKIP_CDP_SCREENSHOT:-0}" = "1" ]; then
  pass "browser CDP screenshot probe skipped by CODEX_BROWSER_CONTROL_SKIP_CDP_SCREENSHOT"
else
  cdp_screenshot_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-browser-control-cdp.XXXXXX")"
  cdp_screenshot="$cdp_screenshot_dir/browser-control-cdp-screenshot.png"
  if cdp_output="$(
    node "$repo_dir/scripts/workstation/verify-browser-cdp-screenshot.js" \
      --browser "$brave_bin" \
      --target brave-origin-nightly \
      --screenshot "$cdp_screenshot" \
      --json 2>&1
  )"; then
    printf '%s\n' "$cdp_output"
    if printf '%s\n' "$cdp_output" | jq -e '.ok == true and (.screenshotBytes // 0) > 0' >/dev/null &&
      [ -s "$cdp_screenshot" ]; then
      pass "Brave Origin CDP Page.captureScreenshot path works"
    else
      error "Brave Origin CDP screenshot probe did not report a non-empty PNG"
    fi
  else
    printf '%s\n' "$cdp_output" >&2
    error "Brave Origin CDP screenshot probe failed"
  fi
fi

if [ -f "$scripts_dir/check-extension-installed.js" ]; then
  if extension_output="$(
    CODEX_CHROME_USER_DATA_DIR="$brave_root" \
    CODEX_CHROME_PREFERENCES_PATH="$brave_root/$brave_profile/Preferences" \
      node "$scripts_dir/check-extension-installed.js" 2>&1
  )"; then
    printf '%s\n' "$extension_output"
    if printf '%s\n' "$extension_output" | rg -q '^Installed in any profile: yes$' &&
      printf '%s\n' "$extension_output" | rg -q '^Enabled in any profile: yes$'; then
      pass "Codex extension $extension_id is installed and enabled in Brave Origin"
    else
      error "Codex extension $extension_id is not both installed and enabled in Brave Origin"
    fi
  else
    printf '%s\n' "$extension_output" >&2
    error "Brave Origin extension check failed"
  fi
fi

if [ -f "$scripts_dir/check-native-host-manifest.js" ]; then
  if manifest_output="$(
    CODEX_CHROME_NATIVE_HOST_MANIFEST_PATH="$manifest" \
      node "$scripts_dir/check-native-host-manifest.js" 2>&1
  )"; then
    printf '%s\n' "$manifest_output"
    if printf '%s\n' "$manifest_output" | rg -q '^Correct: yes$'; then
      pass "Brave Origin native-host manifest identity and allowed origin are correct"
    else
      error "Brave Origin native-host manifest is not correct"
    fi
  else
    printf '%s\n' "$manifest_output" >&2
    error "Brave Origin native-host manifest check failed"
  fi
fi

if [ -f "$manifest" ]; then
  manifest_host="$(jq -r '.path // empty' "$manifest")"
  if [ -n "$manifest_host" ] && [ -x "$manifest_host" ]; then
    pass "live Brave native-host manifest points to an executable"
    if [ -x "$staged_host" ] && [ "$(sha256sum "$manifest_host" | cut -d' ' -f1)" = "$(sha256sum "$staged_host" | cut -d' ' -f1)" ]; then
      pass "live Brave native host matches the vetted side-by-side artifact"
    else
      error "live Brave native host does not match the vetted side-by-side artifact"
    fi
  else
    error "live Brave native-host manifest path is missing or not executable"
  fi
else
  error "live Brave native-host manifest is missing: $manifest"
fi

if [ -f "$scripts_dir/installed-browsers.js" ]; then
  if inventory_output="$(node "$scripts_dir/installed-browsers.js" 2>&1)"; then
    printf '%s\n' "$inventory_output"
    if printf '%s\n' "$inventory_output" | rg -q 'Brave Origin Nightly'; then
      pass "controlled browser inventory discovers Brave Origin Nightly"
    else
      error "controlled browser inventory does not discover Brave Origin Nightly"
    fi
  else
    printf '%s\n' "$inventory_output" >&2
    error "controlled browser inventory check failed"
  fi
fi

if default_browser="$(xdg-settings get default-web-browser 2>/dev/null)" &&
  [ "$default_browser" = "$expected_default_browser" ]; then
  pass "desktop default browser remains $expected_default_browser"
else
  error "desktop default browser must remain $expected_default_browser (found ${default_browser:-unknown})"
fi

if rg -n 'AlekseiSeleznev|codex-computer-use-x11|x11-ewmh-computer-use' \
  "$app_dir/resources/plugins/openai-bundled" >/dev/null; then
  error "side-by-side plugin payload contains a forbidden third-party X11 Computer Use surface"
else
  pass "side-by-side plugin payload contains no forbidden third-party X11 Computer Use surface"
fi

exit "$fail"
