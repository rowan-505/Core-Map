#!/usr/bin/env python3
"""Serve the local PMTiles tree with CORS and HTTP Range (MapLibre / PMTiles)."""

from __future__ import annotations

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_PORT = 8080


class LimitedReader:
    def __init__(self, handle, remaining: int) -> None:
        self._handle = handle
        self._remaining = remaining

    def read(self, size: int = -1) -> bytes:
        if self._remaining <= 0:
            return b""
        if size is None or size < 0:
            size = self._remaining
        data = self._handle.read(min(size, self._remaining))
        self._remaining -= len(data)
        return data

    def close(self) -> None:
        self._handle.close()


def linux_path_from_wsl_unc(raw: str) -> str | None:
    normalized = raw.replace("\\", "/")
    match = re.search(r"wsl\.localhost/[^/]+/(.*)$", normalized, flags=re.IGNORECASE)
    if not match:
        return None
    return "/" + match.group(1)


def pmtiles_root() -> Path:
    here = Path(__file__).resolve().parent.parent
    if here.is_dir():
        return here

    init_cwd = os.environ.get("INIT_CWD") or os.environ.get("PWD") or os.getcwd()
    linux = linux_path_from_wsl_unc(init_cwd)
    root = Path(linux or init_cwd)
    candidate = root / "infrastructure" / "tiles" / "pmtiles"
    if candidate.is_dir():
        return candidate
    raise SystemExit(f"error: cannot find PMTiles directory from {init_cwd!r}")


def parse_byte_range(header: str, file_size: int) -> tuple[int, int] | None:
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match or file_size <= 0:
        return None
    start_s, end_s = match.group(1), match.group(2)
    if start_s == "" and end_s == "":
        return None
    if start_s == "":
        length = int(end_s)
        if length <= 0:
            return None
        start = max(file_size - length, 0)
        end = file_size - 1
        return start, end
    start = int(start_s)
    end = int(end_s) if end_s else file_size - 1
    if start >= file_size or start < 0 or end < start:
        return None
    end = min(end, file_size - 1)
    return start, end


class CorsRangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS")
        self.send_header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        )
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()

        try:
            file_size = os.path.getsize(path)
            handle = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)
        range_header = self.headers.get("Range")
        if range_header:
            parsed = parse_byte_range(range_header, file_size)
            if parsed is None:
                handle.close()
                self.send_error(416, "Range not satisfiable")
                return None
            start, end = parsed
            length = end - start + 1
            handle.seek(start)
            self.send_response(206)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.end_headers()
            return LimitedReader(handle, length)

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(file_size))
        self.send_header("Last-Modified", self.date_time_string(os.path.getmtime(path)))
        self.end_headers()
        return handle

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def main() -> None:
    port = int(os.environ.get("PMTILES_SERVE_PORT", DEFAULT_PORT))
    root = pmtiles_root()
    os.chdir(root)

    print("", file=sys.stderr)
    print("  Local PMTiles static server", file=sys.stderr)
    print("  --------------------------", file=sys.stderr)
    print(f"  Served path:   {root}", file=sys.stderr)
    print(f"  Listen:        http://localhost:{port}", file=sys.stderr)
    print("  CORS:          enabled", file=sys.stderr)
    print("", file=sys.stderr)
    print("  Example URLs:", file=sys.stderr)
    print("    http://localhost:%s/regions/yangon/current.json" % port, file=sys.stderr)
    print("    http://localhost:%s/overview/current.json" % port, file=sys.stderr)
    print("", file=sys.stderr)

    server = ThreadingHTTPServer(("0.0.0.0", port), CorsRangeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
