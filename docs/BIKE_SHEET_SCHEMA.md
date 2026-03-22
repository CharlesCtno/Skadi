# Bikepacking sheet layout (source of truth)

Published CSV URL is configured in `script.js` (`getCsvPath()` when `currentTab === 'bike'`).

## Fixed columns (10 columns, A–J)

The frontend **`readBikeSheetRow()`** in `script.js` maps **CSV indices 0–9** to these fields. Do **not** reorder columns without updating `BIKE_COL` in the script.

| CSV index | Sheet column | Field | Notes |
|-----------|--------------|-------|--------|
| 0 | A | Name | Activity / étape title; can be empty if GPX name is enough |
| 1 | B | Season | e.g. `Automne`, `Hiver` |
| 2 | C | Distance [km] | Decimal; use `.` for decimals in CSV |
| 3 | D | Duration [h] | Hours |
| 4 | E | Elevation gain [m] | Integer |
| 5 | F | GPX File | Basename **must** match `data/bike/processed/<basename>.geojson` on disk (same spelling, accents, spaces vs underscores) |
| 6 | G | Project | Trip grouping, e.g. `Morges to Como` |
| 7 | H | URL | Strava / Komoot link |
| 8 | I | photo | Pipe-separated URLs or empty |
| 9 | J | journal path | Immersive journal: path like `journal/Wien to Innsbruck/MyDay.md` |

Row 1 of the published CSV is the **header** and is skipped by the app.

## Delimiter (important)

Google may publish CSV with **comma** or **semicolon** (locale). The app picks `,` vs `;` by scoring **data rows** so each line splits into **10 fields** (header-only detection is not enough).

If distances/durations use **European decimals** (`180,8`) **without** quoting the cell, a **comma-separated** export will split that into two fields and **shift every column to the right** — column F (GPX) can pick up garbage or a word like `bike`.

**Fix:** (1) Set spreadsheet locale so published CSV uses **semicolon**, or (2) **quote** numeric cells in the sheet (`"180,8"`), or (3) use **dot** decimals (`180.8`).

## Data pipeline

- **GPX → GeoJSON:** `scripts/convert_gpx.py` writes `data/bike/processed/<stem>.geojson` from `data/bike/raw/<stem>.gpx`.
- **Strava sync** (`scripts/strava_sync.py --destination bikepacking`) writes to this tab (GPX under `data/bike/raw/`). **Match order:** (1) **H** = Strava activity URL; (2) **A** matches the Strava title (normalized) and **H** is empty (pre-planned row); (3) else **insert** a new row (full **A–J**, with **A / G / J** left blank). For (1) and (2), only **B–F** and **H–I** are updated so existing name / project / journal cells are preserved.

## Related

- `VISION.md` — product notes on the bike tab and journal UX.
