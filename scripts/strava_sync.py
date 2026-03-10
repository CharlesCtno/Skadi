import json
import os
import re
import time
import argparse
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import gpxpy
import requests
from google.auth import default as google_auth_default
from googleapiclient.errors import HttpError
from google.oauth2 import service_account
from googleapiclient.discovery import build


STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities"
STRAVA_EXPORT_GPX_URL = "https://www.strava.com/api/v3/activities/{activity_id}/export_gpx"
STRAVA_STREAMS_URL = "https://www.strava.com/api/v3/activities/{activity_id}/streams"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

STATE_PATH = Path("data/strava_last_sync.json")
SUMMITS_RAW_DIR = Path("data/raw")
BIKE_RAW_DIR = Path("data/bike/raw")

# Read through P so we can conditionally write the Strava activity URL.
SHEET_RANGE = "A:P"

BIKE_TYPES = {
    "Ride",
    "VirtualRide",
    "EBikeRide",
    "MountainBikeRide",
    "GravelRide",
    "Handcycle",
    "Velomobile",
    "Wheelchair",
}


@dataclass
class StravaActivity:
    activity_id: int
    name: str
    type: str
    type_source_field: str
    type_source_value: str
    distance_km: str
    duration_h: str
    elevation_gain_m: str
    season: str
    start_date_epoch: int
    status: str


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _optional_env(name: str) -> str:
    return os.getenv(name, "").strip()


def activity_title_to_gpx_filename(activity_title: str) -> str:
    """Convention: replace spaces with underscores and append .gpx."""
    title = (activity_title or "").strip()
    if not title:
        return "strava_activity.gpx"
    return re.sub(r"\s+", "_", title) + ".gpx"


def _format_decimal(value: float, digits: int = 2) -> str:
    return f"{value:.{digits}f}"


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def season_from_month(month: int) -> str:
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5):
        return "Spring"
    if month in (6, 7, 8):
        return "Summer"
    return "Autumn"


def _normalize_activity_type(value: str) -> str:
    return re.sub(r"[\s_]+", "", (value or "").strip().lower())


def detect_activity_type_fields(payload: dict) -> Tuple[str, str, str]:
    """
    Return (canonical_type, source_field, source_value).
    Checks both sport_type and type, preferring recognized values.
    """
    candidates = [
        ("sport_type", str(payload.get("sport_type") or "").strip()),
        ("type", str(payload.get("type") or "").strip()),
    ]

    canonical_by_normalized = {
        "hike": "Hike",
        "backcountryski": "BackcountrySki",
    }

    for field, raw in candidates:
        if not raw:
            continue
        canonical = canonical_by_normalized.get(_normalize_activity_type(raw))
        if canonical:
            return canonical, field, raw

    # Fallback to first non-empty field when not in known mapping.
    for field, raw in candidates:
        if raw:
            return raw, field, raw
    return "Workout", "none", ""


def sheet_type_from_strava_activity_type(activity_type: str) -> str:
    normalized = _normalize_activity_type(activity_type)
    if normalized == "hike":
        return "Hike"
    if normalized == "backcountryski":
        return "Ski"
    return ""


def get_strava_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    response = requests.post(
        STRAVA_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Strava token exchange did not return access_token")
    return token


def load_state() -> Dict[str, int]:
    if not STATE_PATH.exists():
        return {"last_synced_epoch": 0, "last_synced_activity_id": 0}
    with STATE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return {
        "last_synced_epoch": int(data.get("last_synced_epoch", 0)),
        "last_synced_activity_id": int(data.get("last_synced_activity_id", 0)),
    }


def save_state(last_epoch: int, last_activity_id: int) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_synced_epoch": int(last_epoch),
        "last_synced_activity_id": int(last_activity_id),
        "updated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    with STATE_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")


def fetch_new_activities(access_token: str, after_epoch: int) -> List[dict]:
    headers = {"Authorization": f"Bearer {access_token}"}
    page = 1
    per_page = 200
    results: List[dict] = []
    while True:
        response = requests.get(
            STRAVA_ACTIVITIES_URL,
            headers=headers,
            params={"after": after_epoch, "page": page, "per_page": per_page},
            timeout=30,
        )
        response.raise_for_status()
        items = response.json()
        if not items:
            break
        results.extend(items)
        if len(items) < per_page:
            break
        page += 1
    # Strava usually returns newest first; process oldest first for stable insertion order.
    results.sort(key=lambda a: a.get("start_date", ""))
    return results


def find_activity_by_exact_name(access_token: str, activity_name: str) -> Optional[dict]:
    """Search all Strava activity pages and return the first exact-name match."""
    headers = {"Authorization": f"Bearer {access_token}"}
    page = 1
    per_page = 200
    target = activity_name.strip()

    while True:
        response = requests.get(
            STRAVA_ACTIVITIES_URL,
            headers=headers,
            params={"page": page, "per_page": per_page},
            timeout=30,
        )
        response.raise_for_status()
        items = response.json()
        if not items:
            return None

        for item in items:
            if str(item.get("name", "")).strip() == target:
                return item

        if len(items) < per_page:
            return None
        page += 1


def fetch_most_recent_activity(access_token: str) -> Optional[dict]:
    """Fetch the latest activity (newest) to initialize sync cursor on first run."""
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.get(
        STRAVA_ACTIVITIES_URL,
        headers=headers,
        params={"page": 1, "per_page": 1},
        timeout=30,
    )
    response.raise_for_status()
    items = response.json()
    if not items:
        return None
    return items[0]


def download_gpx(access_token: str, activity_id: int) -> bytes:
    headers = {"Authorization": f"Bearer {access_token}"}
    url = STRAVA_EXPORT_GPX_URL.format(activity_id=activity_id)
    response = requests.get(url, headers=headers, timeout=60)
    response.raise_for_status()
    return response.content


def _build_minimal_gpx_from_streams(activity_id: int, streams_payload: dict) -> bytes:
    latlng_stream = streams_payload.get("latlng", {})
    altitude_stream = streams_payload.get("altitude", {})
    time_stream = streams_payload.get("time", {})

    latlng_data = latlng_stream.get("data") or []
    altitude_data = altitude_stream.get("data") or []
    time_data = time_stream.get("data") or []

    if not latlng_data:
        raise RuntimeError(f"No latlng stream available for activity {activity_id}")

    gpx = ET.Element(
        "gpx",
        attrib={
            "version": "1.1",
            "creator": "Skadi Strava Sync",
            "xmlns": "http://www.topografix.com/GPX/1/1",
        },
    )
    trk = ET.SubElement(gpx, "trk")
    name = ET.SubElement(trk, "name")
    name.text = str(activity_id)
    trkseg = ET.SubElement(trk, "trkseg")

    for idx, pair in enumerate(latlng_data):
        if not isinstance(pair, list) or len(pair) != 2:
            continue
        lat, lon = pair[0], pair[1]
        trkpt = ET.SubElement(trkseg, "trkpt", attrib={"lat": str(lat), "lon": str(lon)})
        if idx < len(altitude_data):
            ele = ET.SubElement(trkpt, "ele")
            ele.text = str(altitude_data[idx])
        if idx < len(time_data):
            # Keep elapsed seconds to preserve ordering when present.
            t = ET.SubElement(trkpt, "time")
            t.text = str(time_data[idx])

    return ET.tostring(gpx, encoding="utf-8", xml_declaration=True)


def download_gpx_with_fallback(access_token: str, activity_id: int) -> bytes:
    """Try export_gpx endpoint first; fallback to streams-built minimal GPX on 404."""
    try:
        return download_gpx(access_token, activity_id)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status != 404:
            raise

    print(f"export_gpx unavailable for activity {activity_id} (HTTP 404). Falling back to streams.")
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.get(
        STRAVA_STREAMS_URL.format(activity_id=activity_id),
        headers=headers,
        params={"keys": "latlng,altitude,time", "key_by_type": "true"},
        timeout=60,
    )
    response.raise_for_status()
    streams_payload = response.json()
    return _build_minimal_gpx_from_streams(activity_id, streams_payload)


def parse_gpx_start_coords(gpx_bytes: bytes) -> Tuple[Optional[float], Optional[float]]:
    gpx = gpxpy.parse(gpx_bytes.decode("utf-8", errors="ignore"))
    for track in gpx.tracks:
        for segment in track.segments:
            if segment.points:
                first = segment.points[0]
                return first.latitude, first.longitude
    return None, None


def _row_cell(row: List[str], idx: int) -> str:
    return row[idx].strip() if len(row) > idx else ""


def _try_float(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def find_matching_summit_row(values: List[List[str]], summit_name: str) -> Optional[int]:
    target = _normalize(summit_name)
    for row_idx, row in enumerate(values, start=1):
        if _normalize(_row_cell(row, 3)) == target:
            return row_idx
    return None


def find_insert_row_below_closest_coordinate(
    values: List[List[str]], start_lat: Optional[float], start_lon: Optional[float]
) -> Optional[int]:
    """Return 1-based row index where to insert (immediately below closest F/G row)."""
    if start_lat is None or start_lon is None:
        return None

    best_distance_sq: Optional[float] = None
    best_row_1: Optional[int] = None
    for row_1, row in enumerate(values, start=1):
        lat = _try_float(_row_cell(row, 5))  # F
        lon = _try_float(_row_cell(row, 6))  # G
        if lat is None or lon is None:
            continue
        distance_sq = (lat - start_lat) ** 2 + (lon - start_lon) ** 2
        if best_distance_sq is None or distance_sq < best_distance_sq:
            best_distance_sq = distance_sq
            best_row_1 = row_1

    if best_row_1 is None:
        return None
    return best_row_1 + 1


def _parse_ele_to_int_string(ele_raw: str) -> Optional[str]:
    if not ele_raw:
        return None
    match = re.search(r"[-+]?\d+(?:[.,]\d+)?", ele_raw)
    if not match:
        return None
    value = float(match.group(0).replace(",", "."))
    return str(int(round(value)))


def _is_peak_result(item: dict) -> bool:
    extratags = item.get("extratags") or {}
    if str(extratags.get("natural", "")).strip().lower() == "peak":
        return True
    # Nominatim often exposes peak semantics in top-level class/type.
    return (
        str(item.get("class", "")).strip().lower() == "natural"
        and str(item.get("type", "")).strip().lower() == "peak"
    )


def _nominatim_query_variants(summit_name: str) -> List[str]:
    name = summit_name.strip()
    variants = [name]
    # Common FR naming variation: "Monts X" vs "Mont X"
    if name.lower().startswith("monts "):
        variants.append("Mont " + name[6:])
    if name.lower().startswith("mont "):
        variants.append("Monts " + name[5:])
    # Deduplicate while preserving order.
    seen = set()
    out = []
    for v in variants:
        k = v.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(v)
    return out


def fetch_peak_from_nominatim(
    summit_name: str, start_lat: Optional[float], start_lon: Optional[float]
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Query Nominatim and return (ele_m, lat, lon) for the best peak match.
    - Filters to extratags.natural == "peak"
    - Chooses nearest candidate to GPX start coordinates (Euclidean)
    - Returns None values when unavailable.
    """
    candidates = []
    for query in _nominatim_query_variants(summit_name):
        items = []
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                response = requests.get(
                    NOMINATIM_SEARCH_URL,
                    params={
                        "q": query,
                        "format": "json",
                        "extratags": 1,
                        "limit": 10,
                    },
                    headers={"User-Agent": "SkadiApp/1.0"},
                    timeout=30,
                )
                if response.status_code == 429:
                    retry_after_raw = response.headers.get("Retry-After", "").strip()
                    try:
                        retry_after = float(retry_after_raw) if retry_after_raw else float(2 ** attempt)
                    except ValueError:
                        retry_after = float(2 ** attempt)
                    print(
                        f"WARNING: Nominatim rate-limited query '{query}' (attempt {attempt}/{max_attempts}). "
                        f"Retrying in {retry_after:.1f}s."
                    )
                    time.sleep(retry_after)
                    continue

                response.raise_for_status()
                items = response.json()
                break
            except requests.RequestException as exc:
                if attempt == max_attempts:
                    print(
                        f"WARNING: Nominatim request failed for '{query}' after {max_attempts} attempts: {exc}. "
                        "Altitude and coordinates left blank."
                    )
                    items = []
                else:
                    backoff = float(2 ** attempt)
                    print(
                        f"WARNING: Nominatim request error for '{query}' (attempt {attempt}/{max_attempts}): {exc}. "
                        f"Retrying in {backoff:.1f}s."
                    )
                    time.sleep(backoff)
            finally:
                # Respect Nominatim rate limits (1 request/sec max).
                time.sleep(1.0)

        for item in items:
            if not _is_peak_result(item):
                continue
            lat = _try_float(str(item.get("lat", "")))
            lon = _try_float(str(item.get("lon", "")))
            if lat is None or lon is None:
                continue
            candidates.append((item, lat, lon))

        if candidates:
            break

    if not candidates:
        print(f'WARNING: No peak found on OpenStreetMap for "{summit_name}" — altitude and coordinates left blank')
        return None, None, None

    if start_lat is None or start_lon is None:
        chosen_item, chosen_lat, chosen_lon = candidates[0]
    else:
        chosen_item, chosen_lat, chosen_lon = min(
            candidates,
            key=lambda c: (c[1] - start_lat) ** 2 + (c[2] - start_lon) ** 2,
        )

    extratags = chosen_item.get("extratags") or {}
    ele = _parse_ele_to_int_string(str(extratags.get("ele", "")))
    if ele is None:
        print(f'WARNING: No elevation tag found for "{summit_name}" on OpenStreetMap')

    return ele, str(chosen_lat), str(chosen_lon)


def build_sheets_service(sa_json: Optional[str]):
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    if sa_json:
        info = json.loads(sa_json)
        creds = service_account.Credentials.from_service_account_info(
            info,
            scopes=scopes,
        )
        print("Google auth mode: service account JSON from env.")
    else:
        creds, _ = google_auth_default(scopes=scopes)
        print("Google auth mode: Application Default Credentials (ADC).")
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def get_sheet_id(sheets_service, spreadsheet_id: str, sheet_name: str) -> int:
    sheet_meta = sheets_service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    target_sheet = next(
        (s for s in sheet_meta.get("sheets", []) if s.get("properties", {}).get("title") == sheet_name),
        None,
    )
    if not target_sheet:
        raise RuntimeError(f"Sheet tab '{sheet_name}' not found in spreadsheet.")
    return int(target_sheet["properties"]["sheetId"])


def update_existing_row_auto_fields(
    sheets_service,
    spreadsheet_id: str,
    sheet_name: str,
    row_1: int,
    existing_row: List[str],
    ele_m: Optional[str],
    summit_lat: Optional[str],
    summit_lon: Optional[str],
    strava_activity_type: str,
    season: str,
    distance_km: str,
    duration_h: str,
    elevation_gain_m: str,
    gpx_file: str,
    activity_url: str,
) -> None:
    sheet_type = sheet_type_from_strava_activity_type(strava_activity_type)
    data = [
        {"range": f"{sheet_name}!H{row_1}", "values": [[season]]},
        {"range": f"{sheet_name}!K{row_1}:N{row_1}", "values": [[distance_km, duration_h, elevation_gain_m, gpx_file]]},
    ]
    # If status is explicitly "to do", clear it when this summit gets matched to a completed activity.
    if _row_cell(existing_row, 2).lower() == "to do":
        data.append({"range": f"{sheet_name}!C{row_1}", "values": [[""]]})

    # Do not overwrite E/F/G if already filled.
    if not _row_cell(existing_row, 4) and ele_m is not None:
        data.append({"range": f"{sheet_name}!E{row_1}", "values": [[ele_m]]})
    if not _row_cell(existing_row, 5) and summit_lat is not None:
        data.append({"range": f"{sheet_name}!F{row_1}", "values": [[summit_lat]]})
    if not _row_cell(existing_row, 6) and summit_lon is not None:
        data.append({"range": f"{sheet_name}!G{row_1}", "values": [[summit_lon]]})
    # Do not overwrite I (Type) if already filled.
    if not _row_cell(existing_row, 8) and sheet_type:
        data.append({"range": f"{sheet_name}!I{row_1}", "values": [[sheet_type]]})
    # Do not overwrite P (Strava URL) if already filled.
    if not _row_cell(existing_row, 15) and activity_url:
        data.append({"range": f"{sheet_name}!P{row_1}", "values": [[activity_url]]})

    for item in data:
        try:
            sheets_service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=item["range"],
                valueInputOption="RAW",
                body={"values": item["values"]},
            ).execute()
        except HttpError as exc:
            status = exc.resp.status if exc.resp is not None else None
            message = str(exc)
            if status == 400 and "protected cell or object" in message.lower():
                print(
                    f"WARNING: Skipping protected range {item['range']} "
                    "while updating existing summit row."
                )
                continue
            raise


def insert_new_row_at(
    sheets_service,
    spreadsheet_id: str,
    sheet_id: int,
    sheet_name: str,
    insert_row_1: int,
    row_values: List[str],
) -> None:
    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "insertDimension": {
                        "range": {
                            "sheetId": sheet_id,
                            "dimension": "ROWS",
                            "startIndex": insert_row_1 - 1,
                            "endIndex": insert_row_1,
                        },
                        "inheritFromBefore": True,
                    }
                }
            ]
        },
    ).execute()

    target_range = f"{sheet_name}!A{insert_row_1}:P{insert_row_1}"
    sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=target_range,
        valueInputOption="RAW",
        body={"values": [row_values]},
    ).execute()


def split_summit_names(activity_title: str) -> List[str]:
    parts = [p.strip() for p in activity_title.split("&")]
    names = [p for p in parts if p]
    return names or [activity_title.strip()]


def upsert_activity_summits_to_sheet(
    sheets_service,
    spreadsheet_id: str,
    sheet_name: str,
    sheet_id: int,
    activity_title: str,
    strava_activity_type: str,
    season: str,
    distance_km: str,
    duration_h: str,
    elevation_gain_m: str,
    gpx_file_value: str,
    activity_url: str,
    start_lat: Optional[float],
    start_lon: Optional[float],
) -> Dict[str, int]:
    """
    Upsert all summit names extracted from activity_title.
    - Match by column D (case-insensitive) -> update K-N.
    - If no match -> insert immediately below closest existing row with valid F/G.
    """
    range_name = f"{sheet_name}!{SHEET_RANGE}"
    values_resp = sheets_service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=range_name,
    ).execute()
    values = values_resp.get("values", [])

    matched = 0
    created = 0
    summit_names = split_summit_names(activity_title)

    for summit_name in summit_names:
        ele_m, osm_lat, osm_lon = fetch_peak_from_nominatim(summit_name, start_lat=start_lat, start_lon=start_lon)
        match_row_1 = find_matching_summit_row(values, summit_name)
        if match_row_1 is not None:
            existing_row = values[match_row_1 - 1]
            update_existing_row_auto_fields(
                sheets_service=sheets_service,
                spreadsheet_id=spreadsheet_id,
                sheet_name=sheet_name,
                row_1=match_row_1,
                existing_row=existing_row,
                ele_m=ele_m,
                summit_lat=osm_lat,
                summit_lon=osm_lon,
                strava_activity_type=strava_activity_type,
                season=season,
                distance_km=distance_km,
                duration_h=duration_h,
                elevation_gain_m=elevation_gain_m,
                gpx_file=gpx_file_value,
                activity_url=activity_url,
            )
            row = existing_row
            while len(row) < 16:
                row.append("")
            if _row_cell(row, 2).lower() == "to do":
                row[2] = ""  # C
            if not _row_cell(row, 4) and ele_m is not None:
                row[4] = ele_m  # E
            if not _row_cell(row, 5) and osm_lat is not None:
                row[5] = osm_lat  # F
            if not _row_cell(row, 6) and osm_lon is not None:
                row[6] = osm_lon  # G
            row[7] = season  # H
            sheet_type = sheet_type_from_strava_activity_type(strava_activity_type)
            if not _row_cell(row, 8) and sheet_type:
                row[8] = sheet_type  # I
            row[10] = distance_km  # K
            row[11] = duration_h  # L
            row[12] = elevation_gain_m  # M
            row[13] = gpx_file_value  # N
            if not _row_cell(row, 15) and activity_url:
                row[15] = activity_url  # P
            matched += 1
            print(
                f"MATCHED summit '{summit_name}' -> row {match_row_1}. "
                f"Updated H and K-N with GPX '{gpx_file_value}' and P when empty."
            )
            continue

        print(
            f'WARNING: No match found in sheet for summit "{summit_name}" — '
            "row will be inserted below the closest existing coordinates"
        )

        insert_row_1 = find_insert_row_below_closest_coordinate(values, start_lat, start_lon)
        if insert_row_1 is None:
            insert_row_1 = len(values) + 1
            print('WARNING: No existing coordinates found in sheet — appended at bottom')

        # A..P: D, H, K-N and P are auto-filled; E/F/G come from OSM when available.
        # I/J and O stay blank by design.
        sheet_type = sheet_type_from_strava_activity_type(strava_activity_type)
        new_row = [
            "",  # A
            "",  # B
            "",  # C
            summit_name,  # D
            ele_m or "",  # E
            osm_lat or "",  # F
            osm_lon or "",  # G
            season,  # H
            sheet_type,  # I
            "",  # J
            distance_km,  # K
            duration_h,  # L
            elevation_gain_m,  # M
            gpx_file_value,  # N
            "",  # O
            activity_url,  # P
        ]
        insert_new_row_at(
            sheets_service=sheets_service,
            spreadsheet_id=spreadsheet_id,
            sheet_id=sheet_id,
            sheet_name=sheet_name,
            insert_row_1=insert_row_1,
            row_values=new_row,
        )
        values.insert(insert_row_1 - 1, new_row)
        created += 1
        print(
            f"CREATED summit '{summit_name}' -> row {insert_row_1} below closest coordinates row. "
            f"Filled D, H, K-N and P with GPX '{gpx_file_value}'."
        )

    return {"processed_summits": len(summit_names), "matched": matched, "created": created}


def to_activity_model(a: dict) -> StravaActivity:
    activity_id = int(a["id"])
    name = a.get("name", f"Strava {activity_id}")
    activity_type, type_source_field, type_source_value = detect_activity_type_fields(a)
    distance_m = float(a.get("distance") or 0)
    moving_time_s = float(a.get("moving_time") or 0)
    elev_m = float(a.get("total_elevation_gain") or 0)
    start_date = a.get("start_date")
    if start_date:
        start_dt = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        start_epoch = int(start_dt.timestamp())
        season = season_from_month(start_dt.month)
    else:
        start_epoch = 0
        season = ""
    return StravaActivity(
        activity_id=activity_id,
        name=name,
        type=activity_type,
        type_source_field=type_source_field,
        type_source_value=type_source_value,
        distance_km=_format_decimal(distance_m / 1000.0, 2),
        duration_h=_format_decimal(moving_time_s / 3600.0, 2),
        elevation_gain_m=_format_decimal(elev_m, 0),
        season=season,
        start_date_epoch=start_epoch,
        status="completed",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Strava activities to Skadi sheet/GPX.")
    parser.add_argument(
        "--activity-name",
        dest="activity_name",
        help="Exact Strava activity name to sync (searches across all pages).",
    )
    args = parser.parse_args()

    client_id = _required_env("STRAVA_CLIENT_ID")
    client_secret = _required_env("STRAVA_CLIENT_SECRET")
    refresh_token = _required_env("STRAVA_REFRESH_TOKEN")
    spreadsheet_id = _required_env("GOOGLE_SHEETS_SPREADSHEET_ID")
    sheet_name = _required_env("GOOGLE_SHEETS_TAB_NAME")
    sa_json = _optional_env("GOOGLE_SERVICE_ACCOUNT_JSON")
    manual_activity_name = (args.activity_name or _optional_env("ACTIVITY_NAME")).strip()
    is_manual_mode = bool(manual_activity_name)

    access_token = get_strava_access_token(client_id, client_secret, refresh_token)
    state_exists = STATE_PATH.exists()
    state = load_state()
    after_epoch = state["last_synced_epoch"]
    after_activity_id = state["last_synced_activity_id"]

    if is_manual_mode:
        print(f"Manual sync mode: searching exact activity name '{manual_activity_name}' across all Strava pages.")
        matched = find_activity_by_exact_name(access_token, manual_activity_name)
        if matched is None:
            raise RuntimeError(f'ERROR: No Strava activity found with name "{manual_activity_name}"')
        activities_raw = [matched]
        # Manual mode bypasses time-window/state filtering.
        after_epoch = -1
        after_activity_id = -1
    else:
        # First-run bootstrap: initialize sync cursor and do NOT import historical activities.
        if (not state_exists) or (after_epoch == 0 and after_activity_id == 0):
            latest = fetch_most_recent_activity(access_token)
            if latest is None:
                bootstrap_epoch = int(datetime.now(timezone.utc).timestamp())
                bootstrap_activity_id = 0
            else:
                bootstrap = to_activity_model(latest)
                bootstrap_epoch = bootstrap.start_date_epoch
                bootstrap_activity_id = bootstrap.activity_id
            save_state(last_epoch=bootstrap_epoch, last_activity_id=bootstrap_activity_id)
            print(
                "Initialized Strava sync state on first run; no activities imported. "
                f"Cursor set to epoch={bootstrap_epoch}, activity_id={bootstrap_activity_id}."
            )
            return

        activities_raw = fetch_new_activities(access_token, after_epoch)
        if not activities_raw:
            print("No new Strava activities to sync.")
            return

    sheets_service = build_sheets_service(sa_json)
    sheet_id = get_sheet_id(sheets_service, spreadsheet_id=spreadsheet_id, sheet_name=sheet_name)

    synced = 0
    last_epoch = state["last_synced_epoch"]
    last_activity_id = state["last_synced_activity_id"]
    synced_names: List[str] = []
    sheet_matched_rows = 0
    sheet_created_rows = 0
    sheet_processed_summits = 0

    for raw in activities_raw:
        activity = to_activity_model(raw)
        print(
            f"Activity type detection id={activity.activity_id}: "
            f"field={activity.type_source_field}, value='{activity.type_source_value}', "
            f"canonical='{activity.type}'"
        )
        if activity.start_date_epoch < after_epoch:
            continue
        if activity.start_date_epoch == after_epoch and activity.activity_id <= after_activity_id:
            continue
        if (not is_manual_mode) and _normalize_activity_type(activity.type) != "hike":
            print(
                f"Skipping activity id={activity.activity_id} "
                f"name='{activity.name}' type='{activity.type}' (only Hike is synced)."
            )
            last_epoch = max(last_epoch, activity.start_date_epoch)
            last_activity_id = max(last_activity_id, activity.activity_id)
            continue

        out_dir = SUMMITS_RAW_DIR
        out_dir.mkdir(parents=True, exist_ok=True)

        gpx_filename = activity_title_to_gpx_filename(activity.name)
        gpx_file_value = gpx_filename
        activity_url = f"https://www.strava.com/activities/{activity.activity_id}"
        gpx_rel_path = out_dir / gpx_filename
        try:
            gpx_bytes = download_gpx_with_fallback(access_token, activity.activity_id)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in {401, 403, 404}:
                print(
                    f"Skipping activity id={activity.activity_id} name='{activity.name}': "
                    f"GPX unavailable (HTTP {status}) even after fallback."
                )
                if not is_manual_mode:
                    last_epoch = max(last_epoch, activity.start_date_epoch)
                    last_activity_id = max(last_activity_id, activity.activity_id)
                continue
            raise
        except RuntimeError as exc:
            print(
                f"Skipping activity id={activity.activity_id} name='{activity.name}': "
                f"{exc}"
            )
            if not is_manual_mode:
                last_epoch = max(last_epoch, activity.start_date_epoch)
                last_activity_id = max(last_activity_id, activity.activity_id)
            continue
        gpx_rel_path.write_bytes(gpx_bytes)

        lat, lon = parse_gpx_start_coords(gpx_bytes)
        upsert_result = upsert_activity_summits_to_sheet(
            sheets_service=sheets_service,
            spreadsheet_id=spreadsheet_id,
            sheet_name=sheet_name,
            sheet_id=sheet_id,
            activity_title=activity.name,
            strava_activity_type=activity.type,
            season=activity.season,
            distance_km=activity.distance_km,
            duration_h=activity.duration_h,
            elevation_gain_m=activity.elevation_gain_m,
            gpx_file_value=gpx_file_value,
            activity_url=activity_url,
            start_lat=lat,
            start_lon=lon,
        )

        synced += 1
        synced_names.append(activity.name)
        sheet_matched_rows += int(upsert_result.get("matched", 0))
        sheet_created_rows += int(upsert_result.get("created", 0))
        sheet_processed_summits += int(upsert_result.get("processed_summits", 0))
        last_epoch = max(last_epoch, activity.start_date_epoch)
        last_activity_id = max(last_activity_id, activity.activity_id)
        print(
            f"Synced activity id={activity.activity_id} name='{activity.name}' "
            f"type={activity.type} gpx='{gpx_rel_path}' processed_summits={upsert_result['processed_summits']}"
        )

    state_advanced = (
        last_epoch != state["last_synced_epoch"]
        or last_activity_id != state["last_synced_activity_id"]
    )

    if synced:
        save_state(last_epoch=last_epoch, last_activity_id=last_activity_id)
        summary = ", ".join(synced_names[:3])
        if len(synced_names) > 3:
            summary += f" (+{len(synced_names) - 3} more)"
        print(f"Synced {synced} activities. Summary: {summary}")
        print(
            "Sheet write summary: "
            f"processed_summits={sheet_processed_summits}, "
            f"matched_rows={sheet_matched_rows}, created_rows={sheet_created_rows}."
        )
    elif state_advanced:
        save_state(last_epoch=last_epoch, last_activity_id=last_activity_id)
        print("No activities synced, but sync cursor advanced to avoid reprocessing.")
    else:
        print("No activities were synced after filtering.")


if __name__ == "__main__":
    main()
