// Global variables
let map;
let markers = [];
let tracks = [];
// Cache parsed GeoJSON so we don't download the same file multiple times,
// but we still create a dedicated Mapbox source/layer per CSV row.
let geojsonDataPromiseCache = {};
// Track additions must happen after the Mapbox style is loaded.
let pendingTrackAdds = [];
let mapLoaded = false;
let gpxNames = [];
let gpxNameSet = new Set();
let gpxNameToMarker = {};
let currentTab = 'summits';
let activityCatalog = [];
/** @type {Record<string, string[]>} Keyed by sheet Name column (column D); bold keywords from journal (column T), lowercase. */
let keywordCache = {};
let keywordCacheBuilt = false;
let activeRecommendationKeys = null;
let latestFilterState = {
    activityType: 'all',
    status: 'all',
    season: 'all',
    name: ''
};
let journalPanelOpen = false;
let journalLayoutResizeBound = false;
/** Bike rows with journal/ path only, CSV order — used for immersive navigation. */
let bikeEtapesRegistry = [];
let bikeJournalOpen = false;
let bikeJournalCurrentGpxName = null;

// Chatbot "Mode 2" (recommendation) view: enable true 3D (terrain + building extrusions),
// while keeping normal 2D for Mode 1/filter and for other UI states.
let skadiChat3DEnabled = false;
let skadiChat3DSavedPitch = null;
let skadiChat3DSavedBearing = null;
const SKADI_CHAT_2D_PITCH = 0;
const SKADI_CHAT_3D_PITCH = 20;
const SKADI_CHAT_3D_BEARING = 0;
const SKADI_CHAT_3D_PITCH_MIN = 0;
const SKADI_CHAT_3D_PITCH_MAX = 70;

const SKADI_CHAT_3D_TERRAIN_SOURCE_ID = 'skadi-chat-3d-terrain-dem';
const SKADI_CHAT_3D_TERRAIN_SOURCE_URL = 'mapbox://mapbox.mapbox-terrain-dem-v1';
const SKADI_CHAT_3D_TERRAIN_EXAGGERATION = 1.3;

const SKADI_CHAT_3D_SKY_LAYER_ID = 'skadi-chat-3d-sky';
const SKADI_CHAT_3D_BUILDINGS_LAYER_ID = 'skadi-chat-3d-buildings';

let skadiChat3DClampGuard = false;
let skadiChat3DMoveListener = null;

/** Monotonic id for Mapbox GL source/layer ids (must stay valid in style JSON). */
let skadiLayerSerial = 0;

/** Summit triangles: z-index base; weight added so earlier CSV rows stay on top (matches Mapbox vector + Leaflet overlap). */
const SKADI_SUMMIT_MARKER_Z_BASE = 420;

const MAPBOX_ACCESS_TOKEN = 'YOUR_MAPBOX_TOKEN_HERE';

/** Minimal raster style for local dev (no Mapbox vector tiles). */
const SKADI_OSM_RASTER_STYLE = {
    version: 8,
    sources: {
        osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }]
};

function isLocalDevHost() {
    const host = (window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

/** Position journal panel below the main header; match map height to remaining viewport (header + tabs). */
function applyJournalPanelLayout() {
    const header = document.querySelector('header');
    const tabs = document.querySelector('#tabs');
    const panel = document.getElementById('journal-panel');
    const mapEl = document.getElementById('map');
    if (!header || !panel) return;

    const headerH = header.offsetHeight;
    const tabsH = tabs ? tabs.offsetHeight : 0;
    const panelTop = headerH;
    const panelH = Math.max(0, window.innerHeight - headerH);

    panel.style.top = `${panelTop}px`;
    panel.style.height = `${panelH}px`;
    document.body.style.setProperty('--skadi-header-offset', `${headerH}px`);

    if (mapEl) {
        const mapH = Math.max(0, window.innerHeight - headerH - tabsH);
        const isMobile = window.matchMedia('(max-width: 767px)').matches;
        if (!isMobile) {
            mapEl.style.height = `${mapH}px`;
        } else {
            mapEl.style.height = '';
            mapEl.style.minHeight = '';
        }
    }
}

function clearJournalPanelLayout() {
    const panel = document.getElementById('journal-panel');
    const mapEl = document.getElementById('map');
    if (panel) {
        panel.style.top = '';
        panel.style.height = '';
    }
    if (mapEl) {
        mapEl.style.height = '';
        mapEl.style.minHeight = '';
    }
    document.body.style.removeProperty('--skadi-header-offset');
}

function bindJournalLayoutResize() {
    if (journalLayoutResizeBound) return;
    journalLayoutResizeBound = true;
    window.addEventListener('resize', function() {
        if (document.body.classList.contains('journal-open')) {
            applyJournalPanelLayout();
            if (map) map.invalidateSize();
        }
        if (document.body.classList.contains('bike-journal-open') && map) {
            map.invalidateSize();
        }
    });
}

/** Resolve paths like journal/foo.md against the site root (current page URL), not the script URL. */
function resolveJournalFetchUrl(journalRelativePath) {
    const path = String(journalRelativePath || '').trim().replace(/^\/+/, '');
    if (!path) return '';
    return new URL(path, window.location.href).href;
}

/**
 * Journal Markdown: configure marked once (raw HTML blocks pass through; GFM on).
 * DOMPurify is not used here so inline styles, floats, and <img src="..."> survive.
 * If you add DOMPurify later, allow at least: ADD_ATTR: ['style'], and img[src] (see DOMPurify docs).
 */
let journalMarkedInitialized = false;

function ensureJournalMarkedConfigured() {
    if (journalMarkedInitialized) return;
    const M = typeof marked !== 'undefined' ? marked : (typeof window !== 'undefined' ? window.marked : undefined);
    if (!M || typeof M.use !== 'function') {
        journalMarkedInitialized = true;
        return;
    }
    try {
        if (typeof M.Renderer === 'function') {
            M.use({
                renderer: new M.Renderer(),
                pedantic: false,
                gfm: true,
                breaks: false
            });
        }
    } catch (_e) {
        /* older marked — parse() may still work with defaults */
    }
    journalMarkedInitialized = true;
}

/** Render Markdown to HTML using marked.js (UMD exposes various shapes across versions). */
function renderMarkdownToHtml(md) {
    ensureJournalMarkedConfigured();
    const M = typeof marked !== 'undefined' ? marked : (typeof window !== 'undefined' ? window.marked : undefined);
    if (!M) return null;
    const text = String(md || '');
    try {
        if (typeof M.parse === 'function') {
            const out = M.parse(text, { async: false });
            if (out && typeof out.then === 'function') {
                return out;
            }
            return typeof out === 'string' ? out : String(out);
        }
        if (typeof M === 'function') {
            const out = M(text);
            return typeof out === 'string' ? out : String(out);
        }
    } catch (_e) {
        return null;
    }
    return null;
}

function openJournalPanel(activityName, journalPath) {
    const panel = document.getElementById('journal-panel');
    const titleEl = document.getElementById('journal-title');
    const contentEl = document.getElementById('journal-content');
    if (!panel || !titleEl || !contentEl) return;

    const title = String(activityName || '').trim() || 'Récit';
    titleEl.textContent = title;
    contentEl.innerHTML = 'Chargement du récit...';

    document.body.classList.add('journal-open');
    journalPanelOpen = true;
    bindJournalLayoutResize();
    applyJournalPanelLayout();

    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');

    // Give CSS transition time, then resize the map canvas.
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 320);

    const safePath = String(journalPath || '').trim();
    if (!safePath || !/^journal\//i.test(safePath)) {
        contentEl.textContent = "Le récit de cette activité n'est pas encore disponible.";
        return;
    }

    const fetchUrl = resolveJournalFetchUrl(safePath);
    fetch(fetchUrl)
        .then((res) => {
            if (!res.ok) throw new Error(`journal fetch failed: ${res.status}`);
            return res.text();
        })
        .then((md) => {
            const htmlOrPromise = renderMarkdownToHtml(md);
            if (htmlOrPromise == null) {
                contentEl.textContent = md;
                return;
            }
            if (typeof htmlOrPromise.then === 'function') {
                htmlOrPromise
                    .then((html) => {
                        contentEl.innerHTML = typeof html === 'string' ? html : String(html);
                    })
                    .catch(() => {
                        contentEl.textContent = md;
                    });
                return;
            }
            contentEl.innerHTML = htmlOrPromise;
        })
        .catch((_err) => {
            contentEl.textContent = "Le récit de cette activité n'est pas encore disponible.";
        });
}

function closeJournalPanel() {
    const panel = document.getElementById('journal-panel');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('journal-open');
    journalPanelOpen = false;
    clearJournalPanelLayout();
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 320);
}

function getCurrentBikeJournalChain() {
    const entry = bikeEtapesRegistry.find((e) => e.gpxName === bikeJournalCurrentGpxName);
    if (!entry) return [];
    return bikeEtapesRegistry.filter((e) => e.project === entry.project);
}

function buildBikeJournalStatsHtml(entry) {
    const bits = [];
    if ((entry.distance || '').trim()) {
        bits.push(`<span class="bike-stat"><span class="bike-stat-label">Distance</span> : ${escapeHtml(String(entry.distance).trim())} km</span>`);
    }
    if ((entry.duration || '').trim()) {
        bits.push(`<span class="bike-stat"><span class="bike-stat-label">Durée</span> : ${escapeHtml(formatDuration(entry.duration))}</span>`);
    }
    if ((entry.elevationGain || '').trim()) {
        bits.push(`<span class="bike-stat"><span class="bike-stat-label">Dénivelé</span> : ${escapeHtml(String(entry.elevationGain).trim())} m</span>`);
    }
    const url = (entry.activityUrl || '').trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        const linkText = getActivityLinkText(url) || 'Lien activité';
        bits.push(`<a class="bike-stat-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkText)}</a>`);
    }
    if (bits.length === 0) return '';
    return `<div class="bike-journal-stats-inner">${bits.join('')}</div>`;
}

function loadBikeJournalMarkdownInto(journalPath, contentEl) {
    const safePath = String(journalPath || '').trim();
    if (!safePath || !/^journal\//i.test(safePath)) {
        contentEl.textContent = "Le récit de cette étape n'est pas encore disponible.";
        return;
    }
    const fetchUrl = resolveJournalFetchUrl(safePath);
    contentEl.innerHTML = '<p>Chargement du récit...</p>';

    fetch(fetchUrl)
        .then((res) => {
            if (!res.ok) throw new Error(`journal fetch failed: ${res.status}`);
            return res.text();
        })
        .then((md) => {
            const htmlOrPromise = renderMarkdownToHtml(md);
            contentEl.innerHTML = '';
            if (htmlOrPromise == null) {
                contentEl.textContent = md;
                return;
            }
            if (typeof htmlOrPromise.then === 'function') {
                htmlOrPromise
                    .then((html) => {
                        contentEl.innerHTML = typeof html === 'string' ? html : String(html);
                    })
                    .catch(() => {
                        contentEl.textContent = md;
                    });
                return;
            }
            contentEl.innerHTML = htmlOrPromise;
        })
        .catch(() => {
            contentEl.innerHTML = '';
            contentEl.textContent = "Le récit de cette étape n'est pas encore disponible.";
        });
}

function updateBikeJournalNavButtons(chain, idx) {
    const prevBtn = document.getElementById('bike-journal-nav-prev');
    const nextBtn = document.getElementById('bike-journal-nav-next');
    if (!prevBtn || !nextBtn) return;
    prevBtn.classList.toggle('is-disabled', idx <= 0);
    const isLast = idx >= 0 && idx === chain.length - 1;
    nextBtn.classList.toggle('bike-journal-nav-last', isLast);
    nextBtn.setAttribute('aria-label', isLast ? 'Fermer le récit' : 'Étape suivante');
}

/** After map container height changes to 25vh; not tied to scroll. */
const BIKE_JOURNAL_MAP_RESIZE_MS = 300;

/**
 * Bike track line styles for immersive journal (unselected vs selected).
 * Visible layer uses project color; hit layer stays transparent with a wide stroke for clicks.
 */
const BIKE_TRACK_JOURNAL_STYLE = {
    visibleWeightUnselected: 3,
    visibleWeightSelected: 6,
    visibleOpacityUnselected: 1,
    visibleOpacitySelected: 1,
    hitWeight: 15,
    hitOpacityUnselected: 0,
    hitOpacitySelected: 0
};

function applyBikeTrackJournalStyle(track, selected) {
    if (!track || track.dataType !== 'bike' || !map) return;
    if (!track.lineLayerId || !map.getLayer(track.lineLayerId)) return;
    const wVis = selected
        ? BIKE_TRACK_JOURNAL_STYLE.visibleWeightSelected
        : BIKE_TRACK_JOURNAL_STYLE.visibleWeightUnselected;
    map.setPaintProperty(track.lineLayerId, 'line-width', wVis);
    if (map.getLayer(track.hitLayerId)) {
        map.setPaintProperty(track.hitLayerId, 'line-width', BIKE_TRACK_JOURNAL_STYLE.hitWeight);
    }
}

/** Reset all bike tracks, then highlight every track matching gpxName (same file can appear as multiple layer groups). */
function setBikeJournalActiveTrackByGpxName(gpxName) {
    deselectAllBikeTracks();
    if (!gpxName) return;
    tracks.forEach((track) => {
        if (track.dataType !== 'bike' || track.gpxName !== gpxName) return;
        applyBikeTrackJournalStyle(track, true);
        try {
            track.adapter.bringToFront();
        } catch (e) {
            /* ignore */
        }
    });
}

function fitBikeJournalMapToActiveTrack(gpxName) {
    if (!map || !gpxName) return;
    const track = tracks.find((t) => t.dataType === 'bike' && t.gpxName === gpxName);
    if (!track) return;
    map.invalidateSize();
    setTimeout(() => {
        map.invalidateSize();
        const bounds = track.bounds;
        if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    }, BIKE_JOURNAL_MAP_RESIZE_MS);
}

function openBikeImmersiveJournal(entry) {
    const panel = document.getElementById('bike-journal-immersive');
    const titleEl = document.getElementById('bike-journal-title');
    const bodyEl = document.getElementById('bike-journal-body');
    const statsEl = document.getElementById('bike-journal-stats');
    if (!panel || !titleEl || !bodyEl || !statsEl || !entry) return;

    bikeJournalCurrentGpxName = entry.gpxName;
    bikeJournalOpen = true;
    document.body.classList.add('bike-journal-open');

    titleEl.textContent = (entry.etapeName || entry.gpxName || '').trim() || 'Étape';
    statsEl.innerHTML = buildBikeJournalStatsHtml(entry);

    const chain = bikeEtapesRegistry.filter((e) => e.project === entry.project);
    const idx = chain.findIndex((e) => e.gpxName === entry.gpxName);
    updateBikeJournalNavButtons(chain, idx);

    loadBikeJournalMarkdownInto(entry.journalPath, bodyEl);

    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');

    window.scrollTo(0, 0);

    setBikeJournalActiveTrackByGpxName(entry.gpxName);

    fitBikeJournalMapToActiveTrack(entry.gpxName);
}

function deselectAllBikeTracks() {
    tracks.forEach((track) => {
        if (track.dataType !== 'bike') return;
        applyBikeTrackJournalStyle(track, false);
    });
    if (map) map.closePopup();
}

function closeBikeImmersiveJournal() {
    const panel = document.getElementById('bike-journal-immersive');
    if (panel) {
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('bike-journal-open');
    bikeJournalOpen = false;
    bikeJournalCurrentGpxName = null;
    deselectAllBikeTracks();
    setTimeout(() => {
        if (map) map.invalidateSize();
    }, BIKE_JOURNAL_MAP_RESIZE_MS);
}

function initBikeJournalControls() {
    const prevBtn = document.getElementById('bike-journal-nav-prev');
    const nextBtn = document.getElementById('bike-journal-nav-next');
    const closeBtn = document.getElementById('bike-journal-close');
    if (!prevBtn || !nextBtn || !closeBtn) return;

    prevBtn.addEventListener('click', function() {
        if (prevBtn.classList.contains('is-disabled')) return;
        const chain = getCurrentBikeJournalChain();
        const idx = chain.findIndex((e) => e.gpxName === bikeJournalCurrentGpxName);
        if (idx <= 0) return;
        openBikeImmersiveJournal(chain[idx - 1]);
    });

    nextBtn.addEventListener('click', function() {
        const chain = getCurrentBikeJournalChain();
        const idx = chain.findIndex((e) => e.gpxName === bikeJournalCurrentGpxName);
        if (idx < 0 || !chain.length) return;
        if (idx === chain.length - 1) {
            closeBikeImmersiveJournal();
            return;
        }
        openBikeImmersiveJournal(chain[idx + 1]);
    });

    closeBtn.addEventListener('click', function() {
        closeBikeImmersiveJournal();
    });
}

function getTriangleIconHtml(color, isCompleted) {
    const outlineWidth = '0.6';
    const trianglePath = 'M10 2 L2 18 L18 18 Z';
    const snowCapSvg = isCompleted
        ? '<path d="M10 2.35 L6.5 9 L13.5 9 Z" fill="white" opacity="0.95"/>'
        : '';
    return `
            <svg width="24" height="24" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="${trianglePath}" fill="${color}"/>
                ${snowCapSvg}
                <path d="${trianglePath}" fill="none" stroke="black" stroke-width="${outlineWidth}"/>
            </svg>
        `;
}

function computeBoundsFromGeoJSONFeatureCollection(data) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    function extendCoords(coords) {
        if (!coords || coords.length === 0) return;
        if (typeof coords[0] === 'number') {
            const lng = coords[0];
            const lat = coords[1];
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            return;
        }
        for (let i = 0; i < coords.length; i++) extendCoords(coords[i]);
    }
    const features = (data && data.features) || [];
    for (let f = 0; f < features.length; f++) {
        const g = features[f].geometry;
        if (!g) continue;
        if (g.type === 'LineString') extendCoords(g.coordinates);
        else if (g.type === 'MultiLineString') extendCoords(g.coordinates);
    }
    return {
        isValid() {
            return Number.isFinite(minLng) && minLng < maxLng && minLat < maxLat;
        },
        getSouthWest() {
            return { lng: minLng, lat: minLat };
        },
        getNorthEast() {
            return { lng: maxLng, lat: maxLat };
        }
    };
}

function patchSkadiMapboxMap(mbMap) {
    mbMap._skadiLinePopup = null;

    const nativeAddLayer = mbMap.addLayer.bind(mbMap);
    const nativeRemoveLayer = mbMap.removeLayer.bind(mbMap);

    mbMap.invalidateSize = function () {
        this.resize();
    };

    mbMap.setView = function (centerLatLng, z) {
        this.jumpTo({ center: [centerLatLng[1], centerLatLng[0]], zoom: z });
    };

    mbMap.closePopup = function () {
        if (this._skadiLinePopup) {
            this._skadiLinePopup.remove();
            this._skadiLinePopup = null;
        }
        if (typeof markers !== 'undefined' && Array.isArray(markers)) {
            markers.forEach((ms) => {
                if (ms.layer && ms.layer._mglMarker) {
                    const pop = ms.layer._mglMarker.getPopup();
                    if (pop && pop.isOpen()) pop.remove();
                }
            });
        }
    };

    const origFitBounds = mbMap.fitBounds.bind(mbMap);
    mbMap.fitBounds = function (boundsInput, options) {
        if (!boundsInput || typeof boundsInput.getSouthWest !== 'function') return;
        const paddingOpt = options && options.padding;
        let pad = 20;
        if (Array.isArray(paddingOpt)) pad = paddingOpt[0];
        else if (typeof paddingOpt === 'number') pad = paddingOpt;
        const sw = boundsInput.getSouthWest();
        const ne = boundsInput.getNorthEast();
        const bbox = new mapboxgl.LngLatBounds([sw.lng, sw.lat], [ne.lng, ne.lat]);
        origFitBounds(bbox, { padding: pad, duration: 0, animate: false });
    };

    mbMap.addLayer = function (arg) {
        if (arg && typeof arg._skadiAddTo === 'function') {
            arg._skadiAddTo(this);
            return;
        }
        nativeAddLayer(arg);
    };
    mbMap.removeLayer = function (arg) {
        if (arg && typeof arg._skadiRemoveFrom === 'function') {
            arg._skadiRemoveFrom(this);
            return;
        }
        nativeRemoveLayer(arg);
    };
    mbMap.hasLayer = function (arg) {
        if (arg && typeof arg._skadiAddTo === 'function') {
            return !!arg._skadiOnMap;
        }
        return !!this.getLayer(arg);
    };
}

function createSummitMapboxMarker(lat, lng, color, isCompleted, popupHtml) {
    const el = document.createElement('div');
    el.className = 'summit-icon';
    el.innerHTML = getTriangleIconHtml(color, isCompleted);
    const popup = new mapboxgl.Popup({
        closeButton: true,
        offset: 18,
        maxWidth: 'min(90vw, 420px)'
    }).setHTML(popupHtml);
    const m = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).setPopup(popup);

    return {
        _skadiOnMap: false,
        _mglMarker: m,
        _skadiAddTo(mbMap) {
            m.addTo(mbMap);
            const root = m.getElement();
            if (root && typeof this._skadiSummitZWeight === 'number') {
                root.style.zIndex = String(SKADI_SUMMIT_MARKER_Z_BASE + this._skadiSummitZWeight);
            }
            this._skadiOnMap = true;
        },
        _skadiRemoveFrom() {
            m.remove();
            this._skadiOnMap = false;
        },
        setIcon(divIconLike) {
            const html = divIconLike && divIconLike.html ? divIconLike.html : '';
            el.innerHTML = html;
        },
        setPopupContent(html) {
            m.getPopup().setHTML(html);
        }
    };
}

function buildSkadiTrackMapAdapter(track) {
    return {
        _skadiOnMap: false,
        bringToFront() {
            if (!map || !this._skadiOnMap) return;
            try {
                if (map.getLayer(track.hitLayerId)) map.moveLayer(track.hitLayerId);
                if (map.getLayer(track.lineLayerId)) map.moveLayer(track.lineLayerId);
            } catch (_e) {
                /* ignore */
            }
        },
        eachLayer(fn) {
            fn({
                setStyle: (s) => {
                    if (s && s.weight != null && map && map.getLayer(track.lineLayerId)) {
                        map.setPaintProperty(track.lineLayerId, 'line-width', s.weight);
                    }
                },
                getPopup: () => ({ isOpen: () => false }),
                openPopup: () => {}
            });
        },
        getBounds() {
            return track.bounds;
        },
        _skadiAddTo(mbMap) {
            if (this._skadiOnMap) return;
            if (!mbMap.getSource(track.sourceId)) {
                mbMap.addSource(track.sourceId, { type: 'geojson', data: track.geojsonData });
            }
            if (!mbMap.getLayer(track.lineLayerId)) {
                mbMap.addLayer({
                    id: track.lineLayerId,
                    type: 'line',
                    source: track.sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': track.lineColor || '#3388ff',
                        'line-width': 3,
                        'line-opacity': 1
                    }
                });
            }
            if (!mbMap.getLayer(track.hitLayerId)) {
                mbMap.addLayer({
                    id: track.hitLayerId,
                    type: 'line',
                    source: track.sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': '#000000',
                        'line-width': 15,
                        'line-opacity': 0.01
                    }
                });
            }
            mbMap.on('click', track.hitLayerId, track._onHitClick);
            this._skadiOnMap = true;
        },
        _skadiRemoveFrom(mbMap) {
            if (!this._skadiOnMap) return;
            mbMap.off('click', track.hitLayerId, track._onHitClick);
            if (mbMap.getLayer(track.hitLayerId)) mbMap.removeLayer(track.hitLayerId);
            if (mbMap.getLayer(track.lineLayerId)) mbMap.removeLayer(track.lineLayerId);
            if (mbMap.getSource(track.sourceId)) mbMap.removeSource(track.sourceId);
            this._skadiOnMap = false;
        }
    };
}

// Initialize map (Mapbox GL JS — vector outdoors on prod; OSM raster style on localhost)
function initMap() {
    if (typeof mapboxgl === 'undefined') {
        console.error('mapbox-gl failed to load');
        return;
    }
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN || '';
    const style = isLocalDevHost() ? SKADI_OSM_RASTER_STYLE : 'mapbox://styles/mapbox/outdoors-v12';
    map = new mapboxgl.Map({
        container: 'map',
        style,
        center: [7.5, 46.2],
        zoom: 8,
        renderWorldCopies: false,
        attributionControl: true
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    patchSkadiMapboxMap(map);

    // Ensure all addSource/addLayer calls happen after the Mapbox style fully loads.
    mapLoaded = false;
    pendingTrackAdds = [];
    map.once('load', function () {
        mapLoaded = true;
        const q = pendingTrackAdds.slice();
        pendingTrackAdds = [];
        q.forEach((fn) => {
            try {
                fn();
            } catch (e) {
                console.error('[Skadi] queued track addition failed:', e);
            }
        });
    });
}

// Leaflet-compatible shape: `{ html }` for legend + marker.setIcon
function createTriangleIcon(color, isCompleted) {
    return { html: getTriangleIconHtml(color, isCompleted) };
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
// The GPX cell must match the .geojson/.gpx basename on disk (same spelling, accents, spaces vs underscores).
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

/** Bike sheet: fixed 10 columns A–J (indices 0–9). See docs/BIKE_SHEET_SCHEMA.md. */
function getCsvPath() {
    return currentTab === 'bike'
        ? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRa2uc5r5sohJICr4Hb4TyQwlJxwtFCVk_NLqu_APJ6yF2FturE2YhbAhuaV_THn6AA0d9U_4BafJ9m/pub?gid=2069199560&single=true&output=csv'
        : SUMMITS_SHEET_CSV_URL;
}

/**
 * Bikepacking sheet — column letters and CSV indices (do not reorder; header row is row 1 only).
 * | Index | Col | Field            |
 * |-------|-----|------------------|
 * | 0     | A   | Name             |
 * | 1     | B   | Season           |
 * | 2     | C   | Distance [km]    |
 * | 3     | D   | Duration [h]     |
 * | 4     | E   | Elevation [m]    |
 * | 5     | F   | GPX File         |
 * | 6     | G   | Project          |
 * | 7     | H   | URL              |
 * | 8     | I   | photo            |
 * | 9     | J   | journal path     |
 */
const BIKE_COL = {
    name: 0,
    season: 1,
    distanceKm: 2,
    durationH: 3,
    elevationM: 4,
    gpxFile: 5,
    project: 6,
    url: 7,
    photo: 8,
    journalPath: 9
};

const BIKE_COLUMN_COUNT = 10;

/** Pad parsed CSV cells to A–J; published CSV may omit trailing empty cells. */
function padBikeColumns(columns) {
    const c = columns.slice();
    while (c.length < BIKE_COLUMN_COUNT) c.push('');
    return c;
}

/**
 * Read one bike data row from already-split cells (fixed layout). No header-based guessing.
 */
function readBikeSheetRow(cells) {
    const c = padBikeColumns(cells);
    return {
        name: (c[BIKE_COL.name] || '').trim(),
        season: (c[BIKE_COL.season] || '').trim(),
        distance: (c[BIKE_COL.distanceKm] || '').trim(),
        duration: (c[BIKE_COL.durationH] || '').trim(),
        elevationGain: (c[BIKE_COL.elevationM] || '').trim(),
        gpxFileCell: (c[BIKE_COL.gpxFile] || '').trim(),
        projectRaw: (c[BIKE_COL.project] || '').trim(),
        activityUrl: (c[BIKE_COL.url] || '').trim(),
        photoUrls: (c[BIKE_COL.photo] || '').trim(),
        journalEntry: (c[BIKE_COL.journalPath] || '').trim()
    };
}

// Parse one CSV line (handles quoted fields and "" escape). Returns array of strings.
function parseCsvLineWithDelimiter(line, delimiter) {
    const out = [];
    let field = '';
    let inQuotes = false;
    const delim = delimiter === ';' ? ';' : ',';

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delim && !inQuotes) {
            out.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    out.push(field);
    return out;
}

function parseCsvLine(line) {
    return parseCsvLineWithDelimiter(line, ',');
}

/** French / EU Sheets often publish CSV with ';' — comma-only parsing shifts columns (GPX can become "Bike", etc.). */
function detectCsvDelimiter(firstNonEmptyLine) {
    const line = String(firstNonEmptyLine || '');
    const semi = (line.match(/;/g) || []).length;
    const comma = (line.match(/,/g) || []).length;
    if (semi > 0 && semi >= comma) return ';';
    return ',';
}

/**
 * Pick ',' vs ';' for bike rows by minimizing deviation from 10 columns per row.
 * Header alone is unreliable (no decimals); data rows with "180,8" break comma-splitting and shift column F.
 */
function detectBikeCsvDelimiter(allLines) {
    if (!allLines || allLines.length < 2) return ',';
    const sampleRows = allLines.slice(1, Math.min(12, allLines.length)).filter((l) => l.trim());
    if (sampleRows.length === 0) return detectCsvDelimiter(allLines[0]);

    const deviationScore = (delim) =>
        sampleRows.reduce((acc, line) => {
            const n = parseCsvLineWithDelimiter(line, delim).length;
            return acc + Math.abs(n - BIKE_COLUMN_COUNT);
        }, 0);

    const sComma = deviationScore(',');
    const sSemi = deviationScore(';');
    if (sSemi < sComma) return ';';
    if (sComma < sSemi) return ',';
    return detectCsvDelimiter(allLines[0]);
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

/** Plaintext column T for popups: escape HTML, then turn **bold** into <strong> (same raw source as keyword extraction). */
function formatPlainJournalTextForPopupHtml(raw) {
    const escaped = escapeHtml(raw || '');
    return escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// Normalize column T (strip BOM, sheet formula prefix, invisible chars).
function normalizeJournalCell(value) {
    return String(value || '')
        .replace(/^\uFEFF/, '')
        .replace(/^=/, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
}

// Parse column T:
// - empty => none
// - starts with "journal/" => markdown path
// - otherwise => inline plain text for popup
function parseJournalEntry(value) {
    const raw = normalizeJournalCell(value);
    if (!raw) return { kind: 'none', value: '' };
    if (/^journal\//i.test(raw)) {
        const rest = raw.replace(/^journal\//i, '');
        return { kind: 'path', value: 'journal/' + rest.replace(/^\/+/, '') };
    }
    return { kind: 'text', value: raw };
}

function tokenizeBoldSegmentToKeywords(seg, set) {
    String(seg || '')
        .split(/\s+/)
        .forEach((w) => {
            const t = w.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
            if (t.length > 0) set.add(t);
        });
}

/** Extract bold phrases from Markdown/plain text; returns unique lowercase tokens. */
function extractBoldKeywordsFromText(text) {
    const set = new Set();
    if (!text) return [];
    const re1 = /\*\*(.*?)\*\*/g;
    const re2 = /__(.*?)__/g;
    let m;
    while ((m = re1.exec(text)) !== null) {
        tokenizeBoldSegmentToKeywords(m[1], set);
    }
    while ((m = re2.exec(text)) !== null) {
        tokenizeBoldSegmentToKeywords(m[1], set);
    }
    return [...set];
}

function buildKeywordCacheInBackground(rows) {
    const tasks = rows.map(({ columnDName, journalEntry }) => {
        const key = (columnDName || '').trim();
        const parsed = parseJournalEntry(journalEntry);
        if (!key) return Promise.resolve({ key: '', words: [] });
        if (parsed.kind === 'none') return Promise.resolve({ key, words: [] });
        if (parsed.kind === 'text') {
            const rawPlainJournal = parsed.value;
            return Promise.resolve({ key, words: extractBoldKeywordsFromText(rawPlainJournal) });
        }
        const url = resolveJournalFetchUrl(parsed.value);
        return fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then((md) => ({ key, words: extractBoldKeywordsFromText(md) }))
            .catch((err) => {
                console.warn('[Skadi] Journal keyword fetch failed:', url, err);
                return { key, words: [] };
            });
    });
    Promise.all(tasks).then((results) => {
        keywordCache = {};
        for (const { key, words } of results) {
            if (!key) continue;
            if (!keywordCache[key]) keywordCache[key] = [];
            const merged = new Set([...keywordCache[key], ...words]);
            keywordCache[key] = [...merged];
        }
        const n = Object.keys(keywordCache).length;
        console.log(`[Skadi] Keyword cache ready: ${n} activities indexed`);
    });
}

function scheduleKeywordCacheBuild(rows) {
    if (keywordCacheBuilt) return;
    keywordCacheBuilt = true;
    setTimeout(() => buildKeywordCacheInBackground(rows), 0);
}

const MODE2_KEYWORD_STOP_WORDS = new Set([
    'je', 'un', 'une', 'des', 'les', 'du', 'de', 'la', 'le', 'avec', 'pour', 'qui', 'sur', 'dans', 'mon', 'ma', 'mes',
    'veux', 'cherche', 'faire', 'autour', 'environ', 'à', 'et', 'ou', 'a'
]);

function extractUserKeywordsForMode2(message) {
    let s = (message || '').toLowerCase();
    const locationRegex = /(?:près de|côté de|depuis|au-dessus de|à côté de|vers|dans les|dans le|en partant de)\s+(.+?)(?=$|[.,;:!?]|\b(avec|et|pour|de)\b)/i;
    s = s.replace(locationRegex, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*(?:km|kilom[eè]tre(?:s)?)\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*(?:heure(?:s)?|h)\b/gi, ' ');
    s = s.replace(/\b\d+h\d{1,2}\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*(?:jour(?:s)?|j)\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*(?:minute(?:s)?)\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*m\s*(?:de\s*d[eé]nivel[eé]|d\+)\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*m\s*d\+\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\s*m\b/gi, ' ');
    s = s.replace(/\bt\s*[1-6]\b/gi, ' ');
    s = s.replace(/\b\d+(?:[.,]\d+)?\b/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    const tokens = s.split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
    const out = [];
    for (const t of tokens) {
        const norm = t.toLowerCase();
        if (MODE2_KEYWORD_STOP_WORDS.has(norm)) continue;
        if (norm.length <= 3) continue;
        out.push(norm);
    }
    return [...new Set(out)];
}

function extractResidualKeywordsForMode1(parsedName) {
    const tokens = (parsedName || '').toLowerCase().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) {
        const norm = t.replace(/[^\p{L}\p{N}_-]/gu, '');
        if (norm.length <= 3) continue;
        if (MODE2_KEYWORD_STOP_WORDS.has(norm)) continue;
        if (gpxNames.some((n) => n.toLowerCase().includes(norm))) continue;
        out.push(norm);
    }
    return [...new Set(out)];
}

function stripKeywordTokensFromName(parsedName, keywordTokens) {
    if (!keywordTokens || keywordTokens.length === 0) return (parsedName || '').trim();
    const kt = new Set(keywordTokens);
    const parts = (parsedName || '').trim().split(/\s+/).filter(Boolean);
    const kept = [];
    for (const p of parts) {
        const norm = p.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
        if (kt.has(norm)) continue;
        kept.push(p);
    }
    return kept.join(' ');
}

function activityMatchesUserKeywords(activity, userKeywords) {
    if (!userKeywords || userKeywords.length === 0) return true;
    const ck = (activity.columnDName || activity.name || '').trim();
    const words = keywordCache[ck] || [];
    if (!words.length) return false;
    for (const uk of userKeywords) {
        for (const w of words) {
            if (w === uk) return true;
        }
    }
    return false;
}

function markerHasKeywordMatch(marker, keywordTokens) {
    if (!keywordTokens || keywordTokens.length === 0) return true;
    if (!marker.activityKeys || marker.activityKeys.size === 0) return false;
    for (const key of marker.activityKeys) {
        const act = activityCatalog.find((a) => a.key === key);
        if (act && activityMatchesUserKeywords(act, keywordTokens)) return true;
    }
    return false;
}

function trackHasKeywordMatch(track, keywordTokens) {
    if (!keywordTokens || keywordTokens.length === 0) return true;
    const act = activityCatalog.find((a) => a.key === track.gpxName);
    return !!(act && activityMatchesUserKeywords(act, keywordTokens));
}

function isReservedMode1SingleWord(word) {
    const w = (word || '').toLowerCase();
    if (/^(été|ete|hiver|printemps|automne)$/.test(w)) return true;
    if (/^(randonnée|rando|randon|ski|trail|alpinisme|alpine|vélo|velo|bike)$/.test(w)) return true;
    if (/^(accompli|àfaire|afaire)$/.test(w)) return true;
    if (/^(reset|tous|toute|toutes|aide)$/.test(w)) return true;
    return false;
}

function activityNameMatchesSingleWordToken(word) {
    const w = (word || '').toLowerCase();
    return gpxNames.some((n) => n.toLowerCase().includes(w));
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
        ? `<p class="popup-journal-text">${formatPlainJournalTextForPopupHtml(journal.value)}</p>`
        : '';
    // Track popup header: [Title] [📷] [📖] [×] (all in one flex row).
    let html = `
        <div class="track-popup-header">
            <span class="track-popup-title"><b>${gpxName}</b></span>
            ${photoBlock}
            ${journalButtonBlock}
            <button type="button" class="track-popup-close" aria-label="Fermer la popup">×</button>
        </div>
        <div class="track-popup-body">
            <b>Saison :</b> ${season}`;
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
    html += `</div>`;
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
    const completedIconHtml = createTriangleIcon(defaultColor, true).html;
    const todoIconHtml = createTriangleIcon(defaultColor, false).html;
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

/**
 * Same visibility as applyFilters() for track layers (recommendations / keyword filters are separate).
 * Keeps loadGeoJSON in sync when filters UI or Skadi changes latestFilterState.
 */
function trackAttachMatchesLatestFilters(type, season, gpxName) {
    const st = latestFilterState;
    const nameFilterLower = (st.name || '').trim().toLowerCase();
    const typeMatch = st.activityType === 'all' || normalizeActivityTypeValue(type) === normalizeActivityTypeValue(st.activityType);
    const statusMatch = st.status === 'all' || 'completed' === st.status;
    const seasonMatch = st.season === 'all' || normalizeSeasonValue(season) === normalizeSeasonValue(st.season);
    const nameMatch = !nameFilterLower || (gpxName || '').toLowerCase().includes(nameFilterLower);
    return typeMatch && statusMatch && seasonMatch && nameMatch;
}

/** If the style is already loaded before 'load' is subscribed, rAF picks it up; avoids stuck attachTrack. */
function scheduleAttachTrackWhenStyleReady(attachTrack) {
    if (!map) {
        attachTrack();
        return;
    }
    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
        attachTrack();
        return;
    }
    let ran = false;
    const onceRun = () => {
        if (ran || !map || typeof map.isStyleLoaded !== 'function' || !map.isStyleLoaded()) return;
        ran = true;
        map.off('load', onceRun);
        attachTrack();
    };
    map.on('load', onceRun);
    requestAnimationFrame(onceRun);
}

/**
 * Summit markers: higher z-index for more southerly peaks (smaller latitude in the northern hemisphere),
 * so when chains run north→south on the map, each new summit draws above the one to the north.
 */
function applySummitMarkerPaintOrderWeights() {
    if (currentTab !== 'summits') return;
    const summitMarkers = markers.filter((m) => m.dataType === 'summits');
    const withPos = summitMarkers
        .map((markerState) => {
            const mgl = markerState.layer && markerState.layer._mglMarker;
            const ll = mgl && mgl.getLngLat();
            const lat = ll ? ll.lat : 0;
            const lng = ll ? ll.lng : 0;
            return { markerState, lat, lng };
        })
        .sort((a, b) => {
            if (a.lat !== b.lat) return a.lat - b.lat; // south (lower lat) first
            if (a.lng !== b.lng) return a.lng - b.lng;
            return String(a.markerState.name || '').localeCompare(String(b.markerState.name || ''));
        });
    const n = withPos.length;
    withPos.forEach((row, i) => {
        const w = n - 1 - i; // southernmost gets largest weight → on top
        const layer = row.markerState.layer;
        layer._skadiSummitZWeight = w;
        const root = layer._mglMarker && layer._mglMarker.getElement();
        if (root) root.style.zIndex = String(SKADI_SUMMIT_MARKER_Z_BASE + w);
    });
}

// Fetch GeoJSON with retries on transient CDN errors (common on GitHub Pages for large files).
function fetchGeoJsonWithRetry(url, maxAttempts) {
    const attempts = Math.max(1, maxAttempts || 3);
    const tryOnce = (attemptIndex) => {
        return fetch(url).then((response) => {
            const status = response.status;
            if (status === 502 || status === 503 || status === 504) {
                if (attemptIndex < attempts) {
                    return new Promise((resolve) => setTimeout(resolve, 400 * attemptIndex)).then(() => tryOnce(attemptIndex + 1));
                }
            }
            return response;
        });
    };
    return tryOnce(1);
}

// Function to load GeoJSON files dynamically
/** @param bikeImmersiveMeta {object|null} When set (bike + journal/ path), track opens immersive view on click instead of popup. */
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName, dataType, activityUrl, photoUrlsColumnS, journalColumnT, bikeImmersiveMeta, rowIndex) {
    const dataPath = dataType === 'bike' ? 'data/bike/processed/' : 'data/processed/';
    const gpxBaseName = normalizeGpxBaseName(gpxFile);
    if (!gpxBaseName) return;

    // Mapbox requires globally-unique ids for sources/layers.
    // Build deterministic ids from tab + rowIndex + geojson basename.
    const safePart = (v) =>
        String(v || '')
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    const safeDataType = safePart(dataType) || 'x';
    const safeRowIndex = safePart(rowIndex) || '0';
    const safeGpxBaseName = safePart(gpxBaseName) || 'x';

    const sourceId = `track-source-${safeDataType}-${safeRowIndex}-${safeGpxBaseName}`;
    const lineLayerId = `track-layer-${safeDataType}-${safeRowIndex}-${safeGpxBaseName}`;
    const hitLayerId = `track-hit-${safeDataType}-${safeRowIndex}-${safeGpxBaseName}`;

    const cacheKey = `${dataType}:${gpxBaseName}`;
    if (!geojsonDataPromiseCache[cacheKey]) {
        geojsonDataPromiseCache[cacheKey] = fetchGeoJsonWithRetry(`${dataPath}${gpxBaseName}.geojson`, 3)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load GeoJSON: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .catch((err) => {
                // If the fetch failed, allow future rows to retry.
                delete geojsonDataPromiseCache[cacheKey];
                throw err;
            });
    }

    const popupContent = buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType, activityUrl, photoUrlsColumnS || '', journalColumnT || '');
    const journalMeta = parseJournalEntry(journalColumnT);
    const opensBikeImmersive = !!(bikeImmersiveMeta && /^journal\//i.test(String(bikeImmersiveMeta.journalPath || '').trim()));
    // Apply wider minimum popup only when column T is plain text (summits / bike without immersive path).
    const popupOptions = journalMeta.kind === 'text'
        ? { className: 'journal-text-popup', minWidth: 520, maxWidth: 2000 }
        : undefined;

    geojsonDataPromiseCache[cacheKey]
        .then(data => {
            const attachTrack = () => {
            const bounds = computeBoundsFromGeoJSONFeatureCollection(data);
            const track = {
                sourceId,
                lineLayerId,
                hitLayerId,
                geojsonData: data,
                lineColor: color,
                bounds,
                type: type,
                status: 'completed',
                season: season,
                gpxName: gpxName,
                coordinates: data.features[0].geometry.coordinates,
                dataType: dataType,
                popupContent,
                popupOptions,
                opensBikeImmersive,
                _onHitClick: null
            };

            console.log(`[track] attempting: ${sourceId}`);
            track._onHitClick = function (e) {
                if (!map) return;
                map.closePopup();
                track.adapter.bringToFront();
                if (track.opensBikeImmersive) {
                    const entry = bikeEtapesRegistry.find((en) => en.gpxName === gpxName);
                    if (entry) openBikeImmersiveJournal(entry);
                    return;
                }
                if (map.getLayer(track.lineLayerId)) {
                    map.setPaintProperty(track.lineLayerId, 'line-width', 6);
                }
                const maxW =
                    track.popupOptions && track.popupOptions.maxWidth != null
                        ? `${track.popupOptions.maxWidth}px`
                        : '450px';
                const p = new mapboxgl.Popup({
                    closeButton: false,
                    offset: 12,
                    maxWidth: maxW,
                    className: (function() {
                        const cls = (track.popupOptions && track.popupOptions.className) ? track.popupOptions.className : '';
                        return ['skadi-track-popup', cls].filter(Boolean).join(' ');
                    })()
                })
                    .setLngLat(e.lngLat)
                    .setHTML(track.popupContent);
                p.on('open', function () {
                    const el = p.getElement && p.getElement();
                    const closeBtn = el ? el.querySelector('.track-popup-close') : null;
                    if (!closeBtn) return;
                    closeBtn.addEventListener('click', function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        p.remove();
                    }, { once: true });
                });
                p.on('close', () => {
                    if (map && map.getLayer(track.lineLayerId)) {
                        map.setPaintProperty(track.lineLayerId, 'line-width', 3);
                    }
                    if (map && map._skadiLinePopup === p) map._skadiLinePopup = null;
                });
                p.addTo(map);
                map._skadiLinePopup = p;
            };
            try {
                track.adapter = buildSkadiTrackMapAdapter(track);
                track.layer = track.adapter;
                track.invisibleLayer = track.adapter;
                track.adapter._skadiAddTo(map);

                console.log(`[track] added: ${lineLayerId}`);

                // Keep the track so filters can toggle it later; we may hide it immediately.
                tracks.push(track);

                if (activeRecommendationKeys && activeRecommendationKeys.size > 0) {
                    if (!activeRecommendationKeys.has(gpxName)) {
                        map.removeLayer(track.layer);
                    }
                } else if (!trackAttachMatchesLatestFilters(type, season, gpxName)) {
                    map.removeLayer(track.layer);
                }
            } catch (error) {
                console.error(`[track] failed: ${sourceId}`, error);
            }

            };
            if (mapLoaded) attachTrack();
            else pendingTrackAdds.push(attachTrack);
        })
        .catch(error => {
            console.error(`Error loading ${gpxBaseName}.geojson:`, error);
        });
}

// Function to focus on a GPX track
function focusOnGPXName(gpxName) {
    tracks.forEach((track) => {
        if (track.gpxName === gpxName) {
            track.adapter.bringToFront();
            if (map.getLayer(track.lineLayerId)) {
                map.setPaintProperty(track.lineLayerId, 'line-width', 6);
            }
            if (track.bounds && track.bounds.isValid()) {
                map.fitBounds(track.bounds, { padding: [50, 50] });
            }
            if (!track.opensBikeImmersive && track.popupContent && track.bounds && track.bounds.isValid()) {
                map.closePopup();
                const sw = track.bounds.getSouthWest();
                const ne = track.bounds.getNorthEast();
                const centerLng = (sw.lng + ne.lng) / 2;
                const centerLat = (sw.lat + ne.lat) / 2;
                const maxW =
                    track.popupOptions && track.popupOptions.maxWidth != null
                        ? `${track.popupOptions.maxWidth}px`
                        : '520px';
                const p = new mapboxgl.Popup({
                    closeButton: false,
                    offset: 12,
                    maxWidth: maxW,
                    className: (function() {
                        const cls = (track.popupOptions && track.popupOptions.className) ? track.popupOptions.className : '';
                        return ['skadi-track-popup', cls].filter(Boolean).join(' ');
                    })()
                })
                    .setLngLat([centerLng, centerLat])
                    .setHTML(track.popupContent);
                p.on('open', function () {
                    const el = p.getElement && p.getElement();
                    const closeBtn = el ? el.querySelector('.track-popup-close') : null;
                    if (!closeBtn) return;
                    closeBtn.addEventListener('click', function (ev) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        p.remove();
                    }, { once: true });
                });
                p.on('close', () => {
                    if (map && map.getLayer(track.lineLayerId)) {
                        map.setPaintProperty(track.lineLayerId, 'line-width', 3);
                    }
                    if (map && map._skadiLinePopup === p) map._skadiLinePopup = null;
                });
                p.addTo(map);
                map._skadiLinePopup = p;
            }
        } else if (map.getLayer(track.lineLayerId)) {
            map.setPaintProperty(track.lineLayerId, 'line-width', 3);
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
    geojsonDataPromiseCache = {};
    pendingTrackAdds = [];
    gpxNames = [];
    gpxNameSet = new Set();
    gpxNameToMarker = {};
    activityCatalog = [];
    bikeEtapesRegistry = [];

    // Summits: fetch published sheet and apply same processing as export_sheet_to_csv.py in the browser. Bike: published sheet as-is.
    const csvPath = getCsvPath();
    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            if (currentTab === 'summits') csvText = processSheetToSummitsRows(csvText);
            const allLines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
            let bikeCsvDelimiter = ',';
            if (currentTab === 'bike' && allLines.length > 0) {
                bikeCsvDelimiter = detectBikeCsvDelimiter(allLines);
            }
            const rows = allLines.slice(1);
            const summitKeys = new Set();
            const summitStateByKey = new Map();
            const activityCatalogByKey = new Map();
            const keywordCacheRows = [];
            // When multiple summits share one activity, CSV export leaves activity columns empty for merged rows. Carry them over.
            let lastActivity = null;

            rows.forEach((row, rowIndex) => {
                if (!row.trim()) return;

                const isBikeTab = currentTab === 'bike';
                const isSummitsTab = currentTab === 'summits';

                let columns;
                if (isBikeTab) {
                    columns = parseCsvLineWithDelimiter(row, bikeCsvDelimiter);
                } else {
                    columns = parseCsvLine(row);
                }

                // Summits: pad to 16 columns (A–P incl. Photo URLs + Journal) so Google CSV
                // never drops trailing empty fields and we still read column T.
                if (isSummitsTab) {
                    while (columns.length < 16) columns.push('');
                }

                const hasStatusCol = isSummitsTab;
                const minColumns = isSummitsTab ? 16 : isBikeTab ? BIKE_COLUMN_COUNT : 10;

                if (!isBikeTab && columns.length < minColumns) {
                    console.warn('Skipping malformed CSV row (not enough columns):', row);
                    return;
                }

                let name;
                let altitudeRaw = '';
                let summitLatitudeRaw = '';
                let summitLongitudeRaw = '';
                let season;
                let type;
                let grade;
                let distance;
                let duration;
                let elevationGain;
                let gpxFileCell;
                let gpxFileRaw;
                let projectRaw;
                let project;
                let activityUrl;
                let photoUrls;
                let journalEntry;
                let statusCol = '';
                let statusColLower = '';
                let isToDoStatus = false;

                if (isBikeTab) {
                    const br = readBikeSheetRow(columns);
                    name = br.name;
                    season = br.season;
                    type = '';
                    grade = '';
                    distance = br.distance;
                    duration = br.duration;
                    elevationGain = br.elevationGain;
                    gpxFileCell = br.gpxFileCell;
                    projectRaw = br.projectRaw;
                    activityUrl = br.activityUrl;
                    photoUrls = br.photoUrls;
                    journalEntry = br.journalEntry;
                    gpxFileRaw = gpxFileCell;
                    project = normalizeProjectName(projectRaw || 'No Project');
                } else {
                    statusCol = (columns[0] || '').trim();
                    statusColLower = statusCol.toLowerCase();
                    isToDoStatus = hasStatusCol && (statusColLower === 'to do' || statusColLower === 'à faire' || statusColLower === 'a faire');
                    const nameIdx = 1;
                    name = (columns[nameIdx] || '').trim();
                    altitudeRaw = (columns[nameIdx + 1] || '').trim();
                    summitLatitudeRaw = (columns[nameIdx + 2] || '').trim();
                    summitLongitudeRaw = (columns[nameIdx + 3] || '').trim();
                    season = (columns[nameIdx + 4] || '').trim();
                    type = (columns[nameIdx + 5] || '').trim();
                    grade = (columns[nameIdx + 6] || '').trim();
                    distance = (columns[nameIdx + 7] || '').trim();
                    duration = (columns[nameIdx + 8] || '').trim();
                    elevationGain = (columns[nameIdx + 9] || '').trim();
                    gpxFileCell = (columns[11] || '').trim();
                    gpxFileRaw = gpxFileCell;
                    projectRaw = (columns[nameIdx + 11] || '').trim();
                    project = normalizeProjectName(projectRaw || 'No Project');
                    activityUrl = (columns[nameIdx + 12] || '').trim();
                    photoUrls = (columns.length > nameIdx + 13) ? (columns[nameIdx + 13] || '').trim() : '';
                    journalEntry = (columns.length > nameIdx + 14) ? (columns[nameIdx + 14] || '').trim() : '';
                }

                // Inherit activity data from previous row when this row has summit but empty activity (merged cells in sheet).
                // Do not inherit into explicit "to do" rows: they often have no activity fields by design.
                if (isSummitsTab && lastActivity && !gpxFileRaw && !season && !isToDoStatus) {
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
                } else if (isSummitsTab && (gpxFileRaw || season)) {
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
                if (isBikeTab && gpxFile && /^(bike|ride|run)$/i.test(gpxFile)) {
                    console.warn(
                        '[Skadi bike] GPX cell parsed as a generic word — usually wrong column (CSV split). ' +
                            'In Sheets, use ";" as locale separator or quote numbers like "180,8". See docs/BIKE_SHEET_SCHEMA.md.',
                        {
                            gpxFileCell,
                            delimiterUsed: bikeCsvDelimiter,
                            cellsInRow: columns.length,
                            firstTenCellsPreview: padBikeColumns(columns).map((x) => String(x).slice(0, 40))
                        }
                    );
                }
                let gpxName = (gpxFile ? gpxFile.replace(/_/g, ' ') : name).trim();
                if (isBikeTab && !name && gpxName) name = gpxName;

                if (!name && !gpxFile && !gpxName) return;

                const catalogStatus = hasStatusCol && (statusColLower === 'to do' || statusColLower === 'à faire' || statusColLower === 'a faire')
                    ? 'to do'
                    : 'completed';

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
                        const markerLayer = createSummitMapboxMarker(
                            summitLatitude,
                            summitLongitude,
                            projectColor,
                            isCompleted,
                            buildSummitPopupContent(name, altitude, project, isCompleted ? 'completed' : 'to do')
                        );
                        markerLayer._skadiAddTo(map);

                        const markerState = {
                            layer: markerLayer,
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
                            gpxNameToMarker[gpxName] = markerLayer;
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
                    if (isSummitsTab && catalogStatus === 'completed' && (journalEntry || '').trim()) {
                        keywordCacheRows.push({ columnDName: name.trim(), journalEntry });
                    }
                    const distanceKm = parseFloat(normalizeDecimal(distance));
                    const durationHours = parseDurationToHours(duration);
                    const elevationM = parseFloat(normalizeDecimal(elevationGain));
                    if (!activityCatalogByKey.has(gpxName)) {
                        const cotationIndex = parseCotationToIndex(grade);
                        activityCatalogByKey.set(gpxName, {
                            key: gpxName,
                            name: gpxName,
                            columnDName: name.trim(),
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
                            status: catalogStatus,
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
                    const bikeImmersiveMeta =
                        isBikeTab && /^journal\//i.test((journalEntry || '').trim())
                            ? {
                                  etapeName: name.trim(),
                                  journalPath: journalEntry.trim(),
                                  project,
                                  distance,
                                  duration,
                                  elevationGain,
                                  activityUrl,
                                  photoUrls
                              }
                            : null;
                    if (bikeImmersiveMeta) {
                        bikeEtapesRegistry.push({
                            etapeName: bikeImmersiveMeta.etapeName,
                            gpxName,
                            journalPath: bikeImmersiveMeta.journalPath,
                            project: bikeImmersiveMeta.project,
                            distance: bikeImmersiveMeta.distance,
                            duration: bikeImmersiveMeta.duration,
                            elevationGain: bikeImmersiveMeta.elevationGain,
                            activityUrl: bikeImmersiveMeta.activityUrl,
                            photoUrls: bikeImmersiveMeta.photoUrls
                        });
                    }
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
                        journalEntry,
                        bikeImmersiveMeta,
                        rowIndex
                    );
                }

            });

            applySummitMarkerPaintOrderWeights();

            activityCatalog = Array.from(activityCatalogByKey.values());
            if (currentTab === 'summits') {
                scheduleKeywordCacheBuild(keywordCacheRows);
            }
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
function applyFilters(filters = null, keywordTokens = null) {
    const fallbackActivityType = document.getElementById('activity-type') ? document.getElementById('activity-type').value : 'all';
    const fallbackStatus = document.getElementById('status') ? document.getElementById('status').value : 'all';
    const fallbackSeason = document.getElementById('season') ? document.getElementById('season').value : 'all';
    const fallbackName = document.getElementById('search') ? document.getElementById('search').value : '';

    const activityType = normalizeActivityTypeValue(filters && typeof filters.activityType === 'string' ? filters.activityType : fallbackActivityType);
    const status = filters && typeof filters.status === 'string' ? filters.status : fallbackStatus;
    const season = filters && typeof filters.season === 'string' ? filters.season : fallbackSeason;
    const nameFilter = filters && typeof filters.name === 'string' ? filters.name : fallbackName;
    const nameFilterLower = (nameFilter || '').trim().toLowerCase();
    const kwTokens = keywordTokens && keywordTokens.length > 0 ? keywordTokens : null;
    latestFilterState = { activityType, status, season, name: nameFilter || '' };
    activeRecommendationKeys = null;

    markers.forEach(marker => {
        if (marker.dataType !== currentTab) return;

        const typeMatch = activityType === 'all' || normalizeActivityTypeValue(marker.type) === activityType;
        const statusMatch = status === 'all' || marker.status === status;
        const seasonMatch = season === 'all' || normalizeSeasonValue(marker.season) === normalizeSeasonValue(season);
        const nameMatch = markerHasActivityNameMatch(marker, nameFilterLower);
        const keywordMatch = markerHasKeywordMatch(marker, kwTokens);

        if (typeMatch && statusMatch && seasonMatch && nameMatch && keywordMatch) {
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
        const keywordMatch = trackHasKeywordMatch(track, kwTokens);

        if (typeMatch && statusMatch && seasonMatch && nameMatch && keywordMatch) {
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
        closeBikeImmersiveJournal();

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
    disableSkadiChat3DMode();
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

function enableSkadiChat3DMode() {
    if (!map) return;
    try {
        // Save current camera so we can restore it precisely.
        const currPitch = typeof map.getPitch === 'function' ? map.getPitch() : null;
        const currBearing = typeof map.getBearing === 'function' ? map.getBearing() : null;
        if (skadiChat3DSavedPitch === null) skadiChat3DSavedPitch = currPitch;
        if (skadiChat3DSavedBearing === null) skadiChat3DSavedBearing = currBearing;

        map.setPitch(SKADI_CHAT_3D_PITCH);
        // Keep current bearing to avoid a jarring camera rotation.
        if (currBearing != null) map.setBearing(currBearing);
        else map.setBearing(SKADI_CHAT_3D_BEARING);

        // Enable terrain + sky when the style is backed by vector sources (prod Mapbox style).
        // For the local raster dev style, this may fail; we fall back to pitch only.
        try {
            if (typeof map.getSource === 'function' && !map.getSource(SKADI_CHAT_3D_TERRAIN_SOURCE_ID)) {
                map.addSource(SKADI_CHAT_3D_TERRAIN_SOURCE_ID, {
                    type: 'raster-dem',
                    url: SKADI_CHAT_3D_TERRAIN_SOURCE_URL,
                    tileSize: 512,
                    maxzoom: 14
                });
            }
            if (typeof map.setTerrain === 'function') {
                map.setTerrain({ source: SKADI_CHAT_3D_TERRAIN_SOURCE_ID, exaggeration: SKADI_CHAT_3D_TERRAIN_EXAGGERATION });
            }
        } catch (_e) {
            // Terrain is optional; don't block the feature if unavailable.
        }

        // Add 3D buildings extrusions (only if the vector `composite` source exists).
        try {
            if (typeof map.getSource === 'function' && typeof map.getLayer === 'function' && !map.getLayer(SKADI_CHAT_3D_BUILDINGS_LAYER_ID)) {
                // `composite` + `building` source-layer are present in Mapbox's default vector styles.
                if (map.getSource('composite')) {
                    const beforeId = (typeof map.getLayer === 'function' && map.getLayer('waterway-label')) ? 'waterway-label' : undefined;
                    map.addLayer({
                        id: SKADI_CHAT_3D_BUILDINGS_LAYER_ID,
                        type: 'fill-extrusion',
                        source: 'composite',
                        'source-layer': 'building',
                        minzoom: 14,
                        filter: ['==', ['get', 'extrude'], 'true'],
                        paint: {
                            'fill-extrusion-color': '#9aa3ad',
                            'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
                            'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
                            'fill-extrusion-opacity': 0.85
                        }
                    }, beforeId);
                }
            }

            // Sky layer helps sell the 3D look when terrain is enabled.
            if (typeof map.getLayer === 'function' && !map.getLayer(SKADI_CHAT_3D_SKY_LAYER_ID)) {
                const beforeId = (typeof map.getLayer === 'function' && map.getLayer('sky')) ? 'sky' : undefined;
                map.addLayer({
                    id: SKADI_CHAT_3D_SKY_LAYER_ID,
                    type: 'sky',
                    paint: {
                        'sky-type': 'atmosphere',
                        'sky-atmosphere-sun': [0, 0],
                        'sky-atmosphere-sun-intensity': 15,
                        'sky-atmosphere-color': '#87a6c8'
                    }
                }, beforeId);
            }
        } catch (_e) {
            // Building/sky extrusions are optional; don't block pitch mode.
        }

        skadiChat3DEnabled = true;

        // Rotation controls: allow mouse rotation only. Touch rotation stays disabled.
        try {
            if (map.dragRotate && typeof map.dragRotate.enable === 'function') map.dragRotate.enable();
            if (map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
        } catch (_e) {
            // ignore
        }

        // Clamp pitch while 3D is enabled to keep the camera stable.
        if (!skadiChat3DMoveListener && typeof map.on === 'function') {
            skadiChat3DMoveListener = function () {
                if (!skadiChat3DEnabled || skadiChat3DClampGuard) return;
                const p = typeof map.getPitch === 'function' ? map.getPitch() : null;
                if (!Number.isFinite(p)) return;
                if (p >= SKADI_CHAT_3D_PITCH_MIN && p <= SKADI_CHAT_3D_PITCH_MAX) return;
                const clamped = Math.max(SKADI_CHAT_3D_PITCH_MIN, Math.min(SKADI_CHAT_3D_PITCH_MAX, p));
                skadiChat3DClampGuard = true;
                try {
                    map.setPitch(clamped);
                } catch (_e) {
                    // ignore
                } finally {
                    skadiChat3DClampGuard = false;
                }
            };
            map.on('move', skadiChat3DMoveListener);
        }
    } catch (_e) {
        // If camera methods aren't available for some reason, fail silently.
    }
}

function disableSkadiChat3DMode() {
    if (!map || !skadiChat3DEnabled) {
        skadiChat3DEnabled = false;
        skadiChat3DSavedPitch = null;
        skadiChat3DSavedBearing = null;
        // Safety: remove clamp listener and restore rotation controls.
        try {
            if (map && skadiChat3DMoveListener && typeof map.off === 'function') map.off('move', skadiChat3DMoveListener);
        } catch (_e) {
            // ignore
        } finally {
            skadiChat3DMoveListener = null;
        }
        skadiChat3DClampGuard = false;
        try {
            if (map && map.dragRotate && typeof map.dragRotate.disable === 'function') map.dragRotate.disable();
            if (map && map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
        } catch (_e) {
            // ignore
        }
        return;
    }
    try {
        const pitchToRestore = skadiChat3DSavedPitch != null ? skadiChat3DSavedPitch : SKADI_CHAT_2D_PITCH;
        const bearingToRestore = skadiChat3DSavedBearing != null ? skadiChat3DSavedBearing : SKADI_CHAT_3D_BEARING;

        // Turn off terrain first so removed sources/layers don't conflict.
        try {
            if (typeof map.setTerrain === 'function') map.setTerrain(null);
        } catch (_e) {
            // ignore
        }

        // Remove our custom layers/sources if present.
        try {
            if (typeof map.getLayer === 'function' && map.getLayer(SKADI_CHAT_3D_BUILDINGS_LAYER_ID)) {
                map.removeLayer(SKADI_CHAT_3D_BUILDINGS_LAYER_ID);
            }
        } catch (_e) {
            // ignore
        }
        try {
            if (typeof map.getLayer === 'function' && map.getLayer(SKADI_CHAT_3D_SKY_LAYER_ID)) {
                map.removeLayer(SKADI_CHAT_3D_SKY_LAYER_ID);
            }
        } catch (_e) {
            // ignore
        }
        try {
            if (typeof map.getSource === 'function' && map.getSource(SKADI_CHAT_3D_TERRAIN_SOURCE_ID)) {
                map.removeSource(SKADI_CHAT_3D_TERRAIN_SOURCE_ID);
            }
        } catch (_e) {
            // ignore
        }

        map.setPitch(pitchToRestore);
        map.setBearing(bearingToRestore);
        skadiChat3DEnabled = false;
    } catch (_e) {
        skadiChat3DEnabled = false;
    } finally {
        skadiChat3DSavedPitch = null;
        skadiChat3DSavedBearing = null;
        skadiChat3DClampGuard = false;
        try {
            if (skadiChat3DMoveListener && typeof map.off === 'function') map.off('move', skadiChat3DMoveListener);
        } catch (_e) {
            // ignore
        } finally {
            skadiChat3DMoveListener = null;
        }
        try {
            if (map && map.dragRotate && typeof map.dragRotate.disable === 'function') map.dragRotate.disable();
            if (map && map.touchZoomRotate && typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
        } catch (_e) {
            // ignore
        }
    }
}

function getRecommendationMatches(intent) {
    const filters = intent && intent.filters ? intent.filters : {};
    const targets = intent && intent.targets ? intent.targets : {};
    const distanceTarget = targets.distance_km;
    const durationMinTarget = targets.duration_min;
    const elevationTarget = targets.elevation_m;
    const cotationIndexTarget = targets.cotation_index;
    const location = intent && intent.location ? intent.location : null;
    const userKeywords = intent && intent.userKeywords ? intent.userKeywords : [];

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

    let replyPrefix = null;
    let poolForScoring = candidates;
    let poolForRef = candidates;
    let kwFilteredSmall = null;

    if (userKeywords.length > 0) {
        const kwFiltered = candidates.filter((a) => activityMatchesUserKeywords(a, userKeywords));
        const kwCount = kwFiltered.length;
        if (kwCount === 0) {
            replyPrefix = "Je n'ai pas trouvé d'activité avec ce mot-clé, voici les meilleures correspondances globales :";
            poolForScoring = candidates;
            poolForRef = candidates;
        } else if (kwCount <= 2) {
            replyPrefix = "J'ai trouvé peu d'activités avec ce mot-clé, voici mes meilleures suggestions :";
            poolForScoring = candidates;
            poolForRef = candidates;
            kwFilteredSmall = kwFiltered;
        } else {
            poolForScoring = kwFiltered;
            poolForRef = kwFiltered;
        }
    }

    // reference_distance: max distance among the pool used for scoring (keyword step affects poolForRef when 3+ keyword matches).
    let referenceDistanceKm = null;
    if (hasLocation) {
        let max = 0;
        for (const activity of poolForRef) {
            const distKm = haversineDistanceKm(location.lat, location.lon, activity.summitLat, activity.summitLon);
            if (Number.isFinite(distKm)) max = Math.max(max, distKm);
        }
        referenceDistanceKm = max > 0 ? max : 0.0001; // avoid division by zero
    }

    function scoreActivityEntry(activity) {
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
    }

    function toActivityOutput(entry) {
        if (!hasLocation) return entry.activity;
        return {
            ...entry.activity,
            distanceToLocationKm: entry.distanceToLocationKm
        };
    }

    function sortAndLimit(entries, limit) {
        return entries
            .filter((entry) => Number.isFinite(entry.score))
            .sort((a, b) => a.score - b.score)
            .slice(0, limit);
    }

    if (kwFilteredSmall) {
        const kwFiltered = kwFilteredSmall;
        const scoredKw = sortAndLimit(kwFiltered.map(scoreActivityEntry), kwFiltered.length);
        const selectedFromKw = scoredKw.map(toActivityOutput);
        const pickedKeys = new Set(selectedFromKw.map((a) => a.key));
        const restPool = candidates.filter((a) => !pickedKeys.has(a.key));
        const need = Math.max(0, 3 - selectedFromKw.length);
        const scoredRest = sortAndLimit(restPool.map(scoreActivityEntry), need);
        const fromRest = scoredRest.map(toActivityOutput);
        return { matches: [...selectedFromKw, ...fromRest].slice(0, 3), replyPrefix };
    }

    const scored = sortAndLimit(poolForScoring.map(scoreActivityEntry), 3);
    const matches = scored.map(toActivityOutput);
    return { matches, replyPrefix };
}

function buildRecommendationReply(matches, locationName = null, replyPrefix = null) {
    const count = matches.length;
    if (count === 0) {
        const emptyMsg = "Je n'ai pas trouvé d'aventure accomplie qui corresponde à ta demande.";
        return replyPrefix ? `${replyPrefix}\n\n${emptyMsg}` : emptyMsg;
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
    const body = `${intro}\n\n${lines.join('\n')}`;
    return replyPrefix ? `${replyPrefix}\n\n${body}` : body;
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
                const userKeywords = extractUserKeywordsForMode2(userText);
                const { matches, replyPrefix } = getRecommendationMatches({
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
                    location,
                    userKeywords
                });
                const selection = new Set(matches.map((item) => item.key));
                applyRecommendationVisibility(selection);
                // Mode 2: tilt the camera to make 3D buildings/relief feel active.
                enableSkadiChat3DMode();
                // Store for the "contact Charles" flow.
                const recommendationReplyText = buildRecommendationReply(matches, location ? location.name : null, replyPrefix);
                skadiLastMode2Request = userText;
                skadiLastMode2Reply = recommendationReplyText;
                skadiLastMode2LocationName = location ? location.name : null;
                skadiWaitingForContactName = false;

                addChatMessage(messagesEl, recommendationReplyText, 'bot');
            } else {
                const trimmed = userText.trim();
                const wordsSplit = trimmed.split(/\s+/);
                if (currentTab === 'summits' && wordsSplit.length === 1) {
                    const wordRaw = wordsSplit[0];
                    const wordLower = wordRaw.toLowerCase();
                    if (!isReservedMode1SingleWord(wordLower) && !activityNameMatchesSingleWordToken(wordLower)) {
                        const matchesKeys = [];
                        for (const act of activityCatalog) {
                            if (act.dataType !== 'summits' || act.status !== 'completed') continue;
                            if (activityMatchesUserKeywords(act, [wordLower])) matchesKeys.push(act.key);
                        }
                        if (matchesKeys.length === 0) {
                            addChatMessage(messagesEl, "Je n'ai trouvé aucune activité avec ce mot-clé. Tu peux reformuler ou consulter le message d'aide en tapant 'aide'.", 'bot');
                            return;
                        }
                        applyRecommendationVisibility(new Set(matchesKeys));
                        const plural = matchesKeys.length > 1 ? 's' : '';
                        addChatMessage(messagesEl, `J'ai trouvé ${matchesKeys.length} activité${plural} avec le mot-clé '${wordRaw}' !`, 'bot');
                        return;
                    }
                }
                const parsed = parseFilterIntent(userText);
                const keywordTokens = extractResidualKeywordsForMode1(parsed.name);
                const nameForFilter = stripKeywordTokensFromName(parsed.name, keywordTokens);
                applyFilters(
                    {
                        status: parsed.status,
                        season: parsed.season,
                        activityType: parsed.activityType,
                        name: nameForFilter
                    },
                    keywordTokens.length ? keywordTokens : null
                );
                const count = getVisibleActivityCount();
                const intentForConfirm = { ...parsed, name: nameForFilter };
                addChatMessage(messagesEl, buildFilterConfirmation(intentForConfirm, count), 'bot');
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
        showHideAnimationType: 'none',
        loop: false
    });
    photoSwipeLightbox.addFilter('numItems', function() {
        return (window._pswpPhotoItems && window._pswpPhotoItems.length) || 0;
    });
    photoSwipeLightbox.addFilter('itemData', function(itemData, index) {
        return window._pswpPhotoItems[index];
    });

    // Close automatically when the user reaches the last photo.
    // Prevents the previous "loop forever" UX where navigation wraps back to the start.
    const closeIfLast = function () {
        const pswp = photoSwipeLightbox.pswp;
        if (!pswp) return;
        const itemsLen = (window._pswpPhotoItems && window._pswpPhotoItems.length) || 0;
        if (!itemsLen || itemsLen <= 1) return;
        const curr = typeof pswp.currIndex === 'number'
            ? pswp.currIndex
            : (typeof pswp.getCurrentIndex === 'function' ? pswp.getCurrentIndex() : 0);
        if (curr === itemsLen - 1 && typeof pswp.close === 'function') {
            pswp.close();
        }
    };

    // PhotoSwipe lightbox emits 'change' when index changes.
    photoSwipeLightbox.on('change', closeIfLast);

    photoSwipeLightbox.init();
}

// Use capture phase so we receive the click before the map popup stops propagation
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
    if (!map) {
        console.error('Skadi: map not initialized (check Mapbox GL script and token).');
        return;
    }

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
    initBikeJournalControls();

    function whenMapStyleReady(fn) {
        if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
            fn();
        } else {
            map.once('load', fn);
        }
    }
    whenMapStyleReady(function () {
        map.setView([46.2, 7.5], 8);
        loadData();
    });
});