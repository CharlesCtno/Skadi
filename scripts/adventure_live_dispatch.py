import argparse
import base64
import binascii
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import requests


ACTIVE_TRIP_PATH = Path("live/activeTrip.json")
TRIPS_DIR = Path("live/trips")
TRIP_ID_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_[A-Za-z0-9._-]+$")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def iso_now_local() -> str:
    return datetime.now().astimezone().isoformat()


def validate_trip_id(trip_id: str) -> str:
    value = (trip_id or "").strip()
    if not value:
        raise ValueError("trip_id is required")
    if not TRIP_ID_RE.match(value):
        raise ValueError("trip_id must match YYYY-MM-DD_name")
    return value


def parse_point(lat_raw: str, lng_raw: str, lon_raw: str, ts_raw: str, accuracy_raw: str) -> Dict[str, Any]:
    lng_source = (lng_raw or "").strip() or (lon_raw or "").strip()
    try:
        lat = float(lat_raw)
        lng = float(lng_source)
    except Exception as exc:
        raise ValueError(f"invalid lat/lng: {exc}") from exc
    if lat < -90 or lat > 90:
        raise ValueError("lat must be between -90 and 90")
    if lng < -180 or lng > 180:
        raise ValueError("lng must be between -180 and 180")
    ts = (ts_raw or "").strip() or iso_now_local()
    point = {"lat": lat, "lng": lng, "ts": ts}
    accuracy = (accuracy_raw or "").strip()
    if accuracy:
        try:
            point["accuracy"] = float(accuracy)
        except Exception:
            pass
    return point


def get_points_path(trip_id: str) -> Path:
    return TRIPS_DIR / trip_id / "points.json"


def get_photo_path(trip_id: str, point_id: str) -> Path:
    return TRIPS_DIR / trip_id / "photos" / f"{point_id}.jpg"


def sorted_points(points: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def keyfn(p: Dict[str, Any]) -> str:
        return str(p.get("ts") or "")
    return sorted(points, key=keyfn)


def ensure_active_shape(raw: Dict[str, Any]) -> Dict[str, Any]:
    out = {
        "isActive": bool(raw.get("isActive", False)),
        "tripId": str(raw.get("tripId", "") or ""),
        "tripName": str(raw.get("tripName", "") or ""),
        "updatedAt": str(raw.get("updatedAt", "") or ""),
        "liveDayActive": bool(raw.get("liveDayActive", False)),
        "liveDayUpdatedAt": str(raw.get("liveDayUpdatedAt", "") or ""),
    }
    return out


def handle_start_trip(trip_id: str, trip_name: str) -> None:
    payload = {
        "isActive": True,
        "tripId": trip_id,
        "tripName": (trip_name or "").strip() or trip_id,
        "updatedAt": iso_now_local(),
        "liveDayActive": False,
        "liveDayUpdatedAt": "",
    }
    write_json(ACTIVE_TRIP_PATH, payload)
    points_path = get_points_path(trip_id)
    if not points_path.exists():
        write_json(points_path, {"tripId": trip_id, "points": []})


def handle_start_or_stop_live_day(trip_id: str, is_active: bool) -> None:
    active = ensure_active_shape(read_json(ACTIVE_TRIP_PATH, {}))
    if not active.get("isActive"):
        raise ValueError("cannot toggle live day: no active trip")
    if active.get("tripId") != trip_id:
        raise ValueError("trip_id does not match current active trip")
    active["liveDayActive"] = is_active
    active["liveDayUpdatedAt"] = iso_now_local()
    active["updatedAt"] = iso_now_local()
    write_json(ACTIVE_TRIP_PATH, active)


def handle_add_point(trip_id: str, point: Dict[str, Any]) -> None:
    active = ensure_active_shape(read_json(ACTIVE_TRIP_PATH, {}))
    if not active.get("isActive"):
        raise ValueError("cannot add point: no active trip")
    if active.get("tripId") != trip_id:
        raise ValueError("trip_id does not match current active trip")

    points_path = get_points_path(trip_id)
    points_doc = read_json(points_path, {"tripId": trip_id, "points": []})
    points = list(points_doc.get("points") or [])
    points.append(point)
    points_doc["tripId"] = trip_id
    points_doc["points"] = sorted_points(points)
    write_json(points_path, points_doc)

    active["updatedAt"] = point["ts"]
    write_json(ACTIVE_TRIP_PATH, active)


def decode_photo_base64(photo_raw: str) -> bytes:
    raw = (photo_raw or "").strip()
    if not raw:
        return b""
    if raw.startswith("data:"):
        comma_idx = raw.find(",")
        if comma_idx == -1:
            raise ValueError("invalid data URL for photo")
        raw = raw[comma_idx + 1 :]
    try:
        return base64.b64decode(raw, validate=True)
    except binascii.Error as exc:
        raise ValueError(f"invalid base64 photo payload: {exc}") from exc


def upload_photo_to_cloudinary(photo_bytes: bytes, trip_id: str, point_id: str) -> str:
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not cloud_name or not api_key or not api_secret:
        raise ValueError("Missing Cloudinary secrets (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)")

    timestamp = str(int(time.time()))
    folder = f"skadi/live/{trip_id}"
    public_id = point_id
    overwrite = "true"
    to_sign = f"folder={folder}&overwrite={overwrite}&public_id={public_id}&timestamp={timestamp}{api_secret}"
    signature = hashlib.sha1(to_sign.encode("utf-8")).hexdigest()
    endpoint = f"https://api.cloudinary.com/v1_1/{cloud_name}/image/upload"
    files = {
        "file": (f"{point_id}.jpg", photo_bytes, "image/jpeg"),
    }
    data = {
        "api_key": api_key,
        "timestamp": timestamp,
        "signature": signature,
        "folder": folder,
        "public_id": public_id,
        "overwrite": overwrite,
    }
    res = requests.post(endpoint, data=data, files=files, timeout=60)
    if not res.ok:
        raise ValueError(f"Cloudinary upload failed ({res.status_code}): {res.text}")
    payload = res.json()
    secure_url = str(payload.get("secure_url") or "").strip()
    if not secure_url:
        raise ValueError("Cloudinary upload succeeded but secure_url is missing")
    return secure_url


def handle_enrich_point(
    trip_id: str, point_id: str, note: str, photo_raw: str, photo_uploaded: bool = False
) -> None:
    point_id = (point_id or "").strip()
    if not point_id:
        raise ValueError("point_id is required for enrich_point")

    points_path = get_points_path(trip_id)
    points_doc = read_json(points_path, {"tripId": trip_id, "points": []})
    points = list(points_doc.get("points") or [])

    target_index = -1
    for i, point in enumerate(points):
        if str(point.get("ts") or "").strip() == point_id:
            target_index = i
            break
    if target_index < 0:
        raise ValueError("point_id not found in trip points")

    target = dict(points[target_index])
    changed = False

    note_value = (note or "").strip()
    if note_value:
        if str(target.get("note") or "") != note_value:
            target["note"] = note_value
            changed = True

    photo_bytes = decode_photo_base64(photo_raw)
    if photo_bytes:
        photo_url = upload_photo_to_cloudinary(photo_bytes, trip_id, point_id)
        if str(target.get("photo") or "") != photo_url:
            target["photo"] = photo_url
            target.pop("photos", None)
            changed = True
    elif photo_uploaded:
        raise ValueError("photo_uploaded is deprecated; send base64 photo input for Cloudinary upload")

    if changed:
        points[target_index] = target
        points_doc["tripId"] = trip_id
        points_doc["points"] = points
        write_json(points_path, points_doc)


def handle_stop_trip(trip_id: str) -> None:
    active = ensure_active_shape(read_json(ACTIVE_TRIP_PATH, {}))
    if active.get("tripId") and active.get("tripId") != trip_id:
        raise ValueError("trip_id does not match current active trip")
    active.update({
        "isActive": False,
        "tripId": "",
        "tripName": "",
        "updatedAt": iso_now_local(),
        "liveDayActive": False,
        "liveDayUpdatedAt": "",
    })
    write_json(ACTIVE_TRIP_PATH, active)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply adventure live event to JSON files.")
    parser.add_argument("--action", required=True, choices=["start_trip", "start_live_day", "add_point", "enrich_point", "stop_live_day", "stop_trip"])
    parser.add_argument("--trip-id", required=True)
    parser.add_argument("--trip-name", default="")
    parser.add_argument("--lat", default="")
    parser.add_argument("--lng", default="")
    parser.add_argument("--lon", default="")
    parser.add_argument("--accuracy", default="")
    parser.add_argument("--ts", default="")
    parser.add_argument("--point-id", default="")
    parser.add_argument("--note", default="")
    parser.add_argument("--photo", default="")
    parser.add_argument("--photo-uploaded", default="false")
    args = parser.parse_args()

    try:
        trip_id = validate_trip_id(args.trip_id)
        action = args.action
        if action == "start_trip":
            handle_start_trip(trip_id, args.trip_name)
        elif action == "start_live_day":
            handle_start_or_stop_live_day(trip_id, True)
        elif action == "stop_live_day":
            handle_start_or_stop_live_day(trip_id, False)
        elif action == "add_point":
            point = parse_point(args.lat, args.lng, args.lon, args.ts, args.accuracy)
            handle_add_point(trip_id, point)
        elif action == "enrich_point":
            photo_uploaded = (args.photo_uploaded or "").strip().lower() in ("true", "1", "yes")
            handle_enrich_point(trip_id, args.point_id, args.note, args.photo, photo_uploaded=photo_uploaded)
        elif action == "stop_trip":
            handle_stop_trip(trip_id)
        else:
            raise ValueError(f"unsupported action: {action}")
    except Exception as exc:
        print(f"[adventure-live-dispatch] ERROR: {exc}", file=sys.stderr)
        return 1

    print("[adventure-live-dispatch] OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
