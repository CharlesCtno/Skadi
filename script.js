// Initialize map
const map = L.map('map').setView([46.2, 7.5], 8); // Centered on the Alps
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Function to create a colored triangle icon
function createTriangleIcon(color) {
    return L.divIcon({
        html: `
            <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2 L2 18 L18 18 Z" fill="${color}" />
            </svg>
        `,
        className: 'summit-icon',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
}

// Function to load GeoJSON files dynamically
function loadGeoJSON(file, color) {
    console.log(`Loading GeoJSON file: ${file}`);
    fetch(`data/processed/${file}.geojson`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to load GeoJSON: ${response.status} ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(`GeoJSON loaded: ${file}.geojson`);
            L.geoJSON(data, {
                style: { color: color, weight: 3 }
            }).addTo(map);
        })
        .catch(error => {
            console.error(`Error loading ${file}.geojson:`, error);
        });
}

// Function to convert decimal hours to "XhYmin" format
function formatDuration(decimalHours) {
    const hours = Math.floor(decimalHours);
    const minutes = Math.round((decimalHours - hours) * 60);
    return minutes < 10 ? `${hours}h0${minutes}` : `${hours}h${minutes}`;
}

// Load summit data from CSV
fetch("data/processed/activities.csv")
    .then(response => response.text())
    .then(csvText => {
        const rows = csvText.split('\n').slice(1); // Skip header row
        rows.forEach(row => {
            const columns = row.split(',');
            const name = columns[0];
            const altitude = columns[1];
            const summitLatitude = columns[2];
            const summitLongitude = columns[3];
            const season = columns[4];
            const type = columns[5];
            const grade = columns[6];
            const distance = columns[7];
            const duration = columns[8];
            const elevationGain = columns[9];
            const gpxFile = columns[10];

            if (summitLatitude && summitLongitude) {
                // Determine status based on GPX File column (empty means "to do")
                const status = gpxFile.trim() ? 'completed' : 'to do';
                const iconColor = status === 'completed' ? 'green' : 'orange';

                // Create a colored triangle icon
                const summitIcon = createTriangleIcon(iconColor);

                // Format duration (e.g., 5.5 → 5h30)
                const formattedDuration = duration ? formatDuration(parseFloat(duration)) : "N/A";

                // Add the summit marker to the map with detailed popup
                L.marker([parseFloat(summitLatitude), parseFloat(summitLongitude)], { icon: summitIcon })
                    .addTo(map)
                    .bindPopup(`
                        <b>${name + " (" + altitude + "m)"}</b><br>
                        <b>Type:</b> ${type}<br>
                        <b>Grade:</b> ${grade}<br>
                        <b>Distance:</b> ${distance} km<br>
                        <b>Duration:</b> ${formattedDuration}<br>
                        <b>Elevation Gain:</b> ${elevationGain} m
                    `);
            }

            // Load GeoJSON file if it exists
            if (gpxFile.trim()) {
                let trackColor;
                if (type.toLowerCase().includes('ski')) {
                    trackColor = 'red';
                } else if (type.toLowerCase().includes('hike')) {
                    trackColor = 'blue';
                } else {
                    trackColor = 'gray'; // Default color for other types
                }
                loadGeoJSON(gpxFile, trackColor);
            }
        });
    });