import gpxpy
import json
import os

def gpx_to_geojson(gpx_folder, output_folder):
    """Convert all GPX files in a folder to GeoJSON."""
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)

    for gpx_file in os.listdir(gpx_folder):
        if gpx_file.endswith(".gpx"):
            input_path = os.path.join(gpx_folder, gpx_file)
            output_path = os.path.join(output_folder, gpx_file.replace(".gpx", ".geojson"))

            with open(input_path, "r") as f:
                gpx = gpxpy.parse(f)

            features = []
            for track in gpx.tracks:
                for segment in track.segments:
                    coordinates = [[point.longitude, point.latitude] for point in segment.points]
                    feature = {
                        "type": "Feature",
                        "geometry": {"type": "LineString", "coordinates": coordinates},
                        "properties": {"name": track.name or "Unnamed Track"}
                    }
                    features.append(feature)

            geojson = {"type": "FeatureCollection", "features": features}

            with open(output_path, "w") as f:
                json.dump(geojson, f, indent=2)

            print(f"Converted: {gpx_file} → {output_path}")

#gpx_to_geojson("data/raw/", "data/processed/")
gpx_to_geojson("data/bike/raw/", "data/bike/processed/")