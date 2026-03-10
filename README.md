# Skadi

Static web app to visualize mountain and bike activities on a Leaflet map using Google Sheets (published CSV) + GeoJSON tracks.

## Live Site

[https://charlesctno.github.io/Skadi](https://charlesctno.github.io/Skadi)

## Architecture

- **Frontend:** `index.html` + `script.js` (vanilla JS, no build step)
- **Track data:** `data/raw/` and `data/bike/raw/` for GPX, `data/processed/` and `data/bike/processed/` for GeoJSON
- **Activity metadata:** Google Sheets published as CSV (summits + bike tabs)
- **Automation:** GitHub Actions + `scripts/strava_sync.py` + `scripts/convert_gpx.py`

## Current Data Flow

1. Manual GitHub Action (`Strava Sync (Manual)`) is triggered with an exact Strava activity name.
2. `scripts/strava_sync.py`:
   - fetches activity from Strava (pagination supported for exact-name search),
   - downloads GPX (export endpoint, with stream fallback),
   - stores GPX in `data/raw/` or `data/bike/raw/`,
   - updates Google Sheet rows (match existing summit names or insert new rows),
   - updates sync cursor in `data/strava_last_sync.json`.
3. Same workflow converts only newly imported GPX files to GeoJSON via `scripts/convert_gpx.py`.
4. Workflow commits/pushes GPX + GeoJSON + state to `main`.
5. Website fetches published CSV and loads matching GeoJSON files.

## Workflows

- `/.github/workflows/strava_sync.yml`
  - Trigger: `workflow_dispatch`
  - Input: `activity_name` (required, exact match)
  - Auth: Google OIDC + Strava OAuth secrets
  - Converts only newly added/modified GPX in current run
  - Commits:
    - `data/raw/`
    - `data/bike/raw/`
    - `data/processed/`
    - `data/bike/processed/`
    - `data/strava_last_sync.json`

- `/.github/workflows/convert-gpx.yml`
  - Trigger: push affecting `data/raw/**/*.gpx` or `data/bike/raw/**/*.gpx`
  - Use case: fallback/manual conversion path when GPX files are pushed directly

## Secrets Required (GitHub)

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_TAB_NAME`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`

## Google Sheet / CSV Schema (frontend)

| # | Field |
|---|-------|
| 0 | Name |
| 1 | Altitude |
| 2-3 | Summit Lat/Lon |
| 4 | Season |
| 5 | Type |
| 6 | Grade |
| 7 | Distance |
| 8 | Duration |
| 9 | Elevation Gain |
| 10 | GPX File |
| 11 | Project |

## Frontend Notes

- Summits tab CSV is fetched from `SUMMITS_SHEET_CSV_URL` in `script.js`.
- Bike tab CSV URL is returned by `getCsvPath()` in `script.js`.
- Summits sheet preprocessing is done client-side in `processSheetToSummitsRows()`.
- GPX file values are normalized in `script.js`, so `Monts_Telliers`, `Monts_Telliers.gpx`, or `Monts_Telliers.geojson` all resolve to `Monts_Telliers.geojson`.

## Key Files

- `index.html`: map container and UI
- `script.js`: CSV parsing, marker rendering, track loading/filter/search
- `scripts/strava_sync.py`: Strava + Sheets sync logic
- `scripts/convert_gpx.py`: GPX to GeoJSON conversion
- `scripts/test_sheet_sync.py`: optional local test helper for sheet insertion/update logic

## Notes

- `scripts/export_sheet_to_csv.py` is no longer part of the main flow.
- Decimals in source sheet data must use dots (`132.3`).