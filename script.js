// Initialize map
const map = L.map('map').setView([46.2, 7.5], 8); // Centered on the Alps
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Load GeoJSON files dynamically
function loadGeoJSON(file, color) {
    fetch(`data/processed/${file}`)
        .then(response => response.json())
        .then(data => {
            L.geoJSON(data, {
                style: { color: color, weight: 3 }
            }).addTo(map);
        });
}

// Example: Load all GeoJSON files (adjust as needed)
loadGeoJSON("trace1.geojson", "red");
loadGeoJSON("trace2.geojson", "blue");