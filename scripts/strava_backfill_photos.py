#!/usr/bin/env python3
"""
Backfill photo URLs into column S of the Google Sheet for rows that have a
Strava URL in column P and empty column S. Uses Strava API GET /activities/{id}/photos.
"""
import os
import re
import time
from typing import List, Optional

import requests

# Reuse auth and sheet helpers from strava_sync (no duplication).
from strava_sync import (
    build_sheets_service,
    get_sheet_id,
    get_strava_access_token,
    _optional_env,
    _required_env,
)
STRAVA_PHOTOS_URL = "https://www.strava.com/api/v3/activities/{activity_id}/photos"

# Column indices (0-based): A=0, ..., P=15 (Strava URL), ..., S=18 (photo URLs)
COL_P = 15
COL_S = 18
COL_D_NAME = 3


def _cell(row: List[str], idx: int) -> str:
    return row[idx].strip() if len(row) > idx else ""


def _extract_strava_activity_id(url: str) -> Optional[str]:
    """Extract activity ID from URL like https://www.strava.com/activities/17317103730."""
    url = (url or "").strip()
    match = re.search(r"strava\.com/activities/(\d+)", url, re.IGNORECASE)
    return match.group(1) if match else None


def _is_strava_url(url: str) -> bool:
    return "strava" in (url or "").lower() and _extract_strava_activity_id(url) is not None


def _fetch_photo_urls(access_token: str, activity_id: str) -> List[str]:
    """
    GET /activities/{id}/photos?size=2048&photo_sources=true.
    Returns list of photo URLs (prefer size 2048, else largest available).
    """
    url = STRAVA_PHOTOS_URL.format(activity_id=activity_id)
    params = {"size": 2048, "photo_sources": "true"}
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        return []
    urls = []
    for photo in data:
        u = photo.get("urls") if isinstance(photo, dict) else None
        if not isinstance(u, dict):
            continue
        # Prefer "2048", else largest numeric key available
        if "2048" in u and u["2048"]:
            urls.append(str(u["2048"]).strip())
            continue
        size_keys = [k for k in u if isinstance(k, str) and k.isdigit()]
        if not size_keys:
            # fallback: any string value
            for v in u.values():
                if v and isinstance(v, str):
                    urls.append(v.strip())
                    break
            continue
        best = max(size_keys, key=int)
        if u.get(best):
            urls.append(str(u[best]).strip())
    return urls


def main() -> None:
    client_id = _required_env("STRAVA_CLIENT_ID")
    client_secret = _required_env("STRAVA_CLIENT_SECRET")
    refresh_token = _required_env("STRAVA_REFRESH_TOKEN")
    spreadsheet_id = _required_env("GOOGLE_SHEETS_SPREADSHEET_ID")
    sheet_name = _required_env("GOOGLE_SHEETS_TAB_NAME")
    sa_json = _optional_env("GOOGLE_SERVICE_ACCOUNT_JSON")

    access_token = get_strava_access_token(client_id, client_secret, refresh_token)
    sheets_service = build_sheets_service(sa_json)
    get_sheet_id(sheets_service, spreadsheet_id=spreadsheet_id, sheet_name=sheet_name)

    range_name = f"{sheet_name}!A:S"
    values_resp = sheets_service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=range_name,
    ).execute()
    rows = values_resp.get("values", [])

    updated = 0
    skipped_filled = 0
    skipped_no_strava = 0
    processed = 0

    for i, row in enumerate(rows):
        row_1 = i + 1
        # Pad row so we can index P and S
        while len(row) <= COL_S:
            row.append("")
        strava_url = _cell(row, COL_P)
        col_s_value = _cell(row, COL_S)
        activity_name = _cell(row, COL_D_NAME) or f"Row {row_1}"

        if col_s_value:
            skipped_filled += 1
            continue
        if not _is_strava_url(strava_url):
            skipped_no_strava += 1
            continue

        activity_id = _extract_strava_activity_id(strava_url)
        if not activity_id:
            continue

        processed += 1
        time.sleep(1)
        try:
            photo_urls = _fetch_photo_urls(access_token, activity_id)
        except requests.RequestException as e:
            print(
                f"Row {row_1} | activity_name={activity_name!r} | activity_id={activity_id} | "
                f"photos=ERROR | updated=no | error={e}"
            )
            continue

        if not photo_urls:
            value_to_write = "none"
        else:
            value_to_write = "|".join(photo_urls)

        sheets_service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{sheet_name}!S{row_1}",
            valueInputOption="RAW",
            body={"values": [[value_to_write]]},
        ).execute()

        updated += 1
        print(
            f"Row {row_1} | activity_name={activity_name!r} | activity_id={activity_id} | "
            f"photos={len(photo_urls)} | updated=yes (S={value_to_write[:50]}{'...' if len(value_to_write) > 50 else ''})"
        )

    print(
        f"Backfill complete: processed={processed}, updated={updated}, "
        f"skipped_already_filled={skipped_filled}, skipped_no_strava_url={skipped_no_strava}"
    )


if __name__ == "__main__":
    main()
