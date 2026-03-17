// Global variables
let map;
let markers = [];
let tracks = [];
let loadedGeoJSONFiles = {};
let gpxNames = [];
let gpxNameSet = new Set();
let gpxNameToMarker = {};
let currentTab = 'summits';

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

// Function to format duration, handling both hours and days
function formatDuration(duration) {
    if (typeof duration === 'string' && duration.includes('day')) {
        return duration;
    }

    const decimalHours = parseFloat(duration);
    if (isNaN(decimalHours)) {
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
    const header = 'Status,Name,Altitude [m],Summit Latitude,Summit Longitude,Season,Type,Grade,Distance [km],Duration [h],Elevation Gain [m],GPX File,Project,Activity URL,Photo URLs';
    let lastActivity = null;
    let lastSummit = null;
    const outRows = [];

    for (let i = 0; i < dataLines.length; i++) {
        let row = parseCsvLine(dataLines[i]);
        if (row.length < 19) row = row.concat(Array(19 - row.length).fill(''));
        const cToO = row.slice(2, 16);
        let photoUrls = (row[18] || '').trim();  // column S
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
            const [, lastSeason, lastType, lastGrade, lastDistance, lastDuration, lastElevationGain, , lastActivityUrl, lastPhotoUrls] = lastActivity;
            if (!seasonStripped) { season = lastSeason; seasonStripped = season; }
            if (!(type_ || '').trim()) type_ = lastType;
            if (!(grade || '').trim()) grade = lastGrade;
            if (!(distance || '').trim()) distance = lastDistance;
            if (!(duration || '').trim()) duration = lastDuration;
            if (!(elevationGain || '').trim()) elevationGain = lastElevationGain;
            if (!(activityUrl || '').trim()) activityUrl = lastActivityUrl;
            if (!photoUrls) photoUrls = lastPhotoUrls || '';
        }

        if (gpxFileStripped && !isToDo) {
            lastActivity = [gpxFileStripped, (season || '').trim(), (type_ || '').trim(), (grade || '').trim(), (distance || '').trim(), (duration || '').trim(), (elevationGain || '').trim(), (project || '').trim(), (activityUrl || '').trim(), photoUrls];
        }

        altitude = normalizeDecimal(altitude);
        summitLat = normalizeDecimal(summitLat);
        summitLon = normalizeDecimal(summitLon);
        distance = normalizeDecimal(distance);
        duration = normalizeDecimal(duration);
        elevationGain = normalizeDecimal(elevationGain);

        let outSeason, outType, outGrade, outDistance, outDuration, outElevationGain, outGpxFile, outActivityUrl, outPhotoUrls;
        if (isToDo) {
            outSeason = outType = outGrade = outDistance = outDuration = outElevationGain = outGpxFile = outActivityUrl = outPhotoUrls = '';
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
        }

        const escapeCsv = (v) => (v == null ? '' : String(v).includes(',') ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
        outRows.push([(status || '').trim(), nameStripped, altitude, summitLat, summitLon, outSeason, outType, outGrade, outDistance, outDuration, outElevationGain, outGpxFile, projectStripped || 'No Project', outActivityUrl, outPhotoUrls].map(escapeCsv).join(','));
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
function buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType, activityUrl, photoUrlsColumnS) {
    const photoUrls = parsePhotoUrlsFromColumnS(photoUrlsColumnS);
    const hasPhotos = photoUrls.length > 0;
    const photoBlock = hasPhotos
        ? (() => { const escaped = photoUrls.map(u => u.replace(/"/g, '&quot;')).join('|'); return ` <span class="popup-photos-row" data-photo-urls="${escaped}"><button type="button" class="popup-photos-btn" aria-label="Voir les photos">📸</button></span>`; })()
        : '';
    let html = `<b>${gpxName}</b>${photoBlock}<br><b>Saison :</b> ${season}`;
    if (dataType !== 'bike') html += `<br><b>Type :</b> ${type}`;
    if (grade) html += `<br><b>Cotation :</b> ${grade}`;
    if (distance) html += `<br><b>Distance :</b> ${distance} km`;
    if (duration) html += `<br><b>Durée :</b> ${duration}`;
    if (elevationGain) html += `<br><b>Dénivelé :</b> ${elevationGain} m`;
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
        { key: 'Trail running', label: 'Trail running' },
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
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName, dataType, activityUrl, photoUrlsColumnS) {
    const dataPath = dataType === 'bike' ? 'data/bike/processed/' : 'data/processed/';
    const gpxBaseName = normalizeGpxBaseName(gpxFile);
    if (!gpxBaseName) return;

    if (loadedGeoJSONFiles[dataType + gpxBaseName]) {
        return; // Skip if the file has already been loaded
    }

    const popupContent = buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType, activityUrl, photoUrlsColumnS || '');

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
                    layer.bindPopup(popupContent);
                    layer.on('click', function() {
                        track.bringToFront();
                        layer.setStyle({ weight: 6 });
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
                    layer.bindPopup(popupContent);
                    layer.on('click', function() {
                        track.bringToFront();
                        track.eachLayer(function(trackLayer) {
                            trackLayer.setStyle({ weight: 6 });
                        });
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

    // Summits: fetch published sheet and apply same processing as export_sheet_to_csv.py in the browser. Bike: published sheet as-is.
    const csvPath = getCsvPath();
    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            if (currentTab === 'summits') csvText = processSheetToSummitsRows(csvText);
            const rows = csvText.split(/\r?\n/).slice(1);
            const summitKeys = new Set();
            const summitStateByKey = new Map();
            // When multiple summits share one activity, CSV export leaves activity columns empty for merged rows. Carry them over.
            let lastActivity = null;

            rows.forEach(row => {
                if (!row.trim()) return;

                const columns = parseCsvLine(row);
                const isBikeTab = currentTab === 'bike';
                const isSummitsTab = currentTab === 'summits';
                // Summits rows are generated by processSheetToSummitsRows with a fixed schema.
                const hasStatusCol = isSummitsTab ? true : columns.length >= 13;
                const minColumns = isSummitsTab ? 15 : 12;

                if (columns.length < minColumns) {
                    console.warn('Skipping malformed CSV row (not enough columns):', row);
                    return;
                }

                const statusCol = hasStatusCol ? (columns[0] || '').trim() : '';
                const statusColLower = statusCol.toLowerCase();
                const isToDoStatus = hasStatusCol && statusColLower === 'to do';
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
                        photoUrls
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
                    if (hasStatusCol && statusColLower === 'to do') {
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
                            dataType: currentTab
                        };
                        markers.push(markerState);

                        if (gpxName) {
                            gpxNameToMarker[gpxName] = marker;
                        }

                        summitKeys.add(summitKey);
                        summitStateByKey.set(summitKey, markerState);
                    } else {
                        const existing = summitStateByKey.get(summitKey);
                        if (existing) {
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
                        photoUrls
                    );
                }

            });
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
    const searchTerm = searchInput.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    const clearSearchButton = document.getElementById('clear-search');

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

document.getElementById('search').addEventListener('input', debounce(runSearch, 150));

// Clear search input
document.getElementById('clear-search').addEventListener('click', function() {
    document.getElementById('search').value = '';
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search').focus();
    document.getElementById('clear-search').style.display = 'none';
});

// Handle Enter key in search
document.getElementById('search').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const searchTerm = e.target.value;
        focusOnGPXName(searchTerm);
        document.getElementById('search-results').style.display = 'none';
    }
});

// Function to apply filters
function applyFilters() {
    const activityType = document.getElementById('activity-type').value;
    const status = document.getElementById('status').value;
    const season = document.getElementById('season').value;

    markers.forEach(marker => {
        if (marker.dataType !== currentTab) return;

        const typeMatch = activityType === 'all' || marker.type === activityType;
        const statusMatch = status === 'all' || marker.status === status;
        const seasonMatch = season === 'all' || marker.season === season;

        if (typeMatch && statusMatch && seasonMatch) {
            map.addLayer(marker.layer);
        } else {
            map.removeLayer(marker.layer);
        }
    });

    tracks.forEach(track => {
        if (track.dataType !== currentTab) return;

        const typeMatch = activityType === 'all' || track.type === activityType;
        const statusMatch = status === 'all' || track.status === status;
        const seasonMatch = season === 'all' || track.season === season;

        if (typeMatch && statusMatch && seasonMatch) {
            map.addLayer(track.layer);
            map.addLayer(track.invisibleLayer);
        } else {
            map.removeLayer(track.layer);
            map.removeLayer(track.invisibleLayer);
        }
    });
}

// Add event listener for the apply filters button
document.getElementById('apply-filters').addEventListener('click', applyFilters);

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

        // Show/hide filters based on the tab
        const filtersContainer = document.getElementById('filters-container');
        if (currentTab === 'bike') {
            filtersContainer.classList.add('hidden');
            setLegendEnabled(false);
        } else {
            filtersContainer.classList.remove('hidden');
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

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initMap();

    // Set the default tab to summits
    currentTab = 'summits';
    document.querySelector('#tabs a[data-tab="summits"]').classList.add('active');

    // Show filters for the summit tab
    document.getElementById('filters-container').classList.remove('hidden');
    renderLegendContent();
    setLegendEnabled(true);
    const legendToggleBtn = document.getElementById('legend-toggle-btn');
    const legendPanel = document.getElementById('map-legend');
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

    // Set the default map view for summits
    map.setView([46.2, 7.5], 8);

    loadData();
});