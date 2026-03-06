// Global variables
let map;
let markers = [];
let tracks = [];
let loadedGeoJSONFiles = {};
let gpxNames = [];
let gpxNameToMarker = {};
let gpxNameToTrack = {};
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
    const outlineWidth = isCompleted ? '2' : '0.3';
    return L.divIcon({
        html: `
            <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2 L2 18 L18 18 Z" fill="${color}" stroke="black" stroke-width="${outlineWidth}"/>
            </svg>
        `,
        className: 'summit-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
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

function getTrackColorByType(type) {
    const t = type.toLowerCase();
    if (t.includes('ski')) return '#46bdc6';
    if (t.includes('hike')) return '#ff6d01';
    if (t.includes('mountaineering')) return '#ea4335';
    if (t.includes('bike')) return '#fbbc04';
    return defaultColor;
}

function getCsvPath() {
    return currentTab === 'bike'
        ? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vReJHYuqYbldPykQitSbHf--VtP6x1dq18OnmvGmajO6t-NzTtv6-uALyNzcipSZ5uRajKziZcZvS9N/pub?gid=2069199560&single=true&output=csv'
        : 'data/processed/activities_clean.csv';
}

// Build popup HTML once for track layers (used by both visible and invisible layers)
function buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType) {
    let html = `<b>${gpxName}</b><br><b>Season:</b> ${season}`;
    if (dataType !== 'bike') html += `<br><b>Type:</b> ${type}`;
    if (grade) html += `<br><b>Grade:</b> ${grade}`;
    if (distance) html += `<br><b>Distance:</b> ${distance} km`;
    if (duration) html += `<br><b>Duration:</b> ${duration}`;
    if (elevationGain) html += `<br><b>Elevation Gain:</b> ${elevationGain} m`;
    return html;
}

// Function to load GeoJSON files dynamically
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName, dataType) {
    const dataPath = dataType === 'bike' ? 'data/bike/processed/' : 'data/processed/';

    if (loadedGeoJSONFiles[dataType + gpxFile]) {
        return; // Skip if the file has already been loaded
    }

    const popupContent = buildTrackPopupContent(gpxName, season, type, grade, distance, duration, elevationGain, dataType);

    fetch(`${dataPath}${gpxFile}.geojson`)
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

            loadedGeoJSONFiles[dataType + gpxFile] = true; // Mark this file as loaded
        })
        .catch(error => {
            console.error(`Error loading ${gpxFile}.geojson:`, error);
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
    gpxNameToMarker = {};
    gpxNameToTrack = {};

    // Summits: cleaned local CSV. Bike: published Google Sheet.
    const csvPath = getCsvPath();
    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            const rows = csvText.split('\n').slice(1);
            const summits = {};
            // When multiple summits share one activity, CSV export leaves activity columns empty for merged rows. Carry them over.
            let lastActivity = null;

            rows.forEach(row => {
                if (!row.trim()) return;

                const columns = row.split(',');
                const isBikeTab = currentTab === 'bike';
                const hasStatusCol = columns.length >= 13;

                if (columns.length < 12) {
                    console.warn('Skipping malformed CSV row (not enough columns):', row);
                    return;
                }

                const statusCol = hasStatusCol ? (columns[0] || '').trim() : '';
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
                let gpxFileRaw = (columns[nameIdx + 10] || '').trim();
                let project = (columns[nameIdx + 11] || 'No Project').trim();

                // Inherit activity data from previous row when this row has summit but empty activity (merged cells in sheet).
                if (lastActivity && !gpxFileRaw && !season) {
                    season = lastActivity.season;
                    type = lastActivity.type;
                    grade = lastActivity.grade;
                    distance = lastActivity.distance;
                    duration = lastActivity.duration;
                    elevationGain = lastActivity.elevationGain;
                    gpxFileRaw = lastActivity.gpxFile;
                    project = lastActivity.project || 'No Project';
                } else if (gpxFileRaw || season) {
                    lastActivity = { season, type, grade, distance, duration, elevationGain, gpxFile: gpxFileRaw, project };
                }

                const gpxFile = gpxFileRaw || null;
                let gpxName = (gpxFile ? gpxFile.replace(/_/g, ' ') : name).trim();
                if (isBikeTab && !name && gpxName) name = gpxName;

                if (!name && !gpxFile && !gpxName) return;

                const altitude = parseFloat(altitudeRaw) || 0;
                const summitLatitude = parseFloat(summitLatitudeRaw);
                const summitLongitude = parseFloat(summitLongitudeRaw);

                if (
                    Number.isFinite(summitLatitude) &&
                    Number.isFinite(summitLongitude) &&
                    !summits[name]
                ) {
                    // Explicit Status (column C): "to do" overrides GPX presence; "completed" or empty → use GPX.
                    let isCompleted;
                    if (hasStatusCol && statusCol.toLowerCase() === 'to do') {
                        isCompleted = false;
                    } else if (hasStatusCol && statusCol.toLowerCase() === 'completed') {
                        isCompleted = true;
                    } else {
                        isCompleted = !!gpxFile;
                    }
                    const projectColor = projectColors[project] || defaultColor;
                    const summitIcon = createTriangleIcon(projectColor, isCompleted);

                    const marker = L.marker([summitLatitude, summitLongitude], { icon: summitIcon })
                        .addTo(map)
                        .bindPopup(`
                            <b>${name} ${altitude ? `(${altitude}m)` : ''}</b><br>
                            <b>Project:</b> ${project}<br>
                            <b>Status:</b> ${isCompleted ? 'completed' : 'to do'}
                        `);

                    markers.push({
                        layer: marker,
                        type: type,
                        status: isCompleted ? 'completed' : 'to do',
                        season: season,
                        name: name,
                        dataType: currentTab
                    });

                    if (gpxName) {
                        gpxNameToMarker[gpxName] = marker;
                    }

                    summits[name] = true;
                }

                // Load GeoJSON for every row that has a GPX file (same summit can have multiple tracks).
                if (gpxFile && gpxName) {
                    if (!gpxNames.includes(gpxName)) {
                        gpxNames.push(gpxName);
                    }
                    const trackColor = currentTab === 'bike'
                        ? (projectColors[project] || '#32CD32')
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
                        currentTab
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
        } else {
            filtersContainer.classList.remove('hidden');
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

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    initMap();

    // Set the default tab to summits
    currentTab = 'summits';
    document.querySelector('#tabs a[data-tab="summits"]').classList.add('active');

    // Show filters for the summit tab
    document.getElementById('filters-container').classList.remove('hidden');

    // Set the default map view for summits
    map.setView([46.2, 7.5], 8);

    loadData();
});