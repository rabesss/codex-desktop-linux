#!/usr/bin/env python3
"""Installed-state doctor for Codex Desktop Control Linux packages."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PACKAGE_NAME_TEMPLATE = "__PACKAGE_NAME__"
DEFAULT_PACKAGE_NAME = (
    "codex-desktop"
    if PACKAGE_NAME_TEMPLATE.startswith("__")
    else PACKAGE_NAME_TEMPLATE
)

PASS = "pass"
WARN = "warn"
FAIL = "fail"
INFO = "info"
STATUS_ORDER = [PASS, WARN, FAIL, INFO]


def run(args: list[str], timeout: float = 8.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )


def command_exists(name: str) -> bool:
    return shutil.which(name) is not None


def is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def first_line(value: str, max_length: int = 180) -> str:
    line = value.strip().splitlines()[0] if value.strip() else ""
    if len(line) <= max_length:
        return line
    return f"{line[: max_length - 3]}..."


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def linux_feature_enabled(build_info: dict[str, Any] | None, feature_id: str) -> bool:
    if build_info is None:
        return False
    enabled = build_info.get("linuxFeatures", {}).get("enabled")
    return isinstance(enabled, list) and feature_id in enabled


def first_existing_path(paths: list[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def add_check(
    checks: list[dict[str, Any]],
    check_id: str,
    label: str,
    status: str,
    detail: str,
    **data: Any,
) -> None:
    entry: dict[str, Any] = {
        "id": check_id,
        "label": label,
        "status": status,
        "detail": detail,
    }
    for key, value in data.items():
        if value is not None:
            entry[key] = value
    checks.append(entry)


def add_path_check(
    checks: list[dict[str, Any]],
    check_id: str,
    label: str,
    path: Path,
    *,
    executable: bool = False,
    missing_status: str = FAIL,
    detail_ok: str | None = None,
) -> None:
    ok = is_executable(path) if executable else path.is_file()
    if ok:
        detail = detail_ok or str(path)
        status = PASS
    else:
        need = "executable file" if executable else "file"
        detail = f"missing {need}: {path}"
        status = missing_status
    add_check(checks, check_id, label, status, detail, path=str(path))


def check_port(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.35):
            return True
    except OSError:
        return False


def package_version(package_name: str) -> tuple[str, str]:
    if command_exists("dpkg-query"):
        result = run(["dpkg-query", "-W", "-f=${Version}", package_name], timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            return "deb", result.stdout.strip()
    if command_exists("rpm"):
        result = run(["rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", package_name], timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            return "rpm", result.stdout.strip()
    if command_exists("pacman"):
        result = run(["pacman", "-Q", package_name], timeout=5)
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(maxsplit=1)
            return "pacman", parts[1] if len(parts) > 1 else result.stdout.strip()
    return "unknown", ""


def systemd_user_bus_status() -> tuple[str, str]:
    if not command_exists("systemctl"):
        return INFO, "systemctl not found"
    try:
        result = run(["systemctl", "--user", "show-environment"], timeout=5)
    except subprocess.TimeoutExpired:
        return WARN, "systemctl --user timed out"
    if result.returncode == 0:
        return PASS, "systemd user bus is reachable"
    detail = first_line(result.stderr or result.stdout)
    return WARN, detail or f"exit status {result.returncode}"


def systemd_user_service_status(unit_name: str, unit_path: Path) -> tuple[str, str]:
    if not unit_path.is_file():
        return INFO, "service unit not installed"
    if not command_exists("systemctl"):
        return WARN, "service unit installed, but systemctl is not available"
    try:
        result = run(["systemctl", "--user", "is-active", unit_name], timeout=5)
    except subprocess.TimeoutExpired:
        return WARN, "systemctl --user is-active timed out"
    state = (result.stdout or result.stderr).strip()
    if result.returncode == 0 and state == "active":
        return PASS, "active"
    return WARN, state or f"exit status {result.returncode}"


def node_version(node_path: Path) -> tuple[str, str, str | None]:
    if not is_executable(node_path):
        return FAIL, f"missing executable file: {node_path}", None
    try:
        result = run([str(node_path), "--version"], timeout=4)
    except subprocess.TimeoutExpired:
        return WARN, "managed Node.js runtime timed out while reading version", None
    version = first_line(result.stdout or result.stderr)
    if result.returncode == 0 and re.match(r"^v?\d+\.\d+\.\d+", version):
        return PASS, version, version
    return WARN, version or f"exit status {result.returncode}", None


def nested_bool(data: dict[str, Any], *keys: str) -> bool | None:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current if isinstance(current, bool) else None


def status_word(value: bool | None) -> str:
    if value is True:
        return "pass"
    if value is False:
        return "fail"
    return "unknown"


def run_json_command(args: list[str], timeout: float = 12.0) -> tuple[int, dict[str, Any] | None, str]:
    try:
        result = run(args, timeout=timeout)
    except subprocess.TimeoutExpired:
        return 124, None, f"timed out: {Path(args[0]).name}"
    if not result.stdout.strip():
        detail = first_line(result.stderr) or f"exit status {result.returncode}"
        return result.returncode, None, detail
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        detail = first_line(result.stderr or result.stdout) or "did not return JSON"
        return result.returncode, None, detail
    if not isinstance(data, dict):
        return result.returncode, None, "JSON output was not an object"
    return result.returncode, data, "returned JSON"


def run_node_json_script(
    script: Path,
    managed_node: Path,
    timeout: float = 10.0,
) -> tuple[int, dict[str, Any] | None, str]:
    if not script.is_file():
        return 127, None, f"missing script: {script}"
    node_binary = str(managed_node) if is_executable(managed_node) else shutil.which("node")
    if node_binary is None:
        return 127, None, "no executable managed or system Node.js runtime"
    return run_json_command([node_binary, str(script), "--json"], timeout=timeout)


def summarize_computer_use(data: dict[str, Any]) -> tuple[str, dict[str, Any], list[Any]]:
    readiness = data.get("readiness") if isinstance(data.get("readiness"), dict) else {}
    raw_blockers = readiness.get("blockers") if isinstance(readiness.get("blockers"), list) else []
    session_bus = nested_bool(data, "platform", "session_bus", "ok")
    accessibility_tree = nested_bool(data, "readiness", "can_build_accessibility_tree")
    windowing = nested_bool(data, "readiness", "can_query_windows")
    focus_apps = nested_bool(data, "readiness", "can_focus_apps")
    focus_windows = nested_bool(data, "readiness", "can_focus_windows")
    input_ready = nested_bool(data, "readiness", "can_send_development_input")
    detail = " ".join(
        [
            f"sessionBus={status_word(session_bus)}",
            f"accessibilityTree={status_word(accessibility_tree)}",
            f"windowing={status_word(windowing)}",
            f"focusApps={status_word(focus_apps)}",
            f"focusWindows={status_word(focus_windows)}",
            f"input={status_word(input_ready)}",
            f"blockers={len(raw_blockers)}",
        ]
    )
    summary = {
        "blockersCount": len(raw_blockers),
        "sessionBusOk": session_bus,
        "accessibilityTreeOk": accessibility_tree,
        "windowingOk": windowing,
        "focusAppsOk": focus_apps,
        "focusWindowsOk": focus_windows,
        "inputOk": input_ready,
    }
    return detail, summary, raw_blockers


def check_desktop_entry(
    checks: list[dict[str, Any]],
    desktop_entry: Path,
    package_name: str,
) -> None:
    if not desktop_entry.is_file():
        add_check(
            checks,
            "desktop_entry",
            "Desktop entry",
            FAIL,
            f"missing file: {desktop_entry}",
            path=str(desktop_entry),
        )
        return
    try:
        content = desktop_entry.read_text(encoding="utf-8")
    except OSError as exc:
        add_check(checks, "desktop_entry", "Desktop entry", FAIL, str(exc), path=str(desktop_entry))
        return
    expected = f"/usr/bin/{package_name}"
    has_exec = any(
        line.startswith("Exec=") and expected in line
        for line in content.splitlines()
    )
    add_check(
        checks,
        "desktop_entry",
        "Desktop entry",
        PASS if has_exec else FAIL,
        "Exec lines target the packaged launcher" if has_exec else f"Exec lines do not reference {expected}",
        path=str(desktop_entry),
    )


def check_browser_plugin(
    checks: list[dict[str, Any]],
    plugin_root: Path,
    managed_node: Path,
) -> None:
    chrome_dir = plugin_root / "chrome"
    browser_dir = plugin_root / "browser"
    if not chrome_dir.exists() and not browser_dir.exists():
        add_check(checks, "browser_plugins", "Browser control plugins", WARN, "bundled browser/chrome plugins not found")
        return

    add_check(
        checks,
        "browser_plugins",
        "Browser control plugins",
        PASS,
        "bundled browser-control plugin directory is present",
        chromePlugin=str(chrome_dir) if chrome_dir.exists() else None,
        inAppBrowserPlugin=str(browser_dir) if browser_dir.exists() else None,
    )

    opener = chrome_dir / "scripts/open-chrome-window.js"
    if opener.is_file():
        try:
            opener_source = opener.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            add_check(checks, "browser_opener", "Browser launch override", WARN, str(exc), path=str(opener))
        else:
            has_override = "CODEX_CHROME_EXECUTABLE" in opener_source
            add_check(
                checks,
                "browser_opener",
                "Browser launch override",
                PASS if has_override else WARN,
                "CODEX_CHROME_EXECUTABLE override is supported" if has_override else "override marker not found",
                path=str(opener),
            )
    else:
        add_check(checks, "browser_opener", "Browser launch override", WARN, "Chrome opener script not found", path=str(opener))

    extension_id = read_json(chrome_dir / "scripts/extension-id.json") or {}
    add_check(
        checks,
        "browser_extension_metadata",
        "Browser extension metadata",
        PASS if extension_id.get("extensionId") and extension_id.get("extensionHostName") else WARN,
        "extension id and host name are staged" if extension_id.get("extensionId") and extension_id.get("extensionHostName") else "extension metadata incomplete",
        extensionId=extension_id.get("extensionId") if isinstance(extension_id.get("extensionId"), str) else None,
        extensionHostName=extension_id.get("extensionHostName") if isinstance(extension_id.get("extensionHostName"), str) else None,
    )

    check_script = chrome_dir / "scripts/check-native-host-manifest.js"
    if check_script.is_file():
        _code, data, detail = run_node_json_script(check_script, managed_node)
        if isinstance(data, dict):
            correct = data.get("correct")
            add_check(
                checks,
                "browser_native_host_probe",
                "Browser native host manifest probe",
                PASS if correct is True else WARN,
                "manifest probe ok" if correct is True else "manifest probe reported a problem",
            )
        else:
            add_check(checks, "browser_native_host_probe", "Browser native host manifest probe", WARN, detail)


def check_computer_use(
    checks: list[dict[str, Any]],
    app_root: Path,
    *,
    probe_plugins: bool,
) -> None:
    doctor = app_root / "resources/plugins/openai-bundled/plugins/computer-use/bin/codex-computer-use-linux"
    if not is_executable(doctor):
        add_check(checks, "computer_use_doctor", "Computer Use doctor", WARN, "backend not installed", path=str(doctor))
        return
    if not probe_plugins:
        add_check(checks, "computer_use_doctor", "Computer Use doctor", PASS, "backend installed; runtime probe skipped", path=str(doctor))
        return
    code, data, detail = run_json_command([str(doctor), "doctor"], timeout=14)
    if isinstance(data, dict):
        summary_detail, summary, blockers = summarize_computer_use(data)
        add_check(
            checks,
            "computer_use_doctor",
            "Computer Use doctor",
            PASS if code == 0 and len(blockers) == 0 else WARN,
            summary_detail,
            **summary,
        )
    else:
        add_check(checks, "computer_use_doctor", "Computer Use doctor", WARN, detail, path=str(doctor))


def checks_for_package(args: argparse.Namespace) -> list[dict[str, Any]]:
    package_name = args.package_name
    app_root = Path(args.app_root or f"/opt/{package_name}")
    launcher = Path(args.launcher_path or f"/usr/bin/{package_name}")
    doctor = Path(args.doctor_path or f"/usr/bin/{package_name}-doctor")
    desktop_entry = Path(args.desktop_entry or f"/usr/share/applications/{package_name}.desktop")
    icon = Path(args.icon_path or f"/usr/share/icons/hicolor/256x256/apps/{package_name}.png")
    update_service = Path(args.update_service_path or "/usr/lib/systemd/user/codex-update-manager.service")
    updater = Path(args.updater_path or "/usr/bin/codex-update-manager")
    managed_node = app_root / "resources/node-runtime/bin/node"
    node_repl = app_root / "resources/node_repl"
    plugin_root = app_root / "resources/plugins/openai-bundled/plugins"
    build_info_paths = [
        app_root / "resources/codex-linux-build-info.json",
        app_root / ".codex-linux/build-info.json",
    ]
    update_builder = app_root / "update-builder"
    checks: list[dict[str, Any]] = []

    manager, version = package_version(package_name)
    add_check(
        checks,
        "package_manager",
        "Native package manager",
        PASS if version else WARN,
        f"{manager} {version}" if version else "package was not found through dpkg/rpm/pacman",
        packageManager=manager,
        version=version or None,
    )

    add_path_check(checks, "launcher", "Installed launcher", launcher, executable=True)
    add_path_check(checks, "doctor", "Installed doctor", doctor, executable=True)
    add_path_check(checks, "app_start", "Installed app launcher", app_root / "start.sh", executable=True)
    add_path_check(checks, "electron_runtime", "Electron runtime", app_root / "electron", executable=True)
    add_path_check(checks, "webview_index", "Extracted webview", app_root / "content/webview/index.html")
    check_desktop_entry(checks, desktop_entry, package_name)
    add_path_check(checks, "icon", "Application icon", icon, missing_status=WARN)

    node_status, node_detail, node_ver = node_version(managed_node)
    add_check(
        checks,
        "managed_node",
        "Managed Node.js runtime",
        node_status,
        node_detail,
        path=str(managed_node),
        version=node_ver,
    )
    add_path_check(checks, "node_repl", "Browser Use node_repl runtime", node_repl, executable=True, missing_status=WARN)

    build_info_path = first_existing_path(build_info_paths)
    build_info = read_json(build_info_path) if build_info_path else None
    add_check(
        checks,
        "build_info",
        "Linux build metadata",
        PASS if build_info else WARN,
        str(build_info_path) if build_info_path else "not found",
        path=str(build_info_path) if build_info_path else None,
        upstreamAppVersion=build_info.get("upstreamDmg", {}).get("appVersion") if build_info else None,
        electronVersion=build_info.get("electronVersion") if build_info else None,
        enabledFeatureCount=len(build_info.get("linuxFeatures", {}).get("enabled", [])) if build_info else None,
    )

    add_path_check(checks, "updater_binary", "Updater binary", updater, executable=True, missing_status=INFO)
    unit_status, unit_detail = systemd_user_service_status("codex-update-manager.service", update_service)
    add_check(checks, "updater_service", "Updater user service", unit_status, unit_detail, path=str(update_service))
    bus_status, bus_detail = systemd_user_bus_status()
    add_check(checks, "systemd_user_bus", "systemd user bus", bus_status, bus_detail)

    add_check(
        checks,
        "update_builder",
        "Update-builder bundle",
        PASS if update_builder.is_dir() else INFO,
        str(update_builder) if update_builder.is_dir() else "not installed in manual-update or AppImage mode",
        path=str(update_builder),
    )
    staged_features = read_json(update_builder / "linux-features/features.json")
    if staged_features is not None:
        enabled = staged_features.get("enabled") if isinstance(staged_features.get("enabled"), list) else []
        add_check(
            checks,
            "update_builder_features",
            "Update-builder enabled Linux features",
            INFO,
            f"enabled={len(enabled)}",
            enabledCount=len(enabled),
        )

    check_browser_plugin(checks, plugin_root, managed_node)
    check_computer_use(checks, app_root, probe_plugins=not args.no_plugin_probes)

    webview_port_open = check_port(args.webview_port)
    add_check(
        checks,
        "webview_port",
        f"Webview server 127.0.0.1:{args.webview_port}",
        PASS if webview_port_open else INFO,
        "listening" if webview_port_open else "not listening",
        port=args.webview_port,
    )
    if args.cdp_port:
        cdp_port_open = check_port(args.cdp_port)
        add_check(
            checks,
            "cdp_port",
            f"Optional CDP port 127.0.0.1:{args.cdp_port}",
            INFO,
            "listening" if cdp_port_open else "not listening",
            port=args.cdp_port,
        )

    return checks


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    checks = checks_for_package(args)
    summary = {
        status: sum(1 for check in checks if check["status"] == status)
        for status in STATUS_ORDER
    }
    failed = [check["label"] for check in checks if check["status"] == FAIL]
    warnings = [check["label"] for check in checks if check["status"] == WARN]
    readiness = {
        "ready": len(failed) == 0,
        "blockers": failed,
        "warnings": warnings,
    }
    return {
        "packageName": args.package_name,
        "appRoot": args.app_root or f"/opt/{args.package_name}",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "readiness": readiness,
        "checks": checks,
    }


def print_text(report: dict[str, Any]) -> None:
    print(f"Codex Desktop Control Linux doctor ({report['packageName']})")
    print(f"App root: {report['appRoot']}")
    for check in report["checks"]:
        print(f"[{check['status'].upper()}] {check['label']}: {check['detail']}")
    summary = report["summary"]
    print(
        "Summary: "
        f"{summary[PASS]} pass, {summary[WARN]} warn, "
        f"{summary[FAIL]} fail, {summary[INFO]} info"
    )
    readiness = "ready" if report["readiness"]["ready"] else "not ready"
    print(f"Readiness: {readiness}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check an installed Codex Desktop Control Linux package.",
    )
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE_NAME, help="installed package name")
    parser.add_argument("--app-root", help="installed app root, defaults to /opt/<package-name>")
    parser.add_argument("--launcher-path", help="launcher path, defaults to /usr/bin/<package-name>")
    parser.add_argument("--doctor-path", help="doctor path, defaults to /usr/bin/<package-name>-doctor")
    parser.add_argument("--desktop-entry", help="desktop entry path")
    parser.add_argument("--icon-path", help="icon path")
    parser.add_argument("--updater-path", help="updater binary path")
    parser.add_argument("--update-service-path", help="updater user service unit path")
    parser.add_argument("--webview-port", type=int, default=5175, help="webview readiness port to probe")
    parser.add_argument("--cdp-port", type=int, default=9333, help="optional CDP port to probe; set 0 to skip")
    parser.add_argument(
        "--no-plugin-probes",
        action="store_true",
        help="only check plugin binaries; do not run optional plugin doctors",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    report = build_report(args)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_text(report)
    return 0 if report["readiness"]["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
