#!/usr/bin/env python3
import ctypes
import ctypes.util
import functools
import http.server
import os
import signal
import sys
import urllib.parse


def _install_parent_death_signal():
    # Ensure the kernel terminates this process if the launcher (parent) exits
    # without invoking its cleanup trap (SIGKILL, OOM, crash). Without this,
    # the HTTP server can outlive the launcher and block its webview port,
    # which is fatal for multi-instance launches pinned to a single port.
    if sys.platform != "linux":
        return
    libc_name = ctypes.util.find_library("c") or "libc.so.6"
    try:
        libc = ctypes.CDLL(libc_name, use_errno=True)
    except OSError:
        return
    PR_SET_PDEATHSIG = 1
    if libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM, 0, 0, 0) != 0:
        return
    # The parent may have died between fork() and prctl(); in that case the
    # death signal never fires. Bail out now so the port is freed promptly.
    if os.getppid() == 1:
        os._exit(0)


_install_parent_death_signal()


port = int(sys.argv[1])
bind = "127.0.0.1"
if len(sys.argv) >= 4 and sys.argv[2] == "--bind":
    bind = sys.argv[3]

CUSTOM_MODEL_CATALOG_ROUTE = "/codex-linux/custom-model-catalog.json"


def _custom_model_catalog_path():
    configured = (
        os.environ.get("CODEX_CUSTOM_MODEL_CATALOG_JSON")
        or os.environ.get("CODEX_SHIM_MODEL_CATALOG_JSON")
    )
    if not configured:
        state_home = os.environ.get(
            "XDG_STATE_HOME",
            os.path.join(os.path.expanduser("~"), ".local", "state"),
        )
        configured = os.path.join(state_home, "codex-shim", "custom_model_catalog.json")
    configured = os.path.abspath(os.path.expanduser(configured))
    if os.path.isfile(configured) and os.access(configured, os.R_OK):
        return configured
    return None


class CodexWebviewHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        route = urllib.parse.urlsplit(self.path).path
        if route == CUSTOM_MODEL_CATALOG_ROUTE:
            return self.send_custom_model_catalog_head()
        return super().send_head()

    def send_custom_model_catalog_head(self):
        catalog_path = _custom_model_catalog_path()
        if catalog_path is None:
            self.send_error(404, "Custom model catalog not found")
            return None
        try:
            handle = open(catalog_path, "rb")
            size = os.fstat(handle.fileno()).st_size
        except OSError:
            self.send_error(404, "Custom model catalog not readable")
            return None
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        return handle

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


handler = functools.partial(CodexWebviewHandler, directory=".")
with http.server.ThreadingHTTPServer((bind, port), handler) as httpd:
    httpd.serve_forever()
