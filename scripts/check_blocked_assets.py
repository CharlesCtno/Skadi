#!/usr/bin/env python3
"""
Fail commit when staged files include blocked assets or oversized files.

Usage:
  python scripts/check_blocked_assets.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MAX_SIZE_BYTES = 10 * 1024 * 1024  # 10MB safety cap

BLOCKED_PATH_PREFIXES = (
    "data/raw/",
    "data/bike/raw/",
    "journal/photos/",
)

BLOCKED_LIVE_PHOTOS_PREFIX = "live/trips/"
BLOCKED_LIVE_PHOTOS_CONTAINS = "/photos/"

BLOCKED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".gpx",
}


def get_staged_paths() -> list[str]:
    cmd = ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR"]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    if result.returncode != 0:
        print("Unable to read staged files:", file=sys.stderr)
        print(result.stderr.strip(), file=sys.stderr)
        sys.exit(result.returncode)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def is_blocked_path(path: str) -> bool:
    normalized = path.replace("\\", "/")
    if any(normalized.startswith(prefix) for prefix in BLOCKED_PATH_PREFIXES):
        return True
    if normalized.startswith(BLOCKED_LIVE_PHOTOS_PREFIX) and BLOCKED_LIVE_PHOTOS_CONTAINS in normalized:
        return True
    ext = Path(normalized).suffix.lower()
    return ext in BLOCKED_EXTENSIONS


def check_file_size(path: str) -> tuple[bool, int]:
    abs_path = REPO_ROOT / path
    if not abs_path.exists():
        # Deleted or moved files can appear in staged set depending on transition.
        return False, 0
    size = os.path.getsize(abs_path)
    return size > MAX_SIZE_BYTES, size


def main() -> int:
    staged = get_staged_paths()
    if not staged:
        return 0

    blocked: list[str] = []
    oversized: list[tuple[str, int]] = []

    for path in staged:
        if is_blocked_path(path):
            blocked.append(path)
        too_large, size = check_file_size(path)
        if too_large:
            oversized.append((path, size))

    if not blocked and not oversized:
        return 0

    print("Commit blocked by asset guard:\n")
    if blocked:
        print("Blocked file patterns:")
        for path in blocked:
            print(f"  - {path}")
        print()

    if oversized:
        print(f"Oversized staged files (> {MAX_SIZE_BYTES // (1024 * 1024)}MB):")
        for path, size in oversized:
            print(f"  - {path} ({size / (1024 * 1024):.2f} MB)")
        print()

    print("Fix:")
    print("- Remove these files from the commit (git restore --staged <file>)")
    print("- Keep binary/photo assets in Cloudinary and raw GPX out of git")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
