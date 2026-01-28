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

// Function to load GeoJSON files dynamically
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName, dataType) {
    const dataPath = dataType === 'bike' ? 'data/bike/processed/' : 'data/processed/';

    if (loadedGeoJSONFiles[dataType + gpxFile]) {
        return; // Skip if the file has already been loaded
    }

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
                    let popupContent = `
                        <b>${gpxName}</b><br>
                        <b>Season:</b> ${season}
                    `;

                    // Only add Type to the popup if not in the bike tab
                    if (dataType !== 'bike') {
                        popupContent += `<br><b>Type:</b> ${type}`;
                    }

                    popupContent += `
                        ${grade ? `<br><b>Grade:</b> ${grade}` : ''}
                        ${distance ? `<br><b>Distance:</b> ${distance} km` : ''}
                        ${duration ? `<br><b>Duration:</b> ${duration}` : ''}
                        ${elevationGain ? `<br><b>Elevation Gain:</b> ${elevationGain} m` : ''}
                    `;

                    layer.bindPopup(popupContent);

                    // Add click event to bring the track to the front
                    layer.on('click', function(e) {
                        track.bringToFront();
                        layer.setStyle({ weight: 6 });
                    });

                    // Reset style when popup is closed
                    layer.on('popupclose', function(e) {
                        layer.setStyle({ weight: 3 });
                    });
                }
            }).addTo(map);

            // Invisible layer for better clickability
            const invisibleTrack = L.geoJSON(data, {
                style: { color: 'transparent', weight: 15, opacity: 0 },
                interactive: true,
                onEachFeature: function(feature, layer) {
                    let popupContent = `
                        <b>${gpxName}</b><br>
                        <b>Season:</b> ${season}
                    `;

                    // Only add Type to the popup if not in the bike tab
                    if (dataType !== 'bike') {
                        popupContent += `<br><b>Type:</b> ${type}`;
                    }

                    popupContent += `
                        ${grade ? `<br><b>Grade:</b> ${grade}` : ''}
                        ${distance ? `<br><b>Distance:</b> ${distance} km` : ''}
                        ${duration ? `<br><b>Duration:</b> ${duration}` : ''}
                        ${elevationGain ? `<br><b>Elevation Gain:</b> ${elevationGain} m` : ''}
                    `;

                    layer.bindPopup(popupContent);

                    // Add click event to bring the track to the front
                    layer.on('click', function(e) {
                        track.bringToFront();
                        track.eachLayer(function(trackLayer) {
                            trackLayer.setStyle({ weight: 6 });
                        });
                    });

                    // Reset style when popup is closed
                    layer.on('popupclose', function(e) {
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

    // Determine the data path based on the current tab
    const csvPath = currentTab === 'bike' ? 'data/bike/processed/bike_activities.csv' : 'data/processed/activities.csv';

    fetch(csvPath)
        .then(response => response.text())
        .then(csvText => {
            const rows = csvText.split('\n').slice(1); // Skip header row
            const summits = {}; // Object to store unique summits

            rows.forEach(row => {
                const columns = row.split(',');
                const name = columns[0];
                const altitude = parseInt(columns[1], 10) || 0; // Default to 0 if altitude is not available
                const summitLatitude = columns[2];
                const summitLongitude = columns[3];
                const project = columns[11] || 'No Project';
                const gpxFile = columns[10] && columns[10].trim();
                const season = columns[4];
                const type = columns[5];
                const gpxName = columns[12] ? columns[12].replace(/_/g, ' ') : name; // Use name if GPXName is not available

                if (summitLatitude && summitLongitude && !summits[name]) {
                    const isCompleted = !!gpxFile;
                    const projectColor = projectColors[project] || defaultColor;
                    const summitIcon = createTriangleIcon(projectColor, isCompleted);

                    const marker = L.marker([parseFloat(summitLatitude), parseFloat(summitLongitude)], { icon: summitIcon })
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
                        if (!gpxNames.includes(gpxName)) {
                            gpxNames.push(gpxName);
                        }
                        gpxNameToMarker[gpxName] = marker;
                    }

                    summits[name] = true;
                }

                // Inside the loadData function, where you load GeoJSON files
if (gpxFile && gpxName) {
    const grade = columns[6];
    const distance = columns[7];
    const duration = columns[8];
    const elevationGain = columns[9];

    let trackColor;
    if (currentTab === 'bike') {
        // Use project color for bike tracks
        trackColor = projectColors[project] || '#32CD32'; // Default to lime green if project color is not defined
    } else {
        // Use type-based color for summit tracks
        if (type.toLowerCase().includes('ski')) {
            trackColor = '#46bdc6';
        } else if (type.toLowerCase().includes('hike')) {
            trackColor = '#ff6d01';
        } else if (type.toLowerCase().includes('mountaineering')) {
            trackColor = '#ea4335';
        } else if (type.toLowerCase().includes('bike')) {
            trackColor = '#fbbc04';
        } else {
            trackColor = defaultColor;
        }
    }

    const formattedDuration = formatDuration(duration);
    loadGeoJSON(gpxFile, trackColor, season, type, grade, distance, formattedDuration, elevationGain, gpxName, currentTab);
}

            });
        })
        .catch(error => {
            console.error('Error loading CSV:', error);
        });
}

// Function to handle search
document.getElementById('search').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');
    const clearSearchButton = document.getElementById('clear-search');

    if (searchTerm.length > 0) {
        clearSearchButton.style.display = 'block';
    } else {
        clearSearchButton.style.display = 'none';
        resultsContainer.style.display = 'none';
        return;
    }

    const matches = gpxNames.filter(gpxName => gpxName.toLowerCase().includes(searchTerm));

    if (matches.length > 0) {
        resultsContainer.innerHTML = '';
        matches.forEach(match => {
            const div = document.createElement('div');
            div.textContent = match;
            div.style.color = 'white';
            div.addEventListener('click', function() {
                e.target.value = match;
                resultsContainer.style.display = 'none';
                focusOnGPXName(match);
            });
            resultsContainer.appendChild(div);
        });
        resultsContainer.style.display = 'block';
    } else {
        resultsContainer.style.display = 'none';
    }
});

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