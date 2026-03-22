# Skadi

A static web app for visualizing mountain activities (hikes, ski, trail running, mountaineering, bikepacking) on an interactive Leaflet map, using GeoJSON tracks and Google Sheet data. The UI and Skadi chatbot are in **French**. The stack is ready for **stories**: publish tracks, add Markdown under `journal/`, and readers get map + récit (summit slide-in panel or **immersive bike journal** with chapter-style navigation).

An **English UI toggle** is not planned as a requirement—only a possible long-term extra if the audience grows.

## Live Site

[https://charlesctno.github.io/Skadi](https://charlesctno.github.io/Skadi)

## Stack

- **Frontend:** Single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth + GeoJSON track files
- **Pipeline:** Strava → GitHub Actions → Google Sheet + GPX files → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages

## Data Flow

**Sommets tab** fetches the summits Google Sheet from a published CSV URL (see `SUMMITS_SHEET_CSV_URL` in `script.js`). Processing (columns C–O from row 4, inheritance, "à faire" rows, multi-GPX summits) runs in the browser in `processSheetToSummitsRows()`. No local script needed: edit Sheet → refresh site.

**Vélo / bikepacking tab** uses a **different** fixed layout: **columns A–J** (10 fields). See **`docs/BIKE_SHEET_SCHEMA.md`**. Decimals should use dots in the published CSV (e.g. `132.3`).

**Tracks:** For each row with a non-empty GPX File field, the app loads GeoJSON from `data/processed/` (summits, column N) or `data/bike/processed/` (bike, column F).

## CSV Column Schema (Sommets tab)

| Column | Field | Source |
|--------|-------|--------|
| C | Status (à faire / empty) | Manual, auto-cleared on Strava sync |
| D | Name | Strava activity title |
| E | Altitude | OpenStreetMap Nominatim (auto) |
| F | Summit Latitude | OpenStreetMap Nominatim (auto) |
| G | Summit Longitude | OpenStreetMap Nominatim (auto) |
| H | Season | Derived from activity date (auto, in French) |
| I | Type | Derived from Strava activity type (auto, in French) |
| J | Grade | Manual |
| K | Distance | Strava (auto) |
| L | Duration | Strava (auto, in hours) |
| M | Elevation Gain | Strava (auto) |
| N | GPX File | Derived from activity name (auto) |
| P | Strava / Komoot URL | Strava (auto) or manual |
| S | Photo URLs (pipe-separated) | Strava photos API (auto) |
| T | Journal | Manual — inline text (shown in popup; `**bold**` renders as bold) or `journal/path.md` for a Markdown récit in the repo |

## Activity Types

| Strava type | Sheet value | Color |
|-------------|-------------|-------|
| Hike | Randonnée | green |
| BackcountrySki / Backcountry Ski | Ski | blue |
| TrailRun / Trail Run | Trail Running | #ffc99e |
| Other | blank | default |

## Skadi (chatbot)

- **Mode 1:** Filters by season, type, status, or activity name; single-word **keyword** search uses bold-derived keywords from column T (and `journal/` Markdown); multi-word queries can combine filters with keyword tokens.
- **Mode 2:** Recommends top 3 completed activities using distance, duration, elevation, cotation (T1–T6), and/or location; optional **keyword pre-filter** from the same journal keyword cache (built once per session in the background).
- See `VISION.md` for behavior details and roadmap.

## Key Files

- `index.html` – Map container, tabs (Sommets / Bikepacking), Skadi chatbot, legend, photo lightbox, summits journal panel, **immersive bike journal** shell
- `script.js` – Map init, CSV parsing (summits + fixed A–J bike sheet), markers, track layers, **bike immersive journal** (navigation, track highlight, map fit), Skadi, photo lightbox, Markdown rendering (`marked`), keyword cache
- `style.css` – Layout and theme for map, popups, chatbot, legend, bike immersive journal
- `journal/` – Markdown récits (`journal/…` from column T summits or column J bike)
- `docs/BIKE_SHEET_SCHEMA.md` – Bike tab column layout (A–J)
- `scripts/strava_sync.py` – Fetches a named Strava activity; `--destination sommets|bikepacking` selects Progrès (OSM, summits layout) vs Bikepacking (A–J, no OSM); pushes GPX to `data/raw/` or `data/bike/raw/`
- `scripts/strava_backfill_photos.py` – One-time backfill of photo URLs into column S for existing activities
- `scripts/convert_gpx.py` – Converts GPX files to GeoJSON (run automatically via GitHub Actions)
- `scripts/test_sheet_sync.py` – Local test script to simulate a Strava sync without API calls
- `.github/workflows/strava_sync.yml` – Manual trigger: activity name + destination (`sommets` / `bikepacking`), runs full sync
- `.github/workflows/convert_gpx.yml` – Auto-triggered when GPX files are pushed to raw folders

## Conventions

- Project colors defined in `projectColors` in `script.js`; markers and bike tracks colored by Project, summit tracks by activity type
- Completed summits have a snow cap on their triangle marker; "à faire" summits have no snow cap
- Decimals must use dots in source data; no conversion happens in the frontend
- GPX filename convention: activity name with spaces replaced by underscores + `.gpx` (e.g. `Mont_Telliers.gpx`)
- Multi-summit activities use `&` as separator in the activity title (e.g. `Dent d'oche & Cornette de Bise`)
- All UI text is in French; code, variable names and documentation remain in English

## Roadmap

| Status | Feature |
|--------|---------|
| ✅ | Static map with Leaflet, summit + bike tabs |
| ✅ | Google Sheet as live data source (no local scripts) |
| ✅ | GitHub Actions GPX → GeoJSON conversion |
| ✅ | Strava sync via manual GitHub Actions trigger (search by activity name) |
| ✅ | OpenStreetMap auto-fill for altitude and coordinates |
| ✅ | Season and activity type auto-filled in French |
| ✅ | Status auto-cleared on sync (à faire → completed) |
| ✅ | Strava photo integration with lightbox viewer |
| ✅ | Strava / Komoot link in popup |
| ✅ | Map legend (summits, projects, activity types) |
| ✅ | Completed summit markers with snow cap |
| ✅ | Trail Running activity type added |
| ✅ | Full UI in French |
| ✅ | Skadi chatbot: Mode 1 (filter) + Mode 2 (recommendation + location + cotation) |
| ✅ | Contact Charles flow via Google Form |
| ✅ | Journal column T: inline popup text + `journal/` Markdown récit (summits) |
| ✅ | **Journal keywords** (bold in T / Markdown) + Skadi Mode 1 & 2 |
| ✅ | **Immersive bike journal** (map + Markdown, étape nav, track selection) |
| 🔜 (optional) | English UI toggle — long-term only, not a milestone |

## Next steps

- **Stories:** Add Markdown under `journal/` and point the sheet at paths (column T summits, column J bike); align GPX filenames with GeoJSON basenames (`docs/BIKE_SHEET_SCHEMA.md`).
- **Skadi:** Refine keyword lists when real usage surfaces edge cases.
- **See `VISION.md`** for narrative direction and optional future ideas (e.g. English UI).
