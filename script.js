// Global variables
let map;
let markers = [];
let tracks = [];
let loadedGeoJSONFiles = {};
let gpxNames = [];
let gpxNameSet = new Set();
let gpxNameToMarker = {};
let currentTab = 'summits';
let activityCatalog = [];
let activeRecommendationKeys = null;
let latestFilterState = {
    activityType: 'all',
    status: 'all',
    season: 'all',
    name: ''
};
let journalPanelOpen = false;

function openJournalPanel(activityName, journalPath) {
    const tabContent = document.getElementById('tab-content');
    const panel = document.getElementById('journal-panel');
    const titleEl = document.getElementById('journal-title');
    const contentEl = document.getElementById('journal-content');
    if (!tabContent || !panel || !titleEl || !contentEl) return;

    const title = String(activityName || '').trim() || 'Récit';
    titleEl.textContent = title;
    contentEl.innerHTML = 'Chargement du récit...';

    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    tabContent.classList.add('journal-open');
    journalPanelOpen = true;

    // Give CSS transition time, then resize Leaflet canvas.
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 320);

    const safePath = String(journalPath || '').trim();
    if (!safePath || !/^journal\//i.test(safePath)) {
        contentEl.textContent = "Le récit de cette activité n'est pas encore disponible.";
        return;
    }

    fetch(safePath)
        .then((res) => {
            if (!res.ok) throw new Error(`journal fetch failed: ${res.status}`);
            return res.text();
        })
        .then((md) => {
            if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
                contentEl.innerHTML = marked.parse(md);
            } else {
                contentEl.textContent = md;
            }
        })
        .catch((_err) => {
            contentEl.textContent = "Le récit de cette activité n'est pas encore disponible.";
        });
}

function closeJournalPanel() {
    const tabContent = document.getElementById('tab-content');
    const panel = document.getElementById('journal-panel');
    if (!tabContent || !panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    tabContent.classList.remove('journal-open');
    journalPanelOpen = false;
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 320);
}

// Initialize map
function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView([46.2, 7.5], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}

// Function to create a colored triangle icon with outline
function createTriangleIcon(color, isCompleted) {
    const outlineWidth = '0.6';
    const trianglePath = 'M10 2 L2 18 L18 18 Z';
    const snowCapSvg = isCompleted
        ? '<path d="M10 2.35 L6.5 9 L13.5 9 Z" fill="white" opacity="0.95"/>'
        : '';
    return L.divIcon({
        html: `
            <svg width="24" height="24" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="${trianglePath}" fill="${color}"/>
                ${snowCapSvg}
                <path d="${trianglePath}" fill="none" stroke="black" stroke-width="${outlineWidth}"/>
            </svg>
        `,
        className: 'summit-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

function parseDurationToHours(duration) {
    if (duration == null) return null;
    if (typeof duration === 'number' && Number.isFinite(duration)) return duration; // stored as hours

    const raw = String(duration).trim();
    if (!raw) return null;

    // Detect "2 days" / "2 jours" / "2j"
    const dayMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(jour(?:s)?|day(?:s)?|j)\b/i);
    if (dayMatch) {
        const num = parseFloat(dayMatch[1].replace(',', '.'));
        if (!Number.isFinite(num)) return null;
        return num * 24;
    }

    // Otherwise treat as hours (e.g. "2" or "2.5")
    const decimalHours = parseFloat(raw.replace(',', '.'));
    if (!Number.isFinite(decimalHours)) return null;
    return decimalHours;
}

function parseCotationToIndex(gradeRaw) {
    const raw = String(gradeRaw || '').trim();
    if (!raw) return null;

    // Accept "T1", "T 1", "t2", etc.
    const m = raw.match(/t\s*([1-6])/i);
    if (!m) return null;
    const idx = parseInt(m[1], 10);
    return Number.isFinite(idx) ? idx : null;
}

function extractLocationFromMessage(message) {
    const text = (message || '').trim();
    if (!text) return null;

    // Triggers (case-insensitive) + capture the following place name.
    // Stop at punctuation or at the stop words: "avec", "et", "pour", "de" (word).
    const locationRegex = /(?:près de|côté de|depuis|au-dessus de|à côté de|vers|dans les|dans le|en partant de)\s+(.+?)(?=$|[.,;:!?]|\b(avec|et|pour|de)\b)/i;
    const match = text.match(locationRegex);
    if (!match) return null;

    const placeName = (match[1] || '').trim().replace(/^["']|["']$/g, '').trim();
    return placeName || null;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    // Haversine formula (earth radius in km).
    const R = 6371;
    const toRad = (deg) => deg * (Math.PI / 180);
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function geocodePlaceName(placeName) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName)}&format=json&limit=1`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            // Note: browsers may ignore custom User-Agent header.
            'User-Agent': 'SkadiApp/1.0'
        }
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
}

// Function to format duration for popup/chat display.
// - If the sheet stores "X jour(s)" / "X j", keep it as days (do not convert to hours).
// - Otherwise format numeric hours as "HhMM".
function formatDuration(duration) {
    if (duration == null) return "N/A";

    if (typeof duration === 'string') {
        const raw = duration.trim();
        if (!raw) return "N/A";
        const lower = raw.toLowerCase();

        // Keep English days as-is
        if (lower.includes('day')) return raw;

        // Keep French days as display ("2 jours" / "2j")
        const dayMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(jour(?:s)?|j)\b/i);
        if (dayMatch) {
            const num = parseFloat(dayMatch[1].replace(',', '.'));
            if (!Number.isFinite(num)) return raw;
            const numStr = Number.isInteger(num) ? String(Math.trunc(num)) : String(num).replace(/\.0+$/, '');
            const unit = numStr === '1' ? 'jour' : 'jours';
            return `${numStr} ${unit}`;
        }
    }

    const decimalHours = parseFloat(String(duration).replace(',', '.'));
    if (!Number.isFinite(decimalHours)) {
        return "N/A";
    }

    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return minutes < 10 ? `${hours}h0${minutes}` : `${hours}h${minutes}`;
}

// Normalize sheet GPX values ("foo", "foo.gpx", "foo.geojson") to basename "foo".
function normalizeGpxBaseName(value) {
    const raw = (value || '').trim();
    if (!raw) return '';
    return raw
        .replace(/^.*[\\/]/, '')
        .replace(/\.geojson$/i, '')
        .replace(/\.gpx$/i, '');
}

// Define colors for each project
const projectColors = {
    'Proxima': '#45818e',
    'Annecy': '#3c78d8',
    'Bauges': '#674ea7',
    '4000': '#f1c232',
    'Aravis': '#a64d79',
    'Morges to Como': '#34a853',
    'Wien to Innsbruck': '#ea4335'
};

// Default color for activities without a project
const defaultColor = '#808080';
const projectColorKeysByLower = Object.keys(projectColors).reduce((acc, key) => {
    acc[key.toLowerCase()] = key;
    return acc;
}, {});
const warnedUnknownProjects = new Set();

function normalizeProjectName(project) {
    const raw = String(project || '')
        .replace(/[\u00A0\u202F]/g, ' ') // normalize non-breaking spaces from sheet exports
        .trim()
        .replace(/\s+/g, ' ');
    if (!raw) return 'No Project';
    // Handle numeric formatting variants like "4 000" and "4,000".
    const numericOnly = raw.replace(/[,\s]/g, '');
    if (numericOnly === '4000') return '4000';
    return raw;
}

function getProjectColor(project) {
    const normalized = normalizeProjectName(project);
    if (normalized === 'No Project') return defaultColor;
    if (projectColors[normalized]) return projectColors[normalized];

    // Fallback for case differences and accidental punctuation in project labels.
    const lowerKey = projectColorKeysByLower[normalized.toLowerCase()];
    if (lowerKey) return projectColors[lowerKey];

    // Extra-safe fallback for values like "'4000", "4000." etc.
    if (normalized.replace(/[^\d]/g, '') === '4000') return projectColors['4000'];

    if (!warnedUnknownProjects.has(normalized)) {
        warnedUnknownProjects.add(normalized);
        console.warn('Unknown project color mapping, using default:', normalized);
    }
    return defaultColor;
}

function getTrackColorByType(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('ski')) return '#46bdc6';
    if (t.includes('trail')) return '#ffaa6b';
    if (t.includes('randonnée') || t.includes('hike')) return '#ff6d01';
    if (t.includes('alpinisme') || t.includes('mountaineering')) return '#ea4335';
    if (t.includes('vélo') || t.includes('bike')) return '#34a853';
    return defaultColor;
}

// Summits: published sheet (gid=0). Bike: published sheet (gid=2069199560).
const SUMMITS_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRa2uc5r5sohJICr4Hb4TyQwlJxwtFCVk_NLqu_APJ6yF2FturE2YhbAhuaV_THn6AA0d9U_4BafJ9m/pub?gid=0&single=true&output=csv';

function getCsvPath() {
    return currentTab === 'bike'
        ? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vReJHYuqYbldPykQitSbHf--VtP6x1dq18OnmvGmajO6t-NzTtv6-uALyNzcipSZ5uRajKziZcZvS9N/pub?gid=2069199560&single=true&output=csv'
        : SUMMITS_SHEET_CSV_URL;
}

// Parse one CSV line (handles quoted fields and "" escape). Returns array of strings.
function parseCsvLine(line) {
    const out = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            out.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    // Keep trailing empty fields (e.g. "...," -> last value is empty string).
    out.push(field);
    return out;
}

function normalizeDecimal(value) {
    if (value == null || (typeof value === 'string' && !value.trim())) return (value || '').toString().trim();
    const s = String(value).trim();
    return s.replace(',', '.');
}

// Same logic as export_sheet_to_csv.py: skip first 3 rows, columns C–O, inherit H–M when N same, "to do" → empty H–N, same summit twice → inherit summit. Returns CSV string (header + rows).
function processSheetToSummitsRows(sheetCsvText) {
    const lines = sheetCsvText.split(/\r?\n/).filter(l => l.length > 0);
    const dataLines = lines.slice(3); // skip rows 1–3
    const header = 'Status,Name,Altitude [m],Summit Latitude,Summit Longitude,Season,Type,Grade,Distance [km],Duration [h],Elevation Gain [m],GPX File,Project,Activity URL,Photo URLs,Journal';
    let lastActivity = null;
    let lastSummit = null;
    const outRows = [];

    for (let i = 0; i < dataLines.length; i++) {
        let row = parseCsvLine(dataLines[i]);
        if (row.length < 20) row = row.concat(Array(20 - row.length).fill(''));
        const cToO = row.slice(2, 16);
        let photoUrls = (row[18] || '').trim();  // column S
        let journalEntry = (row[19] || '').trim(); // column T
        let [status, name, altitude, summitLat, summitLon, season, type_, grade, distance, duration, elevationGain, gpxFile, project, activityUrl] = cToO;
        let nameStripped = (name || '').trim();
        const projectStripped = (project || '').trim();
        const gpxFileStripped = (gpxFile || '').trim();
        let seasonStripped = (season || '').trim();
        const statusLower = (status || '').trim().toLowerCase();
        const isToDo = statusLower === 'to do';

        if (!nameStripped && !(summitLat || '').trim() && !(summitLon || '').trim()) {
            // Ignore blank/placeholder rows (common at the end of the sheet) so we do not
            // accidentally duplicate the previous summit with inherited values.
            const hasActivityPayload = [
                season, type_, grade, distance, duration, elevationGain, gpxFileStripped, projectStripped, activityUrl
            ].some(v => (v || '').trim());
            if (!hasActivityPayload || statusLower === 'to do') continue;
            if (lastSummit == null) continue;
            [nameStripped, altitude, summitLat, summitLon] = lastSummit;
        }
        if (nameStripped === 'Summit' || nameStripped === 'Name' || gpxFileStripped === 'GPX File' || projectStripped === 'Project') continue;

        const sameActivity = !isToDo && lastActivity != null && gpxFileStripped && gpxFileStripped === lastActivity[0];
        if (sameActivity) {
            const [, lastSeason, lastType, lastGrade, lastDistance, lastDuration, lastElevationGain, , lastActivityUrl, lastPhotoUrls, lastJournalEntry] = lastActivity;
            if (!seasonStripped) { season = lastSeason; seasonStripped = season; }
            if (!(type_ || '').trim()) type_ = lastType;
            if (!(grade || '').trim()) grade = lastGrade;
            if (!(distance || '').trim()) distance = lastDistance;
            if (!(duration || '').trim()) duration = lastDuration;
            if (!(elevationGain || '').trim()) elevationGain = lastElevationGain;
            if (!(activityUrl || '').trim()) activityUrl = lastActivityUrl;
            if (!photoUrls) photoUrls = lastPhotoUrls || '';
            if (!journalEntry) journalEntry = lastJournalEntry || '';
        }

        if (gpxFileStripped && !isToDo) {
            lastActivity = [gpxFileStripped, (season || '').trim(), (type_ || '').trim(), (grade || '').trim(), (distance || '').trim(), (duration || '').trim(), (elevationGain || '').trim(), (project || '').trim(), (activityUrl || '').trim(), photoUrls, journalEntry];
        }

        altitude = normalizeDecimal(altitude);
        summitLat = normalizeDecimal(summitLat);
        summitLon = normalizeDecimal(summitLon);
        distance = normalizeDecimal(distance);
        duration = normalizeDecimal(duration);
        elevationGain = normalizeDecimal(elevationGain);

        let outSeason, outType, outGrade, outDistance, outDuration, outElevationGain, outGpxFile, outActivityUrl, outPhotoUrls, outJournalEntry;
        if (isToDo) {
            outSeason = outType = outGrade = outDistance = outDuration = outElevationGain = outGpxFile = outActivityUrl = outPhotoUrls = outJournalEntry = '';
        } else {
            outSeason = (season || '').trim();
            outType = (type_ || '').trim();
            outGrade = (grade || '').trim();
            outDistance = distance;
            outDuration = duration;
            outElevationGain = elevationGain;
            outGpxFile = gpxFileStripped;
            outActivityUrl = (activityUrl || '').trim();
            outPhotoUrls = photoUrls;
            outJournalEntry = journalEntry;
        }

        const escapeCsv = (v) => (v == null ? '' : String(v).includes(',') ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
        outRows.push([(status || '').trim(), nameStripped, altitude, summitLat, summitLon, outSeason, outType, outGrade, outDistance, outDuration, outElevationGain, outGpxFile, projectStripped || 'No Project', outActivityUrl, outPhotoUrls, outJournalEntry].map(escapeCsv).join(','));
        lastSummit = [nameStripped, altitude, summitLat, summitLon];
    }

    return header + '\n' + outRows.join('\n');
}

// Parse column S: "url1|url2", "none", or empty. Returns array of valid URLs (http/https); empty if none.
function isLikelyImageUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const pathname = u.pathname.toLowerCase();
        // Accept common image extensions used by Strava/CDN photos.
        if (/\.(jpg|jpeg|png|webp|gif|avif)(?:$|\?)/i.test(pathname)) return true;
        // Fallback: some providers pass image format via query params.
        const format = (u.searchParams.get('format') || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(format)) return true;
        return false;
    } catch (_err) {
        return false;
    }
}

function parsePhotoUrlsFromColumnS(value) {
    const raw = (value || '').trim();
    if (!raw || raw.toLowerCase() === 'none') return [];
    const candidates = raw.split('|').map(s => (s || '').trim()).filter(Boolean);
    const valid = [];
    candidates.forEach((u) => {
        if (isLikelyImageUrl(u)) {
            valid.push(u);
        } else {
            console.warn('Skipping non-image photo URL in column S:', u);
        }
    });
    return valid;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Parse column T:
// - empty => none
// - starts with "journal/" => markdown path
// - otherwise => inline plain text for popup
function parseJournalEntry(value) {
    const raw = String(value || '').trim();
    if (!raw) return { kind: 'none', value: '' };
    if (/^journal\//i.test(raw)) return { kind: 'path', value: raw };
    return { kind: 'text', value: raw };
}

// Returns display text for column P link, or null if URL should be skipped.
function getActivityLinkText(url) {
    const u = (url || '').trim();
    if (!u) return null;
    const lower = u.toLowerCase();
    if (lower.includes('strava')) return 'Activité Strava';
    if (lower.includes('komoot')) return 'Parcours Komoot';
    return null;
}

function buildSummitPopupContent(name, altitude, project, status) {
    const statusLabel = status === 'completed' ? 'Accompli' : 'À gravir';
    return `
        <b>${name} ${altitude ? `(${altitude}m)` : ''}</b><br>
        <b>Projet :</b> ${project}<br>
        <b>Statut :</b> ${statusLabel}
    `;
}

// Build popup HTML once for track layers (used by both visible and invisible layers)
function buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType, activityUrl, photoUrlsColumnS, journalColumnT) {
    const photoUrls = parsePhotoUrlsFromColumnS(photoUrlsColumnS);
    const hasPhotos = photoUrls.length > 0;
    const photoBlock = hasPhotos
        ? (() => { const escaped = photoUrls.map(u => u.replace(/"/g, '&quot;')).join('|'); return ` <span class="popup-photos-row" data-photo-urls="${escaped}"><button type="button" class="popup-photos-btn" aria-label="Voir les photos">📸</button></span>`; })()
        : '';
    const journal = parseJournalEntry(journalColumnT);
    const journalButtonBlock = journal.kind === 'path'
        ? ` <span class="popup-journal-row" data-journal-path="${escapeHtml(journal.value)}" data-journal-title="${escapeHtml(gpxName)}"><button type="button" class="popup-journal-btn" aria-label="Voir le récit">📖</button></span>`
        : '';
    const journalTextBlock = journal.kind === 'text'
        ? `<p class="popup-journal-text">${escapeHtml(journal.value)}</p>`
        : '';
    let html = `<b>${gpxName}</b>${photoBlock}${journalButtonBlock}<br><b>Saison :</b> ${season}`;
    if (dataType !== 'bike') html += `<br><b>Type :</b> ${type}`;
    if (grade) html += `<br><b>Cotation :</b> ${grade}`;
    if (distance) html += `<br><b>Distance :</b> ${distance} km`;
    if (duration) html += `<br><b>Durée :</b> ${duration}`;
    if (elevationGain) html += `<br><b>Dénivelé :</b> ${elevationGain} m`;
    html += journalTextBlock;
    const linkText = getActivityLinkText(activityUrl);
    if (linkText) {
        const href = (activityUrl || '').trim();
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            html += `<br><a class="popup-activity-link" href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
        }
    }
    return html;
}

function buildLegendProjectRowsHtml() {
    const bikeOnlyProjects = new Set(['Morges to Como', 'Wien to Innsbruck']);
    return Object.entries(projectColors)
        .filter(([projectName]) => !bikeOnlyProjects.has(projectName))
        .map(([projectName, color]) => (
        `<div class="legend-row">
            <span class="legend-icon">
                <svg width="18" height="18" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10 2 L2 18 L18 18 Z" fill="${color}"></path>
                </svg>
            </span>
            <span>${projectName}</span>
        </div>`
    )).join('');
}

function buildLegendActivityRowsHtml() {
    const activityLegendItems = [
        { key: 'Ski', label: 'Ski' },
        { key: 'Trail Running', label: 'Trail Running' },
        { key: 'Randonnée', label: 'Randonnée' },
        { key: 'Alpinisme', label: 'Alpinisme' },
        { key: 'Vélo', label: 'Vélo' }
    ];
    return activityLegendItems.map((item) => (
        `<div class="legend-row">
            <span class="legend-track-line" style="border-top-color:${getTrackColorByType(item.key)};"></span>
            <span>${item.label}</span>
        </div>`
    )).join('');
}

function renderLegendContent() {
    const legendPanel = document.getElementById('map-legend');
    if (!legendPanel) return;
    const completedIconHtml = createTriangleIcon(defaultColor, true).options.html;
    const todoIconHtml = createTriangleIcon(defaultColor, false).options.html;
    legendPanel.innerHTML = `
        <div class="legend-section">
            <div class="legend-title">Sommets</div>
            <div class="legend-row"><span class="legend-icon">${completedIconHtml}</span><span>Sommet gravi</span></div>
            <div class="legend-row"><span class="legend-icon">${todoIconHtml}</span><span>Sommet à gravir</span></div>
        </div>
        <div class="legend-section">
            <div class="legend-title">Projets</div>
            ${buildLegendProjectRowsHtml()}
        </div>
        <div class="legend-section">
            <div class="legend-title">Type d'activité</div>
            ${buildLegendActivityRowsHtml()}
        </div>
    `;
}

function closeLegend() {
    const legendPanel = document.getElementById('map-legend');
    const legendToggleBtn = document.getElementById('legend-toggle-btn');
    if (!legendPanel || !legendToggleBtn) return;
    legendPanel.classList.add('hidden');
    legendPanel.setAttribute('aria-hidden', 'true');
    legendToggleBtn.setAttribute('aria-expanded', 'false');
}

function setLegendEnabled(enabled) {
    const legendPanel = document.getElementById('map-legend');
    const legendToggleBtn = document.getElementById('legend-toggle-btn');
    if (!legendPanel || !legendToggleBtn) return;
    if (enabled) {
        legendToggleBtn.classList.remove('hidden');
        legendToggleBtn.disabled = false;
    } else {
        closeLegend();
        legendToggleBtn.classList.add('hidden');
        legendToggleBtn.disabled = true;
    }
}

// Function to load GeoJSON files dynamically
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName, dataType, activityUrl, photoUrlsColumnS, journalColumnT) {
    const dataPath = dataType === 'bike' ? 'data/bike/processed/' : 'data/processed/';
    const gpxBaseName = normalizeGpxBaseName(gpxFile);
    if (!gpxBaseName) return;

    if (loadedGeoJSONFiles[dataType + gpxBaseName]) {
        return; // Skip if the file has already been loaded
    }

    const popupContent = buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType, activityUrl, photoUrlsColumnS || '', journalColumnT || '');
    const journalMeta = parseJournalEntry(journalColumnT);
    const opensJournalDirectly = dataType === 'bike' && journalMeta.kind === 'path';
    // Apply wider minimum popup only when column T is plain text.
    const popupOptions = journalMeta.kind === 'text'
        ? { className: 'journal-text-popup', minWidth: 520, maxWidth: 2000 }
        : undefined;

    fetch(`${dataPath}${gpxBaseName}.geojson`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load GeoJSON: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            // Original track layer
            const track = L.geoJSON(data, {
                style: { color: color, weight: 3 },
                onEachFeature: function(feature, layer) {
                    if (!opensJournalDirectly) {
                        layer.bindPopup(popupContent, popupOptions);
                    }
                    layer.on('click', function() {
                        track.bringToFront();
                        layer.setStyle({ weight: 6 });
                        if (opensJournalDirectly) {
                            openJournalPanel(gpxName, journalMeta.value);
                        }
                    });
                    layer.on('popupclose', function() {
                        layer.setStyle({ weight: 3 });
                    });
                }
            }).addTo(map);

            // Invisible layer for better clickability
            const invisibleTrack = L.geoJSON(data, {
                style: { color: 'transparent', weight: 15, opacity: 0 },
                interactive: true,
                onEachFeature: function(feature, layer) {
                    if (!opensJournalDirectly) {
                        layer.bindPopup(popupContent, popupOptions);
                    }
                    layer.on('click', function() {
                        track.bringToFront();
                        track.eachLayer(function(trackLayer) {
                            trackLayer.setStyle({ weight: 6 });
                        });
                        if (opensJournalDirectly) {
                            openJournalPanel(gpxName, journalMeta.value);
                        }
                    });
                    layer.on('popupclose', function() {
                        track.eachLayer(function(trackLayer) {
                            trackLayer.setStyle({ weight: 3 });
                        });
                    });
                }
            }).addTo(map);

            tracks.push({
                layer: track,
                invisibleLayer: invisibleTrack,
                type: type,
                status: 'completed',
                season: season,
                gpxName: gpxName,
                coordinates: data.features[0].geometry.coordinates,
                bounds: track.getBounds(),
                dataType: dataType
            });

            if (activeRecommendationKeys && activeRecommendationKeys.size > 0) {
                if (!activeRecommendationKeys.has(gpxName)) {
                    map.removeLayer(track);
                    map.removeLayer(invisibleTrack);
                }
            } else {
                const nameFilterLower = (latestFilterState.name || '').trim().toLowerCase();
                const typeMatch = latestFilterState.activityType === 'all' || normalizeActivityTypeValue(type) === normalizeActivityTypeValue(latestFilterState.activityType);
                const statusMatch = latestFilterState.status === 'all' || 'completed' === latestFilterState.status;
                const seasonMatch = latestFilterState.season === 'all' || season === latestFilterState.season;
                const nameMatch = !nameFilterLower || (gpxName || '').toLowerCase().includes(nameFilterLower);
                if (!(typeMatch && statusMatch && seasonMatch && nameMatch)) {
                    map.removeLayer(track);
                    map.removeLayer(invisibleTrack);
                }
            }

            loadedGeoJSONFiles[dataType + gpxBaseName] = true; // Mark this file as loaded
        })
        .catch(error => {
            console.error(`Error loading ${gpxBaseName}.geojson:`, error);
        });
}

// Function to focus on a GPX track
function focusOnGPXName(gpxName) {
    tracks.forEach(track => {
        if (track.gpxName === gpxName) {
            track.layer.bringToFront();
            track.layer.eachLayer(function(layer) {
                layer.setStyle({ weight: 6 });

                if (track.bounds && track.bounds.isValid()) {
                    map.fitBounds(track.bounds, { padding: [50, 50] });
                }

                layer.openPopup();
            });
        } else {
            track.layer.eachLayer(function(layer) {
                layer.setStyle({ weight: 3 });
            });
        }
    });
}

// Function to load data based on the current tab
function loadData() {
    // Clear existing markers and tracks
    markers.forEach(marker => map.removeLayer(marker.layer));
    tracks.forEach(track => {
        map.removeLayer(track.layer);
        map.removeLayer(track.invisibleLayer);
    });

    markers = [];
    tracks = [];
    loadedGeoJSONFiles = {};
    gpxNames = [];
    gpxNameSet = new Set();
    gpxNameToMarker = {};
    activityCatalog = [];

    // Summits: fetch published sheet and apply same processing as export_sheet_to_csv.py in the browser. Bike: published sheet as-is.
    const csvPath = getCsvPath();
    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            if (currentTab === 'summits') csvText = processSheetToSummitsRows(csvText);
            const rows = csvText.split(/\r?\n/).slice(1);
            const summitKeys = new Set();
            const summitStateByKey = new Map();
            const activityCatalogByKey = new Map();
            // When multiple summits share one activity, CSV export leaves activity columns empty for merged rows. Carry them over.
            let lastActivity = null;

            rows.forEach(row => {
                if (!row.trim()) return;

                const columns = parseCsvLine(row);
                const isBikeTab = currentTab === 'bike';
                const isSummitsTab = currentTab === 'summits';
                // Summits rows are generated by processSheetToSummitsRows with a fixed schema.
                const hasStatusCol = isSummitsTab ? true : columns.length >= 13;
                const minColumns = isSummitsTab ? 16 : 12;

                if (columns.length < minColumns) {
                    console.warn('Skipping malformed CSV row (not enough columns):', row);
                    return;
                }

                const statusCol = hasStatusCol ? (columns[0] || '').trim() : '';
                const statusColLower = statusCol.toLowerCase();
                const isToDoStatus = hasStatusCol && (statusColLower === 'to do' || statusColLower === 'à faire' || statusColLower === 'a faire');
                const nameIdx = hasStatusCol ? 1 : 0;
                let name = (columns[nameIdx] || '').trim();
                let altitudeRaw = (columns[nameIdx + 1] || '').trim();
                let summitLatitudeRaw = (columns[nameIdx + 2] || '').trim();
                let summitLongitudeRaw = (columns[nameIdx + 3] || '').trim();
                let season = (columns[nameIdx + 4] || '').trim();
                let type = (columns[nameIdx + 5] || '').trim();
                let grade = (columns[nameIdx + 6] || '').trim();
                let distance = (columns[nameIdx + 7] || '').trim();
                let duration = (columns[nameIdx + 8] || '').trim();
                let elevationGain = (columns[nameIdx + 9] || '').trim();
                const gpxFileCell = isSummitsTab
                    ? (columns[11] || '').trim() // fixed index in processed summits CSV
                    : (columns[nameIdx + 10] || '').trim();
                let gpxFileRaw = gpxFileCell;
                const projectRaw = (columns[nameIdx + 11] || '').trim();
                let project = normalizeProjectName(projectRaw || 'No Project');
                let activityUrl = (columns[nameIdx + 12] || '').trim();
                let photoUrls = (columns.length > nameIdx + 13) ? (columns[nameIdx + 13] || '').trim() : '';
                let journalEntry = (columns.length > nameIdx + 14) ? (columns[nameIdx + 14] || '').trim() : '';

                // Inherit activity data from previous row when this row has summit but empty activity (merged cells in sheet).
                // Do not inherit into explicit "to do" rows: they often have no activity fields by design.
                if (lastActivity && !gpxFileRaw && !season && !isToDoStatus) {
                    season = lastActivity.season;
                    type = lastActivity.type;
                    grade = lastActivity.grade;
                    distance = lastActivity.distance;
                    duration = lastActivity.duration;
                    elevationGain = lastActivity.elevationGain;
                    gpxFileRaw = lastActivity.gpxFile;
                    if (!projectRaw) {
                        project = normalizeProjectName(lastActivity.project || 'No Project');
                    }
                    activityUrl = lastActivity.activityUrl || activityUrl;
                    if (!photoUrls) photoUrls = lastActivity.photoUrls || '';
                    if (!journalEntry) journalEntry = lastActivity.journalEntry || '';
                } else if (gpxFileRaw || season) {
                    lastActivity = {
                        season,
                        type,
                        grade,
                        distance,
                        duration,
                        elevationGain,
                        gpxFile: normalizeGpxBaseName(gpxFileRaw),
                        project,
                        activityUrl,
                        photoUrls,
                        journalEntry
                    };
                }

                const gpxFile = normalizeGpxBaseName(gpxFileRaw) || null;
                let gpxName = (gpxFile ? gpxFile.replace(/_/g, ' ') : name).trim();
                if (isBikeTab && !name && gpxName) name = gpxName;

                if (!name && !gpxFile && !gpxName) return;

                const altitude = parseFloat(altitudeRaw) || 0;
                const summitLatitude = parseFloat(summitLatitudeRaw);
                const summitLongitude = parseFloat(summitLongitudeRaw);

                if (Number.isFinite(summitLatitude) && Number.isFinite(summitLongitude)) {
                    // Key by name + coordinates to avoid collisions between homonymous summits.
                    const summitKey = `${name}__${summitLatitude}__${summitLongitude}`;
                    // Explicit Status (column C): "to do" overrides GPX presence.
                    // For empty status, completion is based on the row GPX cell (column N) only.
                    let isCompleted;
                    if (hasStatusCol && (statusColLower === 'to do' || statusColLower === 'à faire' || statusColLower === 'a faire')) {
                        isCompleted = false;
                    } else if (hasStatusCol && statusColLower === 'completed') {
                        isCompleted = true;
                    } else {
                        isCompleted = !!gpxFileCell;
                    }

                    if (!summitKeys.has(summitKey)) {
                        const projectColor = getProjectColor(project);
                        const summitIcon = createTriangleIcon(projectColor, isCompleted);

                        const marker = L.marker([summitLatitude, summitLongitude], { icon: summitIcon })
                            .addTo(map)
                            .bindPopup(buildSummitPopupContent(name, altitude, project, isCompleted ? 'completed' : 'to do'));

                        const markerState = {
                            layer: marker,
                            type: type,
                            status: isCompleted ? 'completed' : 'to do',
                            season: season,
                            name: name,
                            summitKey: summitKey,
                            dataType: currentTab,
                            activityKeys: new Set()
                        };
                        if (gpxName) markerState.activityKeys.add(gpxName);
                        markers.push(markerState);

                        if (gpxName) {
                            gpxNameToMarker[gpxName] = marker;
                        }

                        summitKeys.add(summitKey);
                        summitStateByKey.set(summitKey, markerState);
                    } else {
                        const existing = summitStateByKey.get(summitKey);
                        if (existing) {
                            if (gpxName) existing.activityKeys.add(gpxName);
                            // Completed always wins if any row for this summit is completed.
                            const shouldBeCompleted = existing.status === 'completed' || isCompleted;
                            const nextStatus = shouldBeCompleted ? 'completed' : 'to do';
                            if (existing.status !== nextStatus) {
                                const projectColor = getProjectColor(project);
                                existing.layer.setIcon(createTriangleIcon(projectColor, shouldBeCompleted));
                                existing.layer.setPopupContent(buildSummitPopupContent(name, altitude, project, nextStatus));
                                existing.status = nextStatus;
                            }
                        }
                    }
                }

                // Load GeoJSON for every row that has a GPX file (same summit can have multiple tracks).
                if (gpxFile && gpxName) {
                    const distanceKm = parseFloat(normalizeDecimal(distance));
                    const durationHours = parseDurationToHours(duration);
                    const elevationM = parseFloat(normalizeDecimal(elevationGain));
                    if (!activityCatalogByKey.has(gpxName)) {
                        const cotationIndex = parseCotationToIndex(grade);
                        activityCatalogByKey.set(gpxName, {
                            key: gpxName,
                            name: gpxName,
                            distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
                            durationHours: Number.isFinite(durationHours) ? durationHours : null,
                            // Keep a human-readable duration label for popups/chat.
                            // If the sheet stores "X jours"/"Xj", this will stay in days (not converted to hours).
                            durationLabel: formatDuration(duration),
                            cotationIndex,
                            elevationM: Number.isFinite(elevationM) ? elevationM : null,
                            season: season || null,
                            type: type || null,
                // Summit coordinates used for location-based recommendations.
                summitLat: Number.isFinite(summitLatitude) ? summitLatitude : null,
                summitLon: Number.isFinite(summitLongitude) ? summitLongitude : null,
                            status: hasStatusCol && (statusColLower === 'to do' || statusColLower === 'à faire' || statusColLower === 'a faire') ? 'to do' : 'completed',
                            dataType: currentTab
                        });
                    }
                    if (!gpxNameSet.has(gpxName)) {
                        gpxNameSet.add(gpxName);
                        gpxNames.push(gpxName);
                    }
                    const trackColor = currentTab === 'bike'
                        ? getProjectColor(project)
                        : getTrackColorByType(type);

                    const formattedDuration = formatDuration(duration);
                    loadGeoJSON(
                        gpxFile,
                        trackColor,
                        season,
                        type,
                        grade,
                        distance,
                        formattedDuration,
                        elevationGain,
                        gpxName,
                        currentTab,
                        activityUrl,
                        photoUrls,
                        journalEntry
                    );
                }

            });

            activityCatalog = Array.from(activityCatalogByKey.values());
            // Re-apply current map state after data reload (tab switch, etc.).
            if (activeRecommendationKeys && activeRecommendationKeys.size > 0) {
                applyRecommendationVisibility(activeRecommendationKeys);
            } else {
                applyFilters(latestFilterState);
            }
        })
        .catch(error => {
            console.error('Error loading CSV:', error);
        });
}

// Debounce helper to limit search updates while typing
function debounce(fn, ms) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), ms);
    };
}

function runSearch() {
    const searchInput = document.getElementById('search');
    if (!searchInput) return;
    const searchTerm = searchInput.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    const clearSearchButton = document.getElementById('clear-search');
    if (!resultsContainer || !clearSearchButton) return;

    if (searchTerm.length === 0) {
        clearSearchButton.style.display = 'none';
        resultsContainer.style.display = 'none';
        return;
    }
    clearSearchButton.style.display = 'block';

    const matches = gpxNames.filter(name => name.toLowerCase().includes(searchTerm));
    resultsContainer.innerHTML = '';
    if (matches.length > 0) {
        const fragment = document.createDocumentFragment();
        matches.forEach(match => {
            const div = document.createElement('div');
            div.textContent = match;
            div.style.color = 'white';
            div.addEventListener('click', function() {
                searchInput.value = match;
                resultsContainer.style.display = 'none';
                focusOnGPXName(match);
            });
            fragment.appendChild(div);
        });
        resultsContainer.appendChild(fragment);
        resultsContainer.style.display = 'block';
    } else {
        resultsContainer.style.display = 'none';
    }
}

function normalizeActivityTypeValue(value) {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized || normalized === 'all') return 'all';
    if (normalized === 'trail running') return 'Trail Running';
    if (normalized.includes('randonnée')) return 'Randonnée';
    if (normalized.includes('alpinisme')) return 'Alpinisme';
    if (normalized.includes('vélo') || normalized.includes('velo')) return 'Vélo';
    if (normalized.includes('ski')) return 'Ski';
    return (value || '').trim();
}

function normalizeSeasonValue(value) {
    return String(value || '')
        .replace(/[\u00A0\u202F]/g, ' ')
        .trim()
        .toLowerCase();
}

function markerHasActivityNameMatch(marker, nameFilterLower) {
    if (!nameFilterLower) return true;
    if ((marker.name || '').toLowerCase().includes(nameFilterLower)) return true;
    if (!marker.activityKeys || marker.activityKeys.size === 0) return false;
    for (const key of marker.activityKeys) {
        if (key.toLowerCase().includes(nameFilterLower)) return true;
    }
    return false;
}

function applyRecommendationVisibility(selectedKeys) {
    activeRecommendationKeys = selectedKeys;
    markers.forEach(marker => {
        if (marker.dataType !== currentTab) return;
        const hasMatch = marker.activityKeys && Array.from(marker.activityKeys).some((key) => selectedKeys.has(key));
        // En mode recommandation, on n'affiche que les sommets "accomplis".
        // Ça évite que des to-do apparaissent si une activité est liée à tort à un summit.
        if (hasMatch && marker.status === 'completed') {
            map.addLayer(marker.layer);
        } else {
            map.removeLayer(marker.layer);
        }
    });

    tracks.forEach(track => {
        if (track.dataType !== currentTab) return;
        if (selectedKeys.has(track.gpxName)) {
            map.addLayer(track.layer);
            map.addLayer(track.invisibleLayer);
        } else {
            map.removeLayer(track.layer);
            map.removeLayer(track.invisibleLayer);
        }
    });
}

// Clear search input
const searchInputEl = document.getElementById('search');
const clearSearchBtnEl = document.getElementById('clear-search');
if (searchInputEl) {
    searchInputEl.addEventListener('input', debounce(runSearch, 150));
}
if (searchInputEl && clearSearchBtnEl) {
    clearSearchBtnEl.addEventListener('click', function() {
        searchInputEl.value = '';
        const searchResultsEl = document.getElementById('search-results');
        if (searchResultsEl) searchResultsEl.style.display = 'none';
        searchInputEl.focus();
        clearSearchBtnEl.style.display = 'none';
    });
}

// Handle Enter key in search
if (searchInputEl) {
    searchInputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const searchTerm = e.target.value;
            focusOnGPXName(searchTerm);
            const searchResultsEl = document.getElementById('search-results');
            if (searchResultsEl) searchResultsEl.style.display = 'none';
        }
    });
}

// Function to apply filters
function applyFilters(filters = null) {
    const fallbackActivityType = document.getElementById('activity-type') ? document.getElementById('activity-type').value : 'all';
    const fallbackStatus = document.getElementById('status') ? document.getElementById('status').value : 'all';
    const fallbackSeason = document.getElementById('season') ? document.getElementById('season').value : 'all';
    const fallbackName = document.getElementById('search') ? document.getElementById('search').value : '';

    const activityType = normalizeActivityTypeValue(filters && typeof filters.activityType === 'string' ? filters.activityType : fallbackActivityType);
    const status = filters && typeof filters.status === 'string' ? filters.status : fallbackStatus;
    const season = filters && typeof filters.season === 'string' ? filters.season : fallbackSeason;
    const nameFilter = filters && typeof filters.name === 'string' ? filters.name : fallbackName;
    const nameFilterLower = (nameFilter || '').trim().toLowerCase();
    latestFilterState = { activityType, status, season, name: nameFilter || '' };
    activeRecommendationKeys = null;

    markers.forEach(marker => {
        if (marker.dataType !== currentTab) return;

        const typeMatch = activityType === 'all' || normalizeActivityTypeValue(marker.type) === activityType;
        const statusMatch = status === 'all' || marker.status === status;
        const seasonMatch = season === 'all' || normalizeSeasonValue(marker.season) === normalizeSeasonValue(season);
        const nameMatch = markerHasActivityNameMatch(marker, nameFilterLower);

        if (typeMatch && statusMatch && seasonMatch && nameMatch) {
            map.addLayer(marker.layer);
        } else {
            map.removeLayer(marker.layer);
        }
    });

    tracks.forEach(track => {
        if (track.dataType !== currentTab) return;

        const typeMatch = activityType === 'all' || normalizeActivityTypeValue(track.type) === activityType;
        const statusMatch = status === 'all' || track.status === status;
        const seasonMatch = season === 'all' || normalizeSeasonValue(track.season) === normalizeSeasonValue(season);
        const nameMatch = !nameFilterLower || (track.gpxName || '').toLowerCase().includes(nameFilterLower);

        if (typeMatch && statusMatch && seasonMatch && nameMatch) {
            map.addLayer(track.layer);
            map.addLayer(track.invisibleLayer);
        } else {
            map.removeLayer(track.layer);
            map.removeLayer(track.invisibleLayer);
        }
    });
}

// Add event listener for the apply filters button
const applyFiltersBtn = document.getElementById('apply-filters');
if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', function() {
        applyFilters();
    });
}

// Add event listeners for tabs
document.querySelectorAll('#tabs a').forEach(tab => {
    tab.addEventListener('click', function(e) {
        e.preventDefault();

        // Remove active class from all tabs
        document.querySelectorAll('#tabs a').forEach(t => t.classList.remove('active'));

        // Add active class to clicked tab
        this.classList.add('active');

        // Set current tab
        currentTab = this.getAttribute('data-tab');
        closeJournalPanel();

        // Skadi must not appear nor influence the bike tab.
        // When switching to bikepacking, clear any active recommendation state so it doesn't hide layers.
        const skadiToggleBtn = document.getElementById('skadi-chat-toggle');
        const skadiPanel = document.getElementById('skadi-chat-panel');
        if (currentTab === 'bike') {
            activeRecommendationKeys = null;
            latestFilterState = { activityType: 'all', status: 'all', season: 'all', name: '' };

            if (skadiToggleBtn) skadiToggleBtn.classList.add('hidden');
            if (skadiPanel) skadiPanel.classList.add('hidden');
            if (skadiPanel) skadiPanel.setAttribute('aria-hidden', 'true');
            if (skadiToggleBtn) skadiToggleBtn.setAttribute('aria-expanded', 'false');
        } else {
            // Allow Skadi again on the summits tab.
            if (skadiToggleBtn) skadiToggleBtn.classList.remove('hidden');
        }

        // Show/hide filters based on the tab
        const filtersContainer = document.getElementById('filters-container');
        if (currentTab === 'bike') {
            if (filtersContainer) filtersContainer.classList.add('hidden');
            setLegendEnabled(false);
        } else {
            if (filtersContainer) filtersContainer.classList.remove('hidden');
            setLegendEnabled(true);
        }

        // Load data for the selected tab
        loadData();

        // Adjust map view based on the tab
        if (currentTab === 'bike') {
            map.setView([46.2, 7.5], 6); // More zoomed out for bike trips
        } else {
            map.setView([46.2, 7.5], 8); // Default view for summits
        }
    });
});

// Download CSV button (only active when the button is uncommented in index.html for debugging).
const downloadCsvBtn = document.getElementById('download-csv');
if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener('click', function() {
        const csvPath = getCsvPath();
        const filename = currentTab === 'bike' ? 'skadi_bike_website_data.csv' : 'skadi_summits_website_data.csv';
        fetch(csvPath)
            .then(function(response) { return response.text(); })
            .then(function(csvText) {
                if (currentTab === 'summits') csvText = processSheetToSummitsRows(csvText);
                const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
                URL.revokeObjectURL(a.href);
            })
            .catch(function(err) {
                console.error('Download CSV failed:', err);
            });
    });
}

const SKADI_HELP_MESSAGE = `Bonjour ! Je suis Skadi, ton guide dans la montagne. Tu peux me parler de ce que tu cherches de deux façons :
Pour filtrer la carte, dis-moi par exemple :

"randonnée en été"
"accompli" ou "à faire"
le nom d'une activité

Pour trouver les 3 activités qui te correspondent le mieux, donne-moi au moins une de ces infos :

une distance (ex: "15km")
une durée (ex: "3 heures" ou "2j" ou "1 jour")
un dénivelé (ex: "1000m")
une cotation (ex: "T3")
une localisation (ex: "près de Lausanne")
Tu peux aussi demander l'avis de Charles en mentionnant son prénom.

Exemple: "randonnée près de Lausanne autour de 15km avec 1000m de dénivelé"`;
let skadiHelpShown = false;

function parseLocalizedNumber(raw) {
    if (!raw) return null;
    const n = parseFloat(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function detectSkadiMode(message) {
    const text = (message || '').toLowerCase();
    const hasDistance = /\b\d+(?:[.,]\d+)?\s*(km|kilom[eè]tre(?:s)?)\b/i.test(text);
    const hasDurationHours = /\b\d+(?:[.,]\d+)?\s*(heure(?:s)?|h)\b/i.test(text) || /\b\d+h\d{1,2}\b/i.test(text);
    const hasDurationDays = /\b\d+(?:[.,]\d+)?\s*(jour(?:s)?|j)\b/i.test(text);
    const hasDuration = hasDurationHours || hasDurationDays;
    // Elevation: accept common explicit patterns + a bare "400m" / "400 m " as elevation meters.
    const hasElevation =
        /\b\d+(?:[.,]\d+)?\s*m\s*(de\s*d[eé]nivel[eé]|d\+)\b/i.test(text) ||
        /\bd\+\b/i.test(text) ||
        /\bd[eé]nivel[eé]\b/i.test(text) ||
        /\bm\s*d\+\b/i.test(text) ||
        /\b\d+(?:[.,]\d+)?\s*m\b/i.test(text);
    const hasCotation = /\bt\s*[1-6]\b/i.test(text);
    const hasLocation = /(?:près de|côté de|depuis|au-dessus de|à côté de|vers|dans les|dans le|en partant de)\s+/i.test(text);
    return (hasDistance || hasDuration || hasElevation || hasCotation || hasLocation) ? 'recommendation' : 'filter';
}

function extractRecommendationTargets(message) {
    const text = (message || '').toLowerCase();
    let distanceKm = null;
    let durationHours = null;
    let elevationM = null;
    let cotationIndex = null;

    const distanceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kilom[eè]tre(?:s)?)/i);
    if (distanceMatch) {
        distanceKm = parseLocalizedNumber(distanceMatch[1]);
    }

    const dayMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(jour(?:s)?|j)\b/i);
    if (dayMatch) {
        const days = parseLocalizedNumber(dayMatch[1]);
        // Convert "jours" en heures pour le scoring (2 jours != 2 heures).
        if (days != null) durationHours = days * 24;
    } else {
    const hMinMatch = text.match(/(\d+)\s*h\s*(\d{1,2})\b/i);
    if (hMinMatch) {
        const hours = parseLocalizedNumber(hMinMatch[1]) || 0;
        const minutes = parseLocalizedNumber(hMinMatch[2]) || 0;
        durationHours = hours + (minutes / 60);
    } else {
        const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:heure(?:s)?|h)\b/i);
        if (hourMatch) {
            durationHours = parseLocalizedNumber(hourMatch[1]);
        } else {
            const minuteMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:minute(?:s)?)\b/i);
            if (minuteMatch) {
                const minutes = parseLocalizedNumber(minuteMatch[1]);
                if (minutes != null) durationHours = minutes / 60;
            }
        }
    }
    }

    const elevationPatterns = [
        // Accept bare "400m" / "400 m " as elevation meters.
        /(\d+(?:[.,]\d+)?)\s*m\b/i,
        /(\d+(?:[.,]\d+)?)\s*m\s*de\s*d[eé]nivel[eé]/i,
        /(\d+(?:[.,]\d+)?)\s*m\s*d\+/i,
        /(\d+(?:[.,]\d+)?)\s*d\+/i,
        /(\d+(?:[.,]\d+)?)\s*m\b.*d[eé]nivel[eé]/i,
        /d[eé]nivel[eé].*?(\d+(?:[.,]\d+)?)/i
    ];
    for (const pattern of elevationPatterns) {
        const match = text.match(pattern);
        if (match) {
            elevationM = parseLocalizedNumber(match[1]);
            break;
        }
    }

    const cotMatch = text.match(/\bt\s*([1-6])\b/i);
    if (cotMatch) {
        const idx = parseInt(cotMatch[1], 10);
        cotationIndex = Number.isFinite(idx) ? idx : null;
    }

    return { distanceKm, durationHours, elevationM, cotationIndex };
}

function parseFilterIntent(message) {
    const text = (message || '').toLowerCase();
    let remaining = text;

    let season = 'all';
    // Avoid \b because accented characters (ex: "été") are not "word chars" in JS regex \b.
    if (/été|ete/i.test(text)) season = 'Été';
    else if (/hiver/i.test(text)) season = 'Hiver';
    else if (/printemps/i.test(text)) season = 'Printemps';
    else if (/automne/i.test(text)) season = 'Automne';

    let activityType = 'all';
    if (/randonn[ée]e?/i.test(text) || /rando|randon/i.test(text)) activityType = 'Randonnée';
    else if (/ski/i.test(text)) activityType = 'Ski';
    else if (/trail/i.test(text)) activityType = 'Trail Running';
    else if (/alpinisme|alpine/i.test(text)) activityType = 'Alpinisme';
    else if (/vélo|velo|bike/i.test(text)) activityType = 'Vélo';

    let status = 'all';
    if (/accompli/i.test(text)) status = 'completed';
    else if (/(a|à)\s*faire/i.test(text)) status = 'to do';

    const cleanupPatterns = [
        /été|ete/gi,
        /hiver/gi,
        /printemps/gi,
        /automne/gi,
        /randonn[ée]e?/gi,
        /rando|randon/gi,
        /ski/gi,
        /trail/gi,
        /alpinisme|alpine/gi,
        /vélo|velo|bike/gi,
        /accompli/gi,
        /(a|à)\s*faire/gi,
        /\b(en|de|du|des|avec|autour|la|le|les|pour|une|un)\b/gi
    ];
    cleanupPatterns.forEach((pattern) => {
        remaining = remaining.replace(pattern, ' ');
    });
    remaining = remaining.replace(/\s+/g, ' ').trim();

    return {
        season,
        activityType,
        status,
        name: remaining
    };
}

function resetMapForChatQuery() {
    activeRecommendationKeys = null;
    latestFilterState = { activityType: 'all', status: 'all', season: 'all', name: '' };
    applyFilters(latestFilterState);
    if (currentTab === 'bike') {
        map.setView([46.2, 7.5], 6);
    } else {
        map.setView([46.2, 7.5], 8);
    }
}

function getVisibleActivityCount() {
    let count = 0;
    const seen = new Set();

    tracks.forEach((track) => {
        if (track.dataType !== currentTab) return;
        if (!map.hasLayer(track.layer)) return;
        const key = `track:${track.gpxName}`;
        if (seen.has(key)) return;
        seen.add(key);
        count += 1;
    });

    markers.forEach((marker) => {
        if (marker.dataType !== currentTab) return;
        if (!map.hasLayer(marker.layer)) return;
        const key = `marker:${marker.summitKey || marker.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        count += 1;
    });

    return count;
}

function buildFilterConfirmation(intent, count) {
    if (count === 0) {
        return "Je n'ai trouvé aucune activité correspondant à ta recherche. Tu peux reformuler ou consulter le message d'aide en tapant 'aide'.";
    }
    const bits = [];
    if (intent.activityType !== 'all') bits.push(intent.activityType.toLowerCase());
    if (intent.season !== 'all') bits.push(`en ${intent.season.toLowerCase()}`);
    if (intent.status === 'completed') bits.push('accomplies');
    if (intent.status === 'to do') bits.push('à faire');
    if (intent.name) bits.push(`qui correspondent à "${intent.name}"`);
    const details = bits.length ? ` : ${bits.join(' ')}` : '';
    return `J'ai filtré la carte pour toi${details} (${count} activité${count > 1 ? 's' : ''}).`;
}

function formatHoursForChat(hours) {
    if (!Number.isFinite(hours)) return 'N/A';
    return formatDuration(String(hours));
}

function formatDistanceForChat(distanceKm) {
    if (!Number.isFinite(distanceKm)) return 'N/A';
    return Number.isInteger(distanceKm) ? `${distanceKm}` : distanceKm.toFixed(1).replace(/\.0$/, '');
}

function formatElevationForChat(elevationM) {
    if (!Number.isFinite(elevationM)) return 'N/A';
    return `${Math.round(elevationM)}`;
}

function getRelativeDifference(actual, target) {
    const denominator = Math.max(Math.abs(target), 0.0001);
    return Math.abs(actual - target) / denominator;
}

function getRecommendationMatches(intent) {
    const filters = intent && intent.filters ? intent.filters : {};
    const targets = intent && intent.targets ? intent.targets : {};
    const distanceTarget = targets.distance_km;
    const durationMinTarget = targets.duration_min;
    const elevationTarget = targets.elevation_m;
    const cotationIndexTarget = targets.cotation_index;
    const location = intent && intent.location ? intent.location : null;

    const hasDistance = distanceTarget !== null && distanceTarget !== undefined && Number.isFinite(Number(distanceTarget));
    const hasDurationMinutes = durationMinTarget !== null && durationMinTarget !== undefined && Number.isFinite(Number(durationMinTarget));
    const hasElevation = elevationTarget !== null && elevationTarget !== undefined && Number.isFinite(Number(elevationTarget));
    const hasCotation = cotationIndexTarget !== null && cotationIndexTarget !== undefined && Number.isFinite(Number(cotationIndexTarget));

    const targetDistanceKm = hasDistance ? Number(distanceTarget) : null;
    const targetDurationHours = hasDurationMinutes ? Number(durationMinTarget) / 60 : null;
    const targetElevationM = hasElevation ? Number(elevationTarget) : null;
    const targetCotationIndex = hasCotation ? Number(cotationIndexTarget) : null;

    const seasonFilter = filters.season || null;
    const typeFilter = normalizeActivityTypeValue(filters.type || null);
    const nameFilter = (filters.name || '').trim().toLowerCase();

    const hasLocation = !!(location && Number.isFinite(location.lat) && Number.isFinite(location.lon) && location.name);

    const candidates = activityCatalog.filter((activity) => {
        if (activity.dataType !== currentTab) return false;
        if (activity.status !== 'completed') return false;
        if (hasLocation) {
            if (!Number.isFinite(activity.summitLat) || !Number.isFinite(activity.summitLon)) return false;
        }
        if (seasonFilter && normalizeSeasonValue(activity.season) !== normalizeSeasonValue(seasonFilter)) return false;
        if (typeFilter && typeFilter !== 'all' && normalizeActivityTypeValue(activity.type) !== typeFilter) return false;
        if (nameFilter && !activity.name.toLowerCase().includes(nameFilter)) return false;
        return true;
    });

    // Compute reference_distance for location normalization (max distance among candidates).
    let referenceDistanceKm = null;
    if (hasLocation) {
        let max = 0;
        for (const activity of candidates) {
            const distKm = haversineDistanceKm(location.lat, location.lon, activity.summitLat, activity.summitLon);
            if (Number.isFinite(distKm)) max = Math.max(max, distKm);
        }
        referenceDistanceKm = max > 0 ? max : 0.0001; // avoid division by zero
    }

    const scored = candidates.map((activity) => {
        let score = 0;
        let distanceToLocationKm = null;
        if (hasLocation) {
            distanceToLocationKm = haversineDistanceKm(location.lat, location.lon, activity.summitLat, activity.summitLon);
        }

        if (hasDistance) {
            if (!Number.isFinite(activity.distanceKm)) return { activity, score: Number.POSITIVE_INFINITY };
            score += getRelativeDifference(activity.distanceKm, targetDistanceKm);
        }
        if (hasDurationMinutes) {
            if (!Number.isFinite(activity.durationHours)) return { activity, score: Number.POSITIVE_INFINITY };
            score += getRelativeDifference(activity.durationHours, targetDurationHours);
        }
        if (hasElevation) {
            if (!Number.isFinite(activity.elevationM)) return { activity, score: Number.POSITIVE_INFINITY };
            score += getRelativeDifference(activity.elevationM, targetElevationM);
        }

        if (hasCotation) {
            if (!Number.isFinite(activity.cotationIndex)) return { activity, score: Number.POSITIVE_INFINITY };
            const diff = Math.abs(activity.cotationIndex - targetCotationIndex);
            // Normalize "distance" on discrete T1..T6 to 0..1.
            score += diff / 5;
        }

        if (hasLocation) {
            if (!Number.isFinite(distanceToLocationKm)) return { activity, score: Number.POSITIVE_INFINITY };
            score += 3 * (distanceToLocationKm / referenceDistanceKm);
        }
        return { activity, score, distanceToLocationKm };
    });

    return scored
        .filter((entry) => Number.isFinite(entry.score))
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((entry) => {
            if (!hasLocation) return entry.activity;
            return {
                ...entry.activity,
                distanceToLocationKm: entry.distanceToLocationKm
            };
        });
}

function buildRecommendationReply(matches, locationName = null) {
    const count = matches.length;
    if (count === 0) {
        return "Je n'ai pas trouvé d'aventure accomplie qui corresponde à ta demande.";
    }
    let intro = '';
    if (locationName) {
        intro = count === 1
            ? `J'ai trouvé 1 aventure près de ${locationName} qui pourrait te convenir :`
            : `J'ai trouvé ${count} aventures près de ${locationName} qui pourraient te convenir :`;
    } else {
        intro = count === 1
            ? "J'ai trouvé 1 aventure qui pourrait te convenir :"
            : `J'ai trouvé ${count} aventures qui pourraient te convenir :`;
    }

    const lines = matches.map((activity) => {
        const base = `${activity.name} : ${formatDistanceForChat(activity.distanceKm)}km, ${activity.durationLabel || formatHoursForChat(activity.durationHours)}, ${formatElevationForChat(activity.elevationM)}m D+`;
        if (!locationName) return base;
        if (!Number.isFinite(activity.distanceToLocationKm)) return base;
        return `${base}, à ${formatDistanceForChat(activity.distanceToLocationKm)}km de ${locationName}`;
    });
    return `${intro}\n\n${lines.join('\n')}`;
}

function addChatMessage(messagesEl, text, role) {
    const bubble = document.createElement('div');
    bubble.className = `skadi-message ${role === 'user' ? 'skadi-user' : 'skadi-bot'}`;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function initSkadiChatbot() {
    const toggleBtn = document.getElementById('skadi-chat-toggle');
    const panel = document.getElementById('skadi-chat-panel');
    const form = document.getElementById('skadi-chat-form');
    const input = document.getElementById('skadi-chat-input');
    const sendBtn = document.getElementById('skadi-chat-send');
    const messagesEl = document.getElementById('skadi-chat-messages');
    if (!toggleBtn || !panel || !form || !input || !sendBtn || !messagesEl) return;

    // Session-scoped state for the "contact Charles" flow.
    let skadiWaitingForContactName = false;
    let skadiLastMode2Request = null;
    let skadiLastMode2Reply = null;
    let skadiLastMode2LocationName = null;

    toggleBtn.addEventListener('click', function() {
        const isHidden = panel.classList.contains('hidden');
        if (isHidden) {
            panel.classList.remove('hidden');
            panel.setAttribute('aria-hidden', 'false');
            toggleBtn.setAttribute('aria-expanded', 'true');
            if (!skadiHelpShown) {
                addChatMessage(messagesEl, SKADI_HELP_MESSAGE, 'bot');
                skadiHelpShown = true;
            }
            input.focus();
        } else {
            panel.classList.add('hidden');
            panel.setAttribute('aria-hidden', 'true');
            toggleBtn.setAttribute('aria-expanded', 'false');
            skadiWaitingForContactName = false;
            skadiLastMode2Request = null;
            skadiLastMode2Reply = null;
            skadiLastMode2LocationName = null;
        }
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        const userText = input.value.trim();
        if (!userText) return;
        addChatMessage(messagesEl, userText, 'user');
        input.value = '';
        sendBtn.disabled = true;
        input.disabled = true;

        try {
            // Waiting state: the next user message is treated as their name.
            if (skadiWaitingForContactName) {
                const contactName = userText.trim();
                skadiWaitingForContactName = false;

                const now = new Date();
                const yyyy = now.getFullYear();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const todayStr = `${yyyy}-${mm}-${dd}`;

                const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLScbR7X3_zDe-gV0eqxHzgWu1kEqVbvuSdgu2iLO1JiiUg26jg/formResponse';
                const params = new URLSearchParams();
                params.append('entry.1137624776', contactName);
                const originalRequestForForm = `${skadiLastMode2Request || ''}${skadiLastMode2LocationName ? ` (lieu: ${skadiLastMode2LocationName})` : ''}`.trim();
                params.append('entry.869668511', originalRequestForForm);
                params.append('entry.2101176791', skadiLastMode2Reply || '');
                params.append('entry.2066843226', todayStr);

                // no-cors: we can't read the response, but we assume success and always show confirmation.
                void fetch(formUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: params.toString()
                }).catch(() => {});

                addChatMessage(messagesEl, "Parfait ! Charles reviendra vers toi dès que possible 😊", 'bot');
                return;
            }

            const isHelpRequest = /\baide\b/i.test(userText.trim());
            if (isHelpRequest) {
                addChatMessage(messagesEl, SKADI_HELP_MESSAGE, 'bot');
                return;
            }

            const isResetRequest = /\b(reset|tous|toute|toutes)\b/i.test(userText.trim());
            if (isResetRequest) {
                resetMapForChatQuery();
                addChatMessage(messagesEl, "Je t'affiche toutes les activités.", 'bot');
                return;
            }

            // Contact flow trigger: "charles" after at least one Mode 2 recommendation.
            const isCharlesTrigger = /\bcharles\b/i.test(userText);
            if (isCharlesTrigger) {
                if (!skadiLastMode2Request || !skadiLastMode2Reply) {
                    addChatMessage(messagesEl, "Fais-moi d'abord une recherche et je pourrai transmettre mes suggestions à Charles !", 'bot');
                    return;
                }

                addChatMessage(messagesEl, "Quel est ton petit nom ?", 'bot');
                skadiWaitingForContactName = true;
                return;
            }

            resetMapForChatQuery();
            const mode = detectSkadiMode(userText);

            if (mode === 'recommendation') {
                // Reset contact-flow memory whenever a new Mode 2 recommendation is made.
                skadiWaitingForContactName = false;
                skadiLastMode2Request = null;
                skadiLastMode2Reply = null;
                skadiLastMode2LocationName = null;

                const placeName = extractLocationFromMessage(userText);
                let location = null;
                if (placeName) {
                    const coords = await geocodePlaceName(placeName);
                    if (!coords) {
                        addChatMessage(messagesEl, "Je n'ai pas trouvé l'endroit que tu m'as indiqué. Tu peux reformuler ou essayer un nom de lieu plus précis.", 'bot');
                        return;
                    }
                    location = { ...coords, name: placeName };
                }

                const targets = extractRecommendationTargets(userText);
                const hasAtLeastOneTarget =
                    Number.isFinite(targets.distanceKm) ||
                    Number.isFinite(targets.durationHours) ||
                    Number.isFinite(targets.elevationM) ||
                    Number.isFinite(targets.cotationIndex) ||
                    !!location;

                if (!hasAtLeastOneTarget) {
                    addChatMessage(messagesEl, "Je n'ai pas réussi à extraire une distance, une durée, un dénivelé, une cotation ou un lieu. Tu peux préciser avec un exemple (ex: 15km, 3 heures, 1000m, T3, près de Lausanne).", 'bot');
                    return;
                }
                const parsed = parseFilterIntent(userText);
                const matches = getRecommendationMatches({
                    filters: {
                        season: parsed.season !== 'all' ? parsed.season : null,
                        type: parsed.activityType !== 'all' ? parsed.activityType : null,
                        name: null
                    },
                    targets: {
                        distance_km: targets.distanceKm,
                        duration_min: Number.isFinite(targets.durationHours) ? targets.durationHours * 60 : null,
                        elevation_m: targets.elevationM,
                        cotation_index: targets.cotationIndex
                    },
                    location
                });
                const selection = new Set(matches.map((item) => item.key));
                applyRecommendationVisibility(selection);
                // Store for the "contact Charles" flow.
                const recommendationReplyText = buildRecommendationReply(matches, location ? location.name : null);
                skadiLastMode2Request = userText;
                skadiLastMode2Reply = recommendationReplyText;
                skadiLastMode2LocationName = location ? location.name : null;
                skadiWaitingForContactName = false;

                addChatMessage(messagesEl, recommendationReplyText, 'bot');
            } else {
                const parsed = parseFilterIntent(userText);
                applyFilters({
                    status: parsed.status,
                    season: parsed.season,
                    activityType: parsed.activityType,
                    name: parsed.name
                });
                const count = getVisibleActivityCount();
                addChatMessage(messagesEl, buildFilterConfirmation(parsed, count), 'bot');
            }
        } catch (error) {
            console.error('Skadi chatbot error:', error);
            addChatMessage(messagesEl, "Je n'ai pas pu traiter ta demande pour le moment. Réessaie avec une formulation plus simple.", 'bot');
        } finally {
            sendBtn.disabled = false;
            input.disabled = false;
            input.focus();
        }
    });
}

// PhotoSwipe 5 lightbox for popup photos (initialized after DOM ready; popup is in DOM when user clicks photo button)
let photoSwipeLightbox = null;
const PHOTOSWIPE_DEFAULT_WIDTH = 2048;
const PHOTOSWIPE_DEFAULT_HEIGHT = 1536;

function loadPhotoItemWithDimensions(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = function() {
            resolve({
                src: url,
                width: img.naturalWidth || PHOTOSWIPE_DEFAULT_WIDTH,
                height: img.naturalHeight || PHOTOSWIPE_DEFAULT_HEIGHT
            });
        };
        img.onerror = function() {
            console.warn('Photo load failed, using fallback dimensions:', url);
            resolve({
                src: url,
                width: PHOTOSWIPE_DEFAULT_WIDTH,
                height: PHOTOSWIPE_DEFAULT_HEIGHT
            });
        };
        img.src = url;
    });
}

function resolvePhotoItems(urls) {
    return Promise.all(urls.map(loadPhotoItemWithDimensions));
}

function initPhotoSwipeLightbox() {
    if (typeof PhotoSwipeLightbox === 'undefined' || typeof PhotoSwipe === 'undefined') return;
    if (photoSwipeLightbox) return;
    window._pswpPhotoItems = [];
    photoSwipeLightbox = new PhotoSwipeLightbox({
        pswpModule: PhotoSwipe,
        showHideAnimationType: 'none'
    });
    photoSwipeLightbox.addFilter('numItems', function() {
        return (window._pswpPhotoItems && window._pswpPhotoItems.length) || 0;
    });
    photoSwipeLightbox.addFilter('itemData', function(itemData, index) {
        return window._pswpPhotoItems[index];
    });
    photoSwipeLightbox.init();
}

// Use capture phase so we receive the click before Leaflet's popup stops propagation
document.body.addEventListener('click', function(e) {
    const btn = e.target.closest('.popup-photos-btn');
    if (!btn) return;
    const row = btn.closest('[data-photo-urls]');
    if (!row) return;
    const urlsAttr = row.getAttribute('data-photo-urls');
    if (!urlsAttr) return;
    const urls = urlsAttr.split('|').map(s => (s || '').trim()).filter(s => s && (s.startsWith('http://') || s.startsWith('https://')));
    if (urls.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    resolvePhotoItems(urls).then(function(photoItems) {
        // Wait for all dimensions to be resolved before initializing/opening PhotoSwipe.
        if (!photoSwipeLightbox) initPhotoSwipeLightbox();
        if (!photoSwipeLightbox) return;
        window._pswpPhotoItems = photoItems;
        photoSwipeLightbox.loadAndOpen(0);
    });
}, true);

// Journal button inside popup (summits + non-bike tracks with journal/ path)
document.body.addEventListener('click', function(e) {
    const btn = e.target.closest('.popup-journal-btn');
    if (!btn) return;
    const row = btn.closest('[data-journal-path]');
    if (!row) return;
    const journalPath = row.getAttribute('data-journal-path');
    if (!journalPath) return;
    const title = row.getAttribute('data-journal-title') || 'Récit';
    e.preventDefault();
    e.stopPropagation();
    openJournalPanel(title, journalPath);
}, true);

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initMap();

    // Set the default tab to summits
    currentTab = 'summits';
    document.querySelector('#tabs a[data-tab="summits"]').classList.add('active');

    // Show filters for the summit tab
    const filtersContainer = document.getElementById('filters-container');
    if (filtersContainer) filtersContainer.classList.remove('hidden');
    renderLegendContent();
    setLegendEnabled(true);
    initSkadiChatbot();
    const legendToggleBtn = document.getElementById('legend-toggle-btn');
    const legendPanel = document.getElementById('map-legend');
    const journalCloseBtn = document.getElementById('journal-close-btn');
    if (legendToggleBtn && legendPanel) {
        legendToggleBtn.addEventListener('click', function() {
            const isHidden = legendPanel.classList.contains('hidden');
            if (isHidden) {
                legendPanel.classList.remove('hidden');
                legendPanel.setAttribute('aria-hidden', 'false');
                legendToggleBtn.setAttribute('aria-expanded', 'true');
            } else {
                closeLegend();
            }
        });
    }
    if (journalCloseBtn) {
        journalCloseBtn.addEventListener('click', function() {
            closeJournalPanel();
        });
    }

    // Set the default map view for summits
    map.setView([46.2, 7.5], 8);

    loadData();
});