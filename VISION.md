# Skadi – Vision Document

## What Skadi Is

Skadi is a personal mountain adventure journal with an interactive map at its heart. It is named after the Norse goddess of skiing and mountains, a fitting guide for anyone seeking their next adventure in the peaks.

The site is built for friends and family first, with the ambition to grow into a wider community over time. The tone is personal, warm, and lightly humorous, the writing of someone who takes the mountains seriously but never themselves.

The bike tab works as a travelling journal: full narrative travel writing meant to inspire. The summits tab is a living logbook of completed and planned ascents.

**Today, the product is ready to tell stories:** publish tracks from the sheet, drop Markdown under `journal/`, open the immersive bike récit or summit popups, and let Skadi help readers explore. What remains is mostly content, storage migration, and polish.

---

## Current Architecture

- **Frontend:** Static single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth for activity metadata + GeoJSON track files
- **Pipeline:** Strava → GitHub Actions → Google Sheet + GPX files → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages
- **Basemap:** Mapbox Outdoors (`mapbox/outdoors-v12`) via Leaflet
- **Language:** French UI and copy throughout. An **English UI toggle** is not required; it remains an **optional long-term** idea if the audience grows beyond French-first readers.

---

## Storage Architecture (planned migration)

The current setup stores photos and Markdown files directly in the GitHub repo. This is not sustainable long term as Git is not designed for binary files and the repo will eventually hit GitHub's size limits. The planned migration moves each type of content to the right tool:

| Content type | Current location | Target location |
|---|---|---|
| Activity photos (journal) | `journal/photos/` in repo | **Cloudinary** (CDN, free tier) |
| Adventure mode photos (live) | `live/trips/*/photos/` in repo | **Cloudinary** (CDN, free tier) |
| Photo URLs | Column S (Strava CDN) | **Google Sheet** (Cloudinary URLs) |
| Immersive bike journal narrative | `journal/*.md` in repo | **Notion** (fetched via Notion API) |
| Summit journal narrative | `journal/*.md` or column T | **Notion** (fetched via Notion API) |
| Short activity descriptions | Column T inline text | Stay in Column T (inline popup text) |
| GeoJSON tracks | `data/processed/` in repo | Stay in repo (text files, compress well) |
| GPX source files | `data/raw/` in repo | To be removed after conversion (see below) |

### Photo storage: Cloudinary
- All journal photos and adventure mode live photos are uploaded to Cloudinary
- Cloudinary URLs are stored in the Google Sheet (column S for summits, column I for bike)
- Notion pages reference Cloudinary URLs directly for inline images
- Free tier: 25GB storage, 25GB bandwidth/month, sufficient for years at this scale

### Journal narrative: Notion
- Immersive bike journal entries and summit récits are written in Notion
- The site fetches content via the Notion API using an integration token
- The token is stored in the frontend (visible in public repo) but scoped only to dedicated Skadi pages — private Notion content is never exposed
- Visitors never interact with Notion directly; they only see rendered content on Skadi
- Short inline summit descriptions (one paragraph) remain stored in column T

### GPX and GeoJSON tracks
- GeoJSON files stay in the repo — they are plain text and compress well, no storage concern
- GPX source files will be removed from the repo once conversion to GeoJSON is confirmed complete
- Long term: consider converting GPX to GeoJSON client-side in the browser using `togeojson.js`, eliminating the GitHub Actions conversion step and storing only GeoJSON
- Note: Strava does not offer a GeoJSON export endpoint; GPX remains the source format

### Git history cleanup (pending)
- Files deleted from the repo remain in Git history and still count toward repo size
- A one-time cleanup using **BFG Repo Cleaner** or `git filter-repo` will purge photos and GPX files from all history
- This is a destructive operation (requires force-push) and should be done once, cleanly, after the Cloudinary and Notion migrations are complete
- After cleanup: photos and GPX files must never enter the repo again

---

## Column Schema (Google Sheet — Sommets tab)

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
| S | Photo URLs (pipe-separated) | Cloudinary URLs (replacing Strava CDN URLs) |
| T | Journal | Notion page URL or short inline text (popup) |

### Activity Types

| Strava type | Sheet value | Track color |
|-------------|-------------|-------------|
| Hike | Randonnée | green |
| BackcountrySki / Backcountry Ski | Ski | blue |
| TrailRun / Trail Run | Trail Running | #ffc99e |
| Other | blank | default |

---

## Skadi the Chatbot

### Identity
Skadi is the in-site activity advisor, accessible via a "?" floating button in the bottom right corner of the map. Her personality is that of a knowledgeable friend: warm, direct, occasionally dry wit, never takes herself too seriously. She speaks French and uses "tu". No mythological references in conversation, just good advice.

### Two modes

**Mode 1 Filter:**
The user types keywords (season, activity type, status, activity name). Skadi updates the map to show all matching activities and replies with a short confirmation.

**Help / reset:** Typing **aide** shows Skadi's help text, including how to show everything again: chat phrases **reset**, **tous**, **toute**, **toutes** clears recommendation mode and reapplies an all-activities filter state.

Detected keywords:
- Season: été, hiver, printemps, automne
- Type: randonnée, ski, trail, alpinisme, vélo
- Status: accompli, à faire
- Anything else: treated as a name search

**Journal keywords (Mode 1):** Words in **bold** in journal content are indexed in a background keyword cache at page load. A single unrecognized word is treated as a keyword search. Multi-word phrases can combine filters with keyword tokens.

**Mode 2 Recommendation:**
Triggered when the user mentions distance, duration, elevation, cotation, or a location phrase. Skadi scores completed activities and returns the 3 best matches using relative difference for numeric fields and Haversine distance with a 3x coefficient for location.

**Keyword pre-filter (Mode 2):** Additional words in the message are matched against the journal keyword cache to narrow the scoring pool before ranking.

**3D map mode (implemented):** When Mode 2 triggers, Skadi enables a true 3D Mapbox view with terrain and building extrusions, tilts the camera to 20°, allows mouse rotation, and clamps pitch to 0°..70°. Resets to 2D on the next Mode 1 request.

### Contact Charles flow
After a Mode 2 recommendation, if the user mentions "charles" (case-insensitive), Skadi asks for their name and silently submits a Google Form with: user name, original request, Skadi's suggestions, and date.

### Journal keywords (implemented)
Bold phrases in journal content are parsed and cached once per session. They power Skadi Mode 1 keyword search and Mode 2 pre-filtering.

### Evolution
- **Phase 1 (done):** Floating "?" button, filter bar hidden but preserved in code
- **Phase 2 (done):** Keywords from journal + Skadi integration (Mode 1 & 2)
- **Phase 3 (done):** Skadi replaces filters; search bar remains for direct lookup

---

## The Journal

### Bike Tab
Full narrative travel writing, structured like a travel book. Each étape links to a Notion page fetched at runtime. Photos are hosted on Cloudinary and embedded in Notion. A trip is a consecutive adventure under one Project.

**Immersive bike journal (implemented):** Opening a bike track with a journal path shows the map in a short band at the top, then the narrative below in normal page scroll. A sticky bar holds the étape title, prev/next arrows, close, and stats; the active track is highlighted on the map.

### Summits Tab
Shorter, more casual entries. One paragraph, a memorable detail, a funny remark. Short descriptions remain stored in column T. Longer récits live in Notion.

### Source
- **Short descriptions:** inline text in column T
- **Rich narratives:** Notion pages, fetched via Notion API, referenced by URL in column T (summits) or column J (bike)
- **Photos:** Cloudinary URLs embedded in Notion or referenced in Google Sheet

---

## Adventure Mode (Bikepacking Live)

### Concept
Adventure mode lets you broadcast a live bikepacking trip to the website. Only you can publish data (via phone scripts using a GitHub PAT). The public site reads only.

### Current MVP (implemented)
- Live banner on bike tab when trip is active
- GPS polyline and latest point marker
- Phone controls: HTTP Shortcuts (4 manual actions) + Automate (GPS loop)
- Data lives in `live/activeTrip.json` and `live/trips/<tripId>/points.json`

### Phase 2: Point enrichment (in progress)
- Mobile admin page `admin/enrich.html` (4-digit PIN) for adding notes and photos to points during breaks
- Photos uploaded to **Cloudinary**, URL stored in points JSON (not in repo)
- Enriched points display as colored dots with popup showing note and photo on demand
- Automate background loop posts GPS automatically every 1-2h with offline buffer

### Phase 3: Polarsteps-style display (planned)
- Enriched points with photos show as circular photo thumbnail markers on the map
- Plain GPS points remain as simple dots
- Polyline connects all points

### Security
- Fine-grained PAT scoped to this repo only, Actions write permission
- Rotate regularly, revoke immediately if exposed
- No public auth UI on the site

---

## Long-Term / Optional Ideas

- **English UI toggle:** Not a priority, only if readership justifies it
- **GPX to GeoJSON in browser:** Use `togeojson.js` client-side to eliminate the GitHub Actions conversion step and store only GeoJSON
- **Visual keyword tags:** Bold journal text already feeds Skadi; visual tags on story pages could come later

---

## Pending Technical Tasks

- **Cloudinary migration:** Upload existing journal photos and update URLs in Google Sheet and Notion
- **Notion migration:** Move existing `journal/*.md` content to Notion pages, update column T / column J references
- **Git history cleanup:** Run BFG Repo Cleaner once to purge photos and GPX files from all history. Do this after migrations are complete. Never let photos or GPX files enter the repo again after cleanup.
- **(Not needed anymore):** Strava description integration (short descriptions stay in column T)

---

## Roadmap Summary

| Status | Feature |
|--------|---------|
| ✅ | Static map with Leaflet, summit + bike tabs |
| ✅ | Google Sheet as live data source (no local scripts) |
| ✅ | GitHub Actions GPX → GeoJSON conversion |
| ✅ | Strava sync via manual GitHub Actions trigger (sommets + bikepacking) |
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
| ✅ | Skadi Mode 2: 3D map + mouse rotation |
| ✅ | Contact Charles flow via Google Form |
| ✅ | Journal: inline text + Markdown récit (summits slide-in panel) |
| ✅ | Journal keywords: bold extraction, session cache, Mode 1 + Mode 2 Skadi integration |
| ✅ | Immersive bike journal: map band + narrative, sticky header, étape navigation, track highlight |
| ✅ | Adventure Mode MVP: live banner + GPS polyline + phone trigger dispatch |
| 🔜 | Adventure Mode Phase 2: Automate GPS loop + offline buffer + point enrichment (notes + Cloudinary photos) |
| 🔜 | Adventure Mode Phase 3: Polarsteps-style photo markers |
| 🔜 | Storage migration: Cloudinary for photos, Notion for journal narratives |
| 🔜 | Git history cleanup: BFG Repo Cleaner (after migrations complete) |
| 🔜 | Column T inline text as short summit popup text |
| 🔜 (optional) | GPX to GeoJSON conversion in browser (eliminate GitHub Actions step) |
| 🔜 (optional) | English UI toggle (long-term only if needed) |
