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
RENDER_BIN = Path("/tmp/render_resume")
PORT = 8765
DOCUMENTS = [
    (
        "applications/cover-letter-general.html",
        "cover_letter_concepcion_andrew.pdf",
        "/tmp/cover-letter-general-preview.png",
        1280,
        1400,
    ),
    (
        "applications/cover-letter-new-zealand-sponsorship.html",
        "cover_letter_concepcion_andrew_nz.pdf",
        "/tmp/cover-letter-nz-preview.png",
        1280,
        1450,
    ),
]


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
                    str(RENDER_BIN),
                ],
                check=True,
            )

            for html_path, pdf_path, png_path, min_width, min_height in DOCUMENTS:
                subprocess.run(
                    [
                        str(RENDER_BIN),
                        f"http://127.0.0.1:{PORT}/{html_path}",
                        str(ROOT / pdf_path),
                        png_path,
                        str(min_width),
                        str(min_height),
                    ],
                    check=True,
                )
        finally:
            httpd.shutdown()
            thread.join(timeout=2)

    for _, pdf_path, _, _, _ in DOCUMENTS:
        print(f"Generated {ROOT / pdf_path}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
