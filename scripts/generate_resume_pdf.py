#!/usr/bin/env python3

import http.server
import os
import socketserver
import subprocess
import sys
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "scripts" / "render_resume.swift"
OUTPUT_PDF = ROOT / "resume_concepcion_andrew.pdf"
OUTPUT_PNG = Path("/tmp/resume-preview.png")
PORT = 8765


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: A003
        return


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def main():
    os.chdir(ROOT)

    with ReusableTCPServer(("127.0.0.1", PORT), QuietHandler) as httpd:
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            subprocess.run(
                [
                    "swiftc",
                    "-parse-as-library",
                    str(RENDERER),
                    "-o",
                    "/tmp/render_resume",
                ],
                check=True,
            )
            subprocess.run(
                [
                    "/tmp/render_resume",
                    f"http://127.0.0.1:{PORT}/resume.html?phone=all",
                    str(OUTPUT_PDF),
                    str(OUTPUT_PNG),
                ],
                check=True,
            )
        finally:
            httpd.shutdown()
            thread.join(timeout=2)

    print(f"Generated {OUTPUT_PDF}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
