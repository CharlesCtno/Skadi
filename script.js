// Initialize map with zoomControl set to false
const map = L.map('map', {
  zoomControl: false
}).setView([46.2, 7.5], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Store markers and tracks for filtering
let markers = [];
let tracks = [];
let loadedGeoJSONFiles = {};

// Store GPX names for search
let gpxNames = [];
let gpxNameToMarker = {}; // Map GPX names to markers
let gpxNameToTrack = {};   // Map GPX names to tracks

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
        return duration; // Return as is if it's in days format (e.g., "2 days")
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
    'Aravis': '#a64d79'
};

// Default color for activities without a project
const defaultColor = '#808080';

// Function to load GeoJSON files dynamically
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName) {
    if (loadedGeoJSONFiles[gpxFile]) {
        return; // Skip if the file has already been loaded
    }

    fetch(`data/processed/${gpxFile}.geojson`)
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
                    layer.bindPopup(`
                        <b>${gpxName}</b><br>
                        <b>Season:</b> ${season}<br>
                        <b>Type:</b> ${type}<br>
                        <b>Grade:</b> ${grade}<br>
                        <b>Distance:</b> ${distance} km<br>
                        <b>Duration:</b> ${duration}<br>
                        <b>Elevation Gain:</b> ${elevationGain} m
                    `);

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
                    layer.bindPopup(`
                        <b>${gpxName}</b><br>
                        <b>Season:</b> ${season}<br>
                        <b>Type:</b> ${type}<br>
                        <b>Grade:</b> ${grade}<br>
                        <b>Distance:</b> ${distance} km<br>
                        <b>Duration:</b> ${duration}<br>
                        <b>Elevation Gain:</b> ${elevationGain} m
                    `);

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
                bounds: track.getBounds()
            });

            loadedGeoJSONFiles[gpxFile] = true; // Mark this file as loaded
        })
        .catch(error => {
            console.error(`Error loading ${gpxFile}.geojson:`, error);
        });
}

// Function to focus on a GPX track
function focusOnGPXName(gpxName) {
    // Focus on the marker if it exists
    for (const marker of markers) {
        if (marker.name === gpxName) {
            map.setView(marker.layer.getLatLng(), 12);
            marker.layer.openPopup();
        }
    }

    // Highlight and zoom on the track if it exists
    tracks.forEach(track => {
        if (track.gpxName === gpxName) {
            track.layer.bringToFront();
            track.layer.eachLayer(function(layer) {
                layer.setStyle({ weight: 6 });

                // Zoom to fit the track bounds with padding
                if (track.bounds && track.bounds.isValid()) {
                    map.fitBounds(track.bounds, { padding: [70, 70] });
                }

                // Open popup
                layer.openPopup();
            });
        } else {
            track.layer.eachLayer(function(layer) {
                layer.setStyle({ weight: 3 });
            });
        }
    });
}

// Load summit data from CSV and store GPX names for search
fetch("data/processed/activities.csv")
    .then(response => response.text())
    .then(csvText => {
        const rows = csvText.split('\n').slice(1); // Skip header row
        const summits = {}; // Object to store unique summits

        rows.forEach(row => {
            const columns = row.split(',');
            const name = columns[0];
            const altitude = parseInt(columns[1], 10);
            const summitLatitude = columns[2];
            const summitLongitude = columns[3];
            const project = columns[11] || 'No Project';
            const gpxFile = columns[10] && columns[10].trim();
            const season = columns[4];
            const type = columns[5];
            const gpxName = columns[12] ? columns[12].replace(/_/g, ' ') : '';

            if (summitLatitude && summitLongitude && !summits[name]) {
                const isCompleted = !!gpxFile;
                const projectColor = projectColors[project] || defaultColor;
                const summitIcon = createTriangleIcon(projectColor, isCompleted);

                const marker = L.marker([parseFloat(summitLatitude), parseFloat(summitLongitude)], { icon: summitIcon })
                    .addTo(map)
                    .bindPopup(`
                        <b>${name} (${altitude}m)</b><br>
                        <b>Project:</b> ${project}<br>
                        <b>Status:</b> ${isCompleted ? 'completed' : 'to do'}
                    `);

                markers.push({
                    layer: marker,
                    type: type,
                    status: isCompleted ? 'completed' : 'to do',
                    season: season,
                    name: name
                });

                if (gpxName) {
                    if (!gpxNames.includes(gpxName)) {
                        gpxNames.push(gpxName);
                    }
                    gpxNameToMarker[gpxName] = marker;
                }

                summits[name] = true;
            }

            // Load GeoJSON file if it exists
            if (gpxFile && gpxName) {
                const grade = columns[6];
                const distance = columns[7];
                const duration = columns[8];
                const elevationGain = columns[9];

                let trackColor;
                if (type.toLowerCase().includes('ski')) {
                    trackColor = '#46bdc6';
                } else if (type.toLowerCase().includes('hike')) {
                    trackColor = '#ff6d01';
                } else if (type.toLowerCase().includes('mountaineering')) {
                    trackColor = '#ea4335';
                } else {
                    trackColor = defaultColor;
                }

                const formattedDuration = formatDuration(duration);
                loadGeoJSON(gpxFile, trackColor, season, type, grade, distance, formattedDuration, elevationGain, gpxName);
            }
        });
    })
    .catch(error => {
        console.error('Error loading CSV:', error);
    });

// Function to handle search
document.getElementById('search').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const resultsContainer = document.getElementById('search-results');

    if (searchTerm.length === 0) {
        resultsContainer.style.display = 'none';
        return;
    }

    const matches = gpxNames.filter(gpxName => gpxName.toLowerCase().includes(searchTerm));

    if (matches.length > 0) {
        resultsContainer.innerHTML = '';
        matches.forEach(match => {
            const div = document.createElement('div');
            div.textContent = match;
            div.style.color = 'white'; // Ajout pour correspondre à ton style sombre
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

// Hide search results when clicking outside
document.addEventListener('click', function(e) {
    const searchContainer = document.getElementById('search');
    const resultsContainer = document.getElementById('search-results');

    if (e.target !== searchContainer) {
        resultsContainer.style.display = 'none';
    }
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

// Clear search input
document.getElementById('clear-search').addEventListener('click', function() {
    document.getElementById('search').value = '';
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search').focus();
    document.getElementById('clear-search').style.display = 'none';
});

// Show/hide clear button
document.getElementById('search').addEventListener('input', function(e) {
    const searchTerm = e.target.value.toLowerCase();
    const clearSearchButton = document.getElementById('clear-search');
    const resultsContainer = document.getElementById('search-results');

    if (searchTerm.length > 0) {
        clearSearchButton.style.display = 'block';
    } else {
        clearSearchButton.style.display = 'none';
        resultsContainer.style.display = 'none';
    }

    if (searchTerm.length === 0) {
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