# Skadi – Vision Document

## What Skadi Is

Skadi is a personal mountain adventure journal with an interactive map at its heart. It is named after the Norse goddess of skiing and mountains a fitting guide for anyone seeking their next adventure in the peaks.

The site is built for friends and family first, with the ambition to grow into a wider community over time. The tone is personal, warm, and lightly humorous the writing of someone who takes the mountains seriously but never themselves.

The bike tab is the soul of the site: full narrative travel writing meant to inspire. The summits tab is a living logbook of completed and planned ascents.

---

## Current Architecture

- **Frontend:** Static single-page HTML + vanilla JS, Leaflet map, no build step
- **Data:** Google Sheet (published CSV) as source of truth for activity metadata + GeoJSON tracks
- **Pipeline:** Strava → GitHub Actions → Google Sheet + `data/raw/` GPX → auto-converted to GeoJSON → site refreshes
- **Hosting:** GitHub Pages

### Column Schema (Google Sheet)

| # | Field | Source |
|---|-------|--------|
| C | Status (to do / empty) | Manual → auto-cleared on sync |
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

---

## Skadi the Chatbot

### Identity
Skadi is the in-site activity advisor. She is named after the Norse goddess of the mountains but her personality is that of a knowledgeable friend direct, warm, occasionally dry. No mythological references in the conversation itself, just good advice.

### Role
She helps visitors choose an activity based on:
- Key stats: distance, duration, elevation gain, grade
- Personal keywords extracted automatically from the journal text (bolded words in the Google Doc)
- Activity type and season

She only recommends completed activities (no "to do" rows). She does not answer general questions about the mountains for now purely activity recommendation.

### Placement
Floating button in the bottom right corner of the map. Long term she may partially or fully replace the filter bar.

### Keyword extraction
Keywords are bolded words in the Google Doc journal entries. The sync pipeline parses bold formatting via the Google Docs API and stores the extracted tags in a dedicated Sheet column. This means keywords emerge naturally from the writing rather than being maintained separately.

---

## The Journal

### Bike Tab
Full narrative travel writing the story of the adventure, not a technical route sheet. Structured like a travel book with occasional technical details woven in naturally. Each portion of a bike track (one day of a multi-day trip) links to its own journal entry. A trip is always defined as a consecutive adventure (days may include rest days but belong to a single journey).

### Summits Tab
Shorter, more casual entries. A paragraph, a memorable detail, a funny remark. Not every summit needs one but the ambition is to cover all future activities.

### Source
Written in Google Docs one Doc per activity. The Doc URL is stored in column T of the Google Sheet. The website fetches and displays the content via the Google Docs API.

---

## Long-Term UI Vision

### Journal page layout (bike tab)
When a track portion is clicked on the map, the user is taken to a dedicated journal page for that day. The layout works as follows:

- The map track is displayed full-width at the top of the page
- As the user scrolls down, the map shrinks and fades out, giving way to the narrative text
- Photos from column S are integrated into the narrative
- Left/right arrow navigation allows moving between days of the same trip, like chapters in a book
- The activity name (e.g. "Jour 1, De Morges à Martigny") is frozen at the top of the page as a persistent header, always visible while scrolling

### Chatbot evolution
- **Phase 1 (now):** Skadi as a floating button, filters stay as-is
- **Phase 2:** Skadi handles activity recommendations with keywords, filter bar simplifies to name search + one quick toggle
- **Phase 3:** Skadi fully replaces filters; search bar remains for direct lookup

### Language
The site is primarily in French (the language of the main audience). An English version is available via a flag toggle in the top right corner of the site. Clicking the French flag switches to English and the flag becomes British, and vice versa. All UI elements switch with the toggle: tab names, filter labels, button text, popup content, Skadi chatbot responses. Journal entries are written in French and do not switch for now. An English journal version may be added in the future if needed. All code, documentation, and variable names remain in English.

### Tags / keywords
Keywords extracted from journal bold text appear as visual tags on the journal page. They serve double duty: emphasis in the narrative and data input for Skadi's recommendation engine.

---

## Roadmap Summary

| Status | Feature |
|--------|---------|
| ✅ | Static map with Leaflet, summit + bike tabs |
| ✅ | Google Sheet as live data source (no local scripts) |
| ✅ | GitHub Actions GPX → GeoJSON conversion |
| ✅ | Strava sync via manual GitHub Actions trigger |
| ✅ | OpenStreetMap auto-fill for altitude + coordinates |
| ✅ | Strava photo integration with lightbox viewer |
| ✅ | Strava / Komoot link in popup |
| ⏳ | Google Doc journal linked to each activity |
| ⏳ | Skadi chatbot (activity recommendations) |
| ⏳ | Keyword extraction from Google Docs bold text |
| ⏳ | French/English language switcher (flag toggle) |
| ⏳ | Immersive journal page with scrolling map (bike tab) |
| ⏳ | Garmin Connect integration (long term) |
