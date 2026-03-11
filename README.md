# Skadi

A static web app for visualizing mountain activities (hikes, ski, mountaineering, bike) on an interactive Leaflet map, using GeoJSON tracks and CSV activity lists.

## Live Site

[https://charlesctno.github.io/Skadi](https://charlesctno.github.io/Skadi)

## Stack

- **Frontend:** Single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth + GeoJSON track files
- **Pipeline:** Strava → GitHub Actions → Google Sheet + GPX files → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages

## Data Flow

**Summits tab** fetches the summits Google Sheet from a published CSV URL (see `SUMMITS_SHEET_CSV_URL` in `script.js`). Processing (columns C–O from row 4, inheritance, "to do" rows, multi-GPX summits) runs in the browser in `processSheetToSummitsRows()`. No local script needed: edit Sheet → refresh site.

**Bike tab** fetches CSV directly from a published Google Sheet URL (see `getCsvPath()` in `script.js`). Same column layout. Decimals must use dots (e.g. `132.3`).

**Tracks:** For each row with a non-empty GPX File field (column N), the app loads the corresponding GeoJSON from `data/processed/` (summits) or `data/bike/processed/` (bike).

## CSV Column Schema

| # | Field | Source |
|---|-------|--------|
| C | Status (to do / empty) | Manual, auto-cleared on Strava sync |
| D | Name | Strava activity title |
| E | Altitude | OpenStreetMap Nominatim (auto) |
| F | Summit Latitude | OpenStreetMap Nominatim (auto) |
| G | Summit Longitude | OpenStreetMap Nominatim (auto) |
| H | Season | Derived from activity date (auto) |
| I | Type (Hike / Ski / etc.) | Derived from Strava activity type (auto) |
| J | Grade | Manual |
| K | Distance | Strava (auto) |
| L | Duration | Strava (auto) |
| M | Elevation Gain | Strava (auto) |
| N | GPX File | Derived from activity name (auto) |
| P | Strava / Komoot URL | Strava (auto) or manual |
| S | Photo URLs (pipe-separated) | Strava photos API (auto) |
| T | Google Doc URL (journal) | Manual |

## Key Files

- `index.html` – Map container, tabs (Summits / Bike), filters (status, season, type), search
- `script.js` – Map init, CSV parsing, markers, track layers, filters, search, photo lightbox
- `scripts/strava_sync.py` – Fetches a named Strava activity, updates Google Sheet, pushes GPX to repo
- `scripts/strava_backfill_photos.py` – One-time backfill of photo URLs into column S for existing activities
- `scripts/convert_gpx.py` – Converts GPX files to GeoJSON (run automatically via GitHub Actions)
- `.github/workflows/strava_sync.yml` – Manual trigger workflow: input activity name, runs full sync
- `.github/workflows/convert_gpx.yml` – Auto-triggered when GPX files are pushed to raw folders

## Conventions

- Project colors defined in `projectColors` in `script.js`; markers and bike tracks colored by Project, summit tracks by activity type
- Bike rows may have empty Name/Altitude/Lat/Lon; tracks still load using GPX File field
- Decimals must be dots in source data — no conversion happens in the frontend
- GPX filename convention: activity name with spaces replaced by underscores + `.gpx` (e.g. `Mont_Telliers.gpx`)
- Multi-summit activities use `&` as separator in the activity title (e.g. `Dent d'oche & Cornette de Bise`)

## Roadmap

- ~~Move pipeline fully to the browser~~ — Summits tab now processes the sheet directly in the browser ✓
- ~~Strava sync via GitHub Actions~~ ✓
- ~~OpenStreetMap auto-fill for altitude and coordinates~~ ✓
- ~~Strava photo integration with lightbox viewer~~ ✓
- Google Doc journal linked to each activity
- Skadi chatbot (activity recommendations)
- French/English language switcher
- Immersive journal page with scrolling map (bike tab)
