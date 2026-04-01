#!/usr/bin/env python3
"""
Build static Notion page cache for GitHub Pages deploys.

Reads summits/bike published CSVs, extracts Notion page ids from journal columns,
fetches Notion block children via API, and writes JSON files to output dir.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Set


NOTION_PAGE_ID_RE = re.compile(r"^[0-9a-fA-F]{32}$")
NOTION_PAGE_ID_DASHED_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

SUMMITS_JOURNAL_COL = 19  # T
BIKE_JOURNAL_COL = 9  # J


def http_get_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Skadi-Notion-Cache/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8")


def normalize_cell(value: str) -> str:
    return (
        str(value or "")
        .replace("\ufeff", "")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .strip()
        .lstrip("=")
        .strip()
    )


def normalize_notion_page_id(value: str) -> str:
    raw = normalize_cell(value)
    if not raw:
        return ""
    if NOTION_PAGE_ID_RE.fullmatch(raw):
        return raw.lower()
    if NOTION_PAGE_ID_DASHED_RE.fullmatch(raw):
        return raw.replace("-", "").lower()
    m = re.search(r"([0-9a-fA-F]{32})(?:\b|[^0-9a-fA-F])", raw)
    if m:
        return m.group(1).lower()
    return ""


def detect_delimiter(text: str) -> str:
    sample_lines = text.splitlines()[:60]
    best_delim = ","
    best_score = -1.0
    for delim in [",", ";", "\t"]:
        lengths: List[int] = []
        for line in sample_lines:
            try:
                fields = next(csv.reader([line], delimiter=delim))
            except Exception:
                fields = [line]
            lengths.append(len(fields))
        if not lengths:
            continue
        multi = sum(1 for n in lengths if n > 1)
        avg = sum(lengths) / len(lengths)
        score = multi * 1000 + avg
        if score > best_score:
            best_score = score
            best_delim = delim
    return best_delim


def parse_rows(text: str) -> List[List[str]]:
    delim = detect_delimiter(text)
    return list(csv.reader(text.splitlines(), delimiter=delim))


def extract_notion_ids(rows: Iterable[List[str]], col_idx: int, skip_data_rows: int) -> Set[str]:
    out: Set[str] = set()
    for row_idx, row in enumerate(rows, start=1):
        if row_idx <= skip_data_rows:
            continue
        if len(row) <= col_idx:
            continue
        page_id = normalize_notion_page_id(row[col_idx])
        if page_id:
            out.add(page_id)
    return out


def fetch_notion_blocks(page_id: str, token: str) -> list:
    all_blocks = []
    cursor = ""
    while True:
        qs = urllib.parse.urlencode(
            {"page_size": "100", **({"start_cursor": cursor} if cursor else {})}
        )
        url = f"https://api.notion.com/v1/blocks/{urllib.parse.quote(page_id)}/children?{qs}"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
                "User-Agent": "Skadi-Notion-Cache/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results = payload.get("results") or []
        if isinstance(results, list):
            all_blocks.extend(results)
        if not payload.get("has_more") or not payload.get("next_cursor"):
            break
        cursor = str(payload.get("next_cursor"))
    return all_blocks


def warn_notion_page_asset_issues(page_id: str, blocks: list) -> None:
    """Log common causes of 404 images on static Pages + Notion JSON cache."""
    for b in blocks or []:
        if not isinstance(b, dict) or not b.get("type"):
            continue
        t = b["type"]
        if t == "image":
            img = b.get("image") or {}
            if img.get("type") == "file":
                print(
                    f"[notion-cache] WARN {page_id}: Notion-uploaded image block — file URLs expire (~1h). "
                    "Use Image → Link with a stable URL (e.g. Cloudinary secure URL)."
                )
        if t == "code":
            code = b.get("code") or {}
            rich = code.get("rich_text") or []
            plain = "".join(
                str(seg.get("plain_text") or "") for seg in rich if isinstance(seg, dict)
            )
            if "journal/photos" in plain or "journal\\photos" in plain:
                print(
                    f"[notion-cache] WARN {page_id}: Markdown references journal/photos/ — "
                    "those files are not published on GitHub Pages. Use full https://res.cloudinary.com/... URL."
                )


def write_cache_file(out_dir: Path, page_id: str, blocks: list) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{page_id}.json"
    payload = {
        "pageId": page_id,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "blocks": blocks,
    }
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build static Notion cache for deploy artifact.")
    parser.add_argument("--summits-csv-url", required=True)
    parser.add_argument("--bike-csv-url", required=True)
    parser.add_argument("--notion-token", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    token = (args.notion_token or "").strip()
    if not token:
        raise SystemExit("Missing --notion-token")

    summits_rows = parse_rows(http_get_text(args.summits_csv_url))
    bike_rows = parse_rows(http_get_text(args.bike_csv_url))

    notion_ids = set()
    notion_ids.update(extract_notion_ids(summits_rows, SUMMITS_JOURNAL_COL, skip_data_rows=3))
    notion_ids.update(extract_notion_ids(bike_rows, BIKE_JOURNAL_COL, skip_data_rows=1))

    out_dir = Path(args.output_dir)
    if out_dir.exists():
        for old in out_dir.glob("*.json"):
            old.unlink()

    print(f"[notion-cache] IDs discovered: {len(notion_ids)}")
    ok = 0
    failed = 0
    for page_id in sorted(notion_ids):
        try:
            blocks = fetch_notion_blocks(page_id, token)
            warn_notion_page_asset_issues(page_id, blocks)
            write_cache_file(out_dir, page_id, blocks)
            ok += 1
            print(f"[notion-cache] cached {page_id} ({len(blocks)} blocks)")
        except urllib.error.HTTPError as exc:
            failed += 1
            body = exc.read().decode("utf-8", errors="replace")
            print(f"[notion-cache] ERROR {page_id}: HTTP {exc.code} {body[:200]}")
        except Exception as exc:
            failed += 1
            print(f"[notion-cache] ERROR {page_id}: {exc}")

    print(f"[notion-cache] done: ok={ok}, failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
