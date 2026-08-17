#!/usr/bin/env python3
"""Serve the repository as a quiet local static site.

Used by Playwright and available as a VS Code task so local UI testing does
not depend on ad hoc terminal commands.
"""

from __future__ import annotations

import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


# =======================
# USER SETTINGS (edit)
# =======================
REPO_ROOT = Path(__file__).resolve().parents[1]
SERVE_ROOT = REPO_ROOT
HOST = "127.0.0.1"
PORT = int(os.environ.get("REF_PAGES_STATIC_SERVER_PORT", "4173"))
QUIET_REQUEST_LOGS = True


class StaticSiteHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        if QUIET_REQUEST_LOGS:
            return
        super().log_message(format, *args)


def main() -> int:
    handler = partial(StaticSiteHandler, directory=str(SERVE_ROOT))
    server = ThreadingHTTPServer((HOST, PORT), handler)
    server.daemon_threads = True
    print(f"Serving {SERVE_ROOT} at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
