# Skadi

A static web app for visualizing mountain activities (hikes, ski, mountaineering, bike) on an interactive Leaflet map, using GeoJSON tracks and CSV activity lists.

## Live Site

[https://charlesctno.github.io/Skadi](https://charlesctno.github.io/Skadi)

## Stack

- **Frontend:** Single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** CSV (or Google Sheets published CSV) + GeoJSON track files

## Data Flow

**Summits tab** fetches the summits Google Sheet from a published CSV URL (see `SUMMITS_SHEET_CSV_URL` in `script.js`). The processing that used to run in `scripts/export_sheet_to_csv.py` (columns C–O from row 4, inheritance when N is the same, "to do" rows, same summit with different GPX) now runs in the browser in `processSheetToSummitsRows()`. No local script needed: edit Sheet → refresh site.

**Bike tab** fetches CSV directly from a published Google Sheet URL (see `getCsvPath()` in `script.js`). Same column layout. Decimals must use dots (e.g. `132.3`).

**Tracks:** For each row with a non-empty GPX File field (column K), the app loads the corresponding GeoJSON — from `data/processed/` (summits) or `data/bike/processed/` (bike). GPX → GeoJSON conversion via `scripts/convert_gpx.py`.

## CSV Column Schema

| # | Field |
|---|-------|
| 0 | Name |
| 1 | Altitude |
| 2–3 | Summit Lat/Lon |
| 4 | Season |
| 5 | Type |
| 6 | Grade |
| 7 | Distance |
| 8 | Duration |
| 9 | Elevation Gain |
| 10 | GPX File |
| 11 | Project |

## Key Files

- `index.html` – Map container, tabs (Summits / Bike), filters (status, season, type), search
- `script.js` – Map init, CSV parsing, markers (triangles colored by Project), track layers, filters, search
- `scripts/export_sheet_to_csv.py` – Optional: same summits processing as in-browser; use for local `activities_clean.csv` (e.g. debugging)
- `scripts/convert_gpx.py` – Converts GPX files to GeoJSON

## Conventions

- Project colors defined in `projectColors` in `script.js`; markers and bike tracks colored by Project, summit tracks by activity type
- Bike rows may have empty Name/Altitude/Lat/Lon; tracks still load using GPX File field
- Decimals must be dots in source data — no conversion happens in the frontend

## Roadmap

- ~~**Midterm:** Move pipeline fully to the browser~~ — Summits tab now processes the sheet directly in the browser ✓
- **Long-term:** Link Garmin Connect data to both the Google Sheet and the site