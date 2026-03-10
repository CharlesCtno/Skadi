from pathlib import Path

from strava_sync import (
    _optional_env,
    _required_env,
    activity_title_to_gpx_filename,
    build_sheets_service,
    get_sheet_id,
    parse_gpx_start_coords,
    season_from_month,
    upsert_activity_summits_to_sheet,
)


def main() -> None:
    # Same Google auth env vars as production sync.
    spreadsheet_id = _required_env("GOOGLE_SHEETS_SPREADSHEET_ID")
    sheet_name = _required_env("GOOGLE_SHEETS_TAB_NAME")
    sa_json = _optional_env("GOOGLE_SERVICE_ACCOUNT_JSON")

    # Hardcoded test activity.
    activity_title = "Monts Telliers"
    activity_type = "BackcountrySki"  # Try "BackcountrySki" to test Ski mapping in column I.
    distance_km = "11.80"
    duration_h = "4.10"
    elevation_gain_m = "1320"
    activity_url = "https://www.strava.com/activities/17317103730"
    test_month = 1  # January -> Winter
    season = season_from_month(test_month)

    gpx_filename = activity_title_to_gpx_filename(activity_title)
    gpx_path = Path("data/raw") / gpx_filename
    if not gpx_path.exists():
        raise FileNotFoundError(f"Test GPX not found: {gpx_path}")

    gpx_bytes = gpx_path.read_bytes()
    start_lat, start_lon = parse_gpx_start_coords(gpx_bytes)
    if start_lat is None or start_lon is None:
        raise RuntimeError(f"Could not extract first trackpoint from {gpx_path}")

    print(
        f"Testing sheet sync with activity='{activity_title}', gpx='{gpx_filename}', "
        f"start=({start_lat:.6f}, {start_lon:.6f}), distance={distance_km}km, "
        f"duration={duration_h}h, elevation_gain={elevation_gain_m}m, season={season}, "
        f"type={activity_type}, url={activity_url}"
    )

    sheets_service = build_sheets_service(sa_json)
    sheet_id = get_sheet_id(sheets_service, spreadsheet_id=spreadsheet_id, sheet_name=sheet_name)

    # Sheet stores GPX filename with extension in column N.
    gpx_file_value = gpx_filename
    # Hardcoded test photo URL for column S (no Strava API call).
    test_photo_urls = (
        "https://dgtzuqphqg23d.cloudfront.net/MAervFZjn_Q3Vzix8OzeOXUvKbYnGfPCH_LQH-tL_1o-2048x1536.jpg"
    )
    result = upsert_activity_summits_to_sheet(
        sheets_service=sheets_service,
        spreadsheet_id=spreadsheet_id,
        sheet_name=sheet_name,
        sheet_id=sheet_id,
        activity_title=activity_title,
        strava_activity_type=activity_type,
        season=season,
        distance_km=distance_km,
        duration_h=duration_h,
        elevation_gain_m=elevation_gain_m,
        gpx_file_value=gpx_file_value,
        activity_url=activity_url,
        start_lat=start_lat,
        start_lon=start_lon,
        photo_urls_value=test_photo_urls,
    )

    print(
        "Test sync done: "
        f"processed_summits={result['processed_summits']}, "
        f"matched={result['matched']}, created={result['created']}."
    )


if __name__ == "__main__":
    main()
