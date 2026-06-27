#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
    cat <<'HELP'
Usage: tests/test-package-artifact.sh deb|rpm|pacman <artifact-dir>

Extracts a fixture package and smoke-tests packaged entrypoints without
installing the package into the host.
HELP
}

format="${1:-}"
artifact_dir="${2:-}"

if [[ -z "$format" || -z "$artifact_dir" || ! -d "$artifact_dir" ]]; then
    usage >&2
    exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
root="$tmp_dir/root"
mkdir -p "$root"

find_one() {
    local pattern="$1"
    local found
    found="$(find "$artifact_dir" -maxdepth 1 -type f -name "$pattern" -print -quit)"
    [[ -n "$found" ]] || {
        echo "No artifact matching $pattern in $artifact_dir" >&2
        exit 1
    }
    printf '%s\n' "$found"
}

case "$format" in
    deb)
        pkg="$(find_one 'codex-desktop_*.deb')"
        dpkg-deb -I "$pkg" >/dev/null
        dpkg-deb -x "$pkg" "$root"
        ;;
    rpm)
        pkg="$(find_one 'codex-desktop-*.rpm')"
        rpm -qip "$pkg" >/dev/null
        (cd "$root" && rpm2cpio "$pkg" | cpio -idm --quiet)
        ;;
    pacman)
        pkg="$(find_one 'codex-desktop-*.pkg.tar.*')"
        tar --use-compress-program=unzstd -xf "$pkg" -C "$root"
        test -f "$root/.PKGINFO"
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

require_executable() {
    local path="$1"
    [[ -x "$path" ]] || {
        echo "Missing executable: $path" >&2
        exit 1
    }
}

require_file() {
    local path="$1"
    [[ -f "$path" ]] || {
        echo "Missing file: $path" >&2
        exit 1
    }
}

require_executable "$root/opt/codex-desktop/start.sh"
require_executable "$root/usr/bin/codex-update-manager"
require_executable "$root/usr/bin/codex-desktop-doctor"
require_file "$root/usr/lib/systemd/user/codex-update-manager.service"
require_file "$root/opt/codex-desktop/update-builder/release/upstream-dmg-lock.json"
require_file "$root/opt/codex-desktop/.codex-linux/codex-packaged-runtime.sh"

"$root/opt/codex-desktop/start.sh" | grep -q 'codex desktop fixture'
"$root/usr/bin/codex-update-manager" --help >/dev/null

doctor_json="$tmp_dir/doctor.json"
python3 "$root/usr/bin/codex-desktop-doctor" \
    --json \
    --package-name codex-desktop \
    --app-root "$root/opt/codex-desktop" \
    --launcher-path "$root/usr/bin/codex-desktop" \
    --doctor-path "$root/usr/bin/codex-desktop-doctor" \
    --desktop-entry "$root/usr/share/applications/codex-desktop.desktop" \
    --icon-path "$root/usr/share/icons/hicolor/256x256/apps/codex-desktop.png" \
    --updater-path "$root/usr/bin/codex-update-manager" \
    --update-service-path "$root/usr/lib/systemd/user/codex-update-manager.service" \
    --webview-port 1 \
    --cdp-port 0 \
    --no-plugin-probes > "$doctor_json"

python3 - "$doctor_json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    report = json.load(handle)

if report["summary"]["fail"] != 0 or report["readiness"]["ready"] is not True:
    raise SystemExit(f"package doctor reported blockers: {report['summary']}")

ids = {check["id"] for check in report["checks"]}
for check_id in [
    "launcher",
    "doctor",
    "app_start",
    "electron_runtime",
    "managed_node",
    "updater_binary",
    "update_builder",
]:
    if check_id not in ids:
        raise SystemExit(f"missing doctor check: {check_id}")
PY

echo "Package artifact smoke passed for $format: $(basename "$pkg")"
