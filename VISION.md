# Skadi – Vision Document

## What Skadi Is

Skadi is a personal mountain adventure journal with an interactive map at its heart. It is named after the Norse goddess of skiing and mountains, a fitting guide for anyone seeking their next adventure in the peaks.

The site is built for friends and family first, with the ambition to grow into a wider community over time. The tone is personal, warm, and lightly humorous, the writing of someone who takes the mountains seriously but never themselves.

The bike tab is the soul of the site: full narrative travel writing meant to inspire. The summits tab is a living logbook of completed and planned ascents.

---

## Current Architecture

- **Frontend:** Static single-page HTML + vanilla JS (`index.html`, `script.js`), Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth for activity metadata + GeoJSON track files
- **Pipeline:** Strava → GitHub Actions → Google Sheet + GPX files → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages
- **Language:** French (primary), English version planned via flag toggle

### Column Schema (Google Sheet)

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
| T | Journal (inline text or `journal/…` path) | Manual — plain text in the popup, or Markdown file under `journal/` fetched when the user opens the récit |

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

**Mode 1 — Filter:**
The user types keywords (season, activity type, status, activity name). Skadi updates the map to show all matching activities and replies with a short confirmation.

Detected keywords:
- Season: été, hiver, printemps, automne
- Type: randonnée, ski, trail, alpinisme, vélo
- Status: accompli, à faire
- Anything else: treated as a name search

**Journal keywords (Mode 1):** Words in **bold** in column T (or in linked Markdown under `journal/`) are indexed in a background keyword cache at page load. A single word that is not a season/type/status/name match is treated as a keyword search: all completed activities whose journal keywords match (whole word) are shown. Multi-word phrases can combine filters with keyword tokens (e.g. type + “glacier”) by intersecting the usual filters with keyword matches.

**Mode 2 — Recommendation:**
Triggered when the user mentions at least one of: distance (km), duration (heure/h/jours), elevation (dénivelé/D+), cotation (T1–T6), or a location (près de, côté de, depuis, au-dessus de, vers, dans les, dans le, en partant de).

Skadi scores completed activities and returns the 3 best matches. Scoring uses relative difference for numeric fields, and Haversine distance with a 3x coefficient for location (normalized across the pool used for scoring). Only completed activities are considered.

**Keyword pre-filter (Mode 2):** Additional words in the message (after stripping numbers, units, location, and stop words) are matched against the same journal keyword cache. Depending on how many activities match, Skadi may narrow the pool before scoring or blend keyword matches with global top scores, with short prefixes in chat when the keyword match is sparse or empty.

The 3 matching activities are displayed on the map, all others are hidden. Skadi presents them in chat with key stats and approximate distance from location if applicable.

### Contact Charles flow
After a Mode 2 recommendation, if the user mentions "charles" (case-insensitive) in any message, Skadi asks for their name and silently submits a Google Form with: user name, original request, Skadi's suggestions, and date. Skadi confirms: "Parfait ! Charles reviendra vers toi dès que possible."

### Journal keywords (implemented)
Bold phrases in column T (`**like this**` or `__like this__`) or in Markdown files referenced by `journal/…` are parsed in the browser and cached once per session (no blocking of map load). They power Skadi Mode 1 keyword search and Mode 2 pre-filtering.

### Evolution
- **Phase 1 (current):** Floating "?" button, filter bar hidden but preserved in code
- **Phase 2 (in progress):** Keywords from journal + Skadi integration; optional future: extra Sheet column if needed
- **Phase 3:** Skadi fully replaces filters, search bar remains for direct lookup

---

## The Journal

### Bike Tab
Full narrative travel writing, the story of the adventure, not a technical route sheet. Structured like a travel book with occasional technical details woven in naturally. Each portion of a bike track (one day of a multi-day trip) can link to its own Markdown file under `journal/` (rich formatting, photos in narrative, etc.). A trip is defined as a consecutive adventure (days may include rest days but belong to a single journey).

### Summits Tab
Shorter, more casual entries. A paragraph, a memorable detail, a funny remark. The ambition is to cover all future activities.

### Source
Journal content can be **inline plain text** in column T (shown in the activity popup, with `**bold**` rendered as real bold) or a **Markdown path** such as `journal/MyActivity.md` served from the repo; the full récit opens in a slide-in panel with Markdown rendered. **Rich narrative lives in Markdown**—formatting, structure, and embedded media are authored in `.md` files in the repo, not via an external doc API.

---

## Long-Term UI Vision

### Journal page layout (bike tab)
When a track portion is clicked on the map, the user is taken to a dedicated journal page for that day:

- The map track is displayed full-width at the top of the page
- As the user scrolls down, the map shrinks and fades out, giving way to the narrative text
- Photos are integrated into the narrative
- Left/right arrow navigation moves between days of the same trip, like chapters in a book
- The activity name (e.g. "Jour 1, De Morges à Martigny") is frozen at the top as a persistent header, always visible while scrolling

### Language switcher
A flag icon in the top right corner toggles between French (default) and English. All UI elements switch: tab names, filter labels, button text, popup content, Skadi responses. Journal entries stay in French for now. Code, documentation and variable names always remain in English.

### Tags / keywords
Bold text in journals is already used for Skadi keyword extraction and can later appear as visual tags on dedicated journal pages.

---

## Next steps (near term)

- **Journal polish:** More `journal/*.md` content, richer Markdown for bike and summit récits
- **Skadi UX:** Tune stop-word lists, keyword messages, and edge cases (homonyms, multi-summit rows)
- **Data:** Keep column T aligned with bold conventions for reliable keyword matching
- **i18n:** French/English flag toggle for UI (journal text can stay French initially)
- **Immersive bike journal:** Full-page “chapter” experience with scrolling map (bike tab) as in the long-term UI vision

---

## Roadmap Summary

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
| ✅ | Column T journal: inline text + `journal/` Markdown, popup bold rendering, slide-in récit |
| ✅ | **Journal keywords:** bold extraction, session cache, Mode 1 + Mode 2 Skadi integration |
| ⏳ | French/English language switcher (flag toggle) |
| ⏳ | Immersive journal page with scrolling map (bike tab) |
