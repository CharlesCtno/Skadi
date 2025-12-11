// Initialize map with zoomControl set to false
const map = L.map('map', {
  zoomControl: false
}).setView([46.2, 7.5], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Store markers and tracks for filtering
let markers = [];
let tracks = [];

// Function to create a colored triangle icon with outline
function createTriangleIcon(color, isCompleted) {
    const outlineWidth = isCompleted ? '2' : '0';
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

// Function to load GeoJSON files dynamically
function loadGeoJSON(gpxFile, color, season, type, grade, distance, duration, elevationGain, gpxName) {
    fetch(`data/processed/${gpxFile}.geojson`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load GeoJSON: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
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
                }
            }).addTo(map);

            tracks.push({
                layer: track,
                type: type,
                status: 'completed',
                season: season
            });
        })
        .catch(error => {
            console.error(`Error loading ${gpxFile}.geojson:`, error);
        });
}

// Function to convert decimal hours to "XhYmin" format
function formatDuration(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return minutes < 10 ? `${hours}h0${minutes}` : `${hours}h${minutes}`;
}

// Define colors for each project
const projectColors = {
    'Proxima': '#45818e',
    'Annecy': '#3c78d8',
    'Bauges': '#674ea7',
    '4000': '#a64d79',
    'Aravis': '#f1c232'
};

// Default color for activities without a project
const defaultColor = '#808080'; // Gray

// Load summit data from CSV
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
                    season: season
                });

                summits[name] = true;
            }

            // Load GeoJSON file if it exists
            if (gpxFile) {
                const grade = columns[6];
                const distance = columns[7];
                const duration = columns[8];
                const elevationGain = columns[9];
                const gpxName = columns[12] && columns[12].replace(/_/g, ' ');

                let trackColor;
                if (type.toLowerCase().includes('ski')) {
                    trackColor = '#a64d79';
                } else if (type.toLowerCase().includes('hike')) {
                    trackColor = '#45818e';
                } else {
                    trackColor = defaultColor;
                }
                const formattedDuration = duration ? formatDuration(parseFloat(duration)) : "N/A";
                loadGeoJSON(gpxFile, trackColor, season, type, grade, distance, formattedDuration, elevationGain, gpxName);
            }
        });
    })
    .catch(error => {
        console.error('Error loading CSV:', error);
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
        } else {
            map.removeLayer(track.layer);
        }
    });
}

// Add event listener for the apply filters button
document.getElementById('apply-filters').addEventListener('click', applyFilters);