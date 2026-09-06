# AGENTS.md

## Cursor Cloud specific instructions

Skadi is a **static, serverless single-page web app** (French UI) for an interactive mountain-adventure map. There is no build step and no `package.json`/Node toolchain — the frontend is plain `index.html` + `script.js` + `style.css`. Python (`scripts/*.py`) is only for the data pipeline (Strava/Komoot sync, GPX→GeoJSON, Notion cache) and runs in GitHub Actions, not for serving the site.

### Running the app (dev)
- Serve the repo root over HTTP (opening `index.html` via `file://` will not work because the app `fetch`es CSV/GeoJSON/JSON):
  - `python3 -m http.server 8000` then open `http://localhost:8000`.
- On `localhost`/`127.0.0.1` the app auto-detects dev mode: it uses **OpenStreetMap raster tiles** as the basemap (no Mapbox token needed) and shows extra Adventure-Mode debug toggles. A real Mapbox token (`script.js`) is only needed to test the production-like Mapbox Outdoors 3D/terrain basemap.
- The app needs **network egress** at runtime: Google Sheets published CSV (`docs.google.com`), CDNs (`api.mapbox.com`, `cdnjs.cloudflare.com`), and OSM tiles. These are reachable in this environment. Activity data is the live Google Sheet — there is no local database or seed step.

### Lint / test / build
- There is **no lint/test/build toolchain** (no ESLint, no pytest, no bundler). Quick syntax checks: `node --check script.js` and `python3 -m py_compile scripts/*.py`.
- Python data scripts (`strava_sync.py`, `test_sheet_sync.py`, etc.) require external API secrets and are not needed to run/browse the UI.

### Commit guard
- An optional pre-commit hook (`.pre-commit-config.yaml` → `scripts/check_blocked_assets.py`) blocks committing raw GPX, photos, and files >10MB. It is not installed by default; enable with `pip install pre-commit && pre-commit install` only if you need it.
