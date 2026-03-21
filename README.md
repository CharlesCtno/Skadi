# Skadi

A static web app for visualizing mountain activities (hikes, ski, trail running, mountaineering, bike) on an interactive Leaflet map, using GeoJSON tracks and CSV activity lists. The site is in French and includes Skadi, an in-site activity advisor chatbot.

## Live Site

[https://charlesctno.github.io/Skadi](https://charlesctno.github.io/Skadi)

## Stack

- **Frontend:** Single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth + GeoJSON track files
- **Pipeline:** Strava → GitHub Actions → Google Sheet + GPX files → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages

## Data Flow

**Sommets tab** fetches the summits Google Sheet from a published CSV URL (see `SUMMITS_SHEET_CSV_URL` in `script.js`). Processing (columns C–O from row 4, inheritance, "à faire" rows, multi-GPX summits) runs in the browser in `processSheetToSummitsRows()`. No local script needed: edit Sheet → refresh site.

**Vélo tab** fetches CSV directly from a published Google Sheet URL (see `getCsvPath()` in `script.js`). Same column layout. Decimals must use dots (e.g. `132.3`).

**Tracks:** For each row with a non-empty GPX File field (column N), the app loads the corresponding GeoJSON from `data/processed/` (summits) or `data/bike/processed/` (bike).

## CSV Column Schema

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

- `index.html` – Map container, tabs (Sommets / Vélo), Skadi chatbot, legend, photo lightbox, journal panel shell
- `script.js` – Map init, CSV parsing, markers (with snow cap for completed summits), track layers, Skadi chatbot logic, photo lightbox, journal panel + Markdown, keyword cache
- `style.css` – All styles including chatbot panel, legend, popups
- `journal/` – Markdown récits referenced from column T (`journal/…`)
- `scripts/strava_sync.py` – Fetches a named Strava activity, updates Google Sheet (name, season, type, stats, coordinates, photos), pushes GPX to repo
- `scripts/strava_backfill_photos.py` – One-time backfill of photo URLs into column S for existing activities
- `scripts/convert_gpx.py` – Converts GPX files to GeoJSON (run automatically via GitHub Actions)
- `scripts/test_sheet_sync.py` – Local test script to simulate a Strava sync without API calls
- `.github/workflows/strava_sync.yml` – Manual trigger workflow: input activity name, runs full sync
- `.github/workflows/convert_gpx.yml` – Auto-triggered when GPX files are pushed to raw folders

## Conventions

- Project colors defined in `projectColors` in `script.js`; markers and bike tracks colored by Project, summit tracks by activity type
- Completed summits have a snow cap on their triangle marker; "à faire" summits have no snow cap
- Bike rows may have empty Name/Altitude/Lat/Lon; tracks still load using GPX File field
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
| ✅ | Full UI translated to French |
| ✅ | Skadi chatbot: Mode 1 (filter) + Mode 2 (recommendation + location + cotation) |
| ✅ | Contact Charles flow via Google Form |
| ✅ | Journal column T: inline popup text + `journal/` Markdown récit |
| ✅ | **Journal keywords** (bold in T / Markdown) + Skadi Mode 1 & 2 |
| ⏳ | French/English language switcher (flag toggle) |
| ⏳ | Immersive journal page with scrolling map (bike tab) |

## Next steps

- **Content:** Add or migrate Markdown under `journal/` and wire column T for activities you want full récits for—Markdown is the rich layer for narratives (no external doc API).
- **Skadi:** Refine keyword lists and copy when real usage surfaces edge cases.
- **Product:** UI language toggle; long-term immersive bike journal page (see `VISION.md`).
