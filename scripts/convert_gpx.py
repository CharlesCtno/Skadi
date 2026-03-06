import gpxpy
import json
from pathlib import Path


def gpx_to_geojson(gpx_folder: str, output_folder: str) -> None:
    """Convert all GPX files in a folder to GeoJSON."""
    src = Path(gpx_folder)
    dst = Path(output_folder)
    if not src.is_dir():
        raise NotADirectoryError(f"GPX folder not found: {src}")
    dst.mkdir(parents=True, exist_ok=True)

    for input_path in sorted(src.glob("*.gpx")):
        output_path = dst / (input_path.stem + ".geojson")

        with open(input_path, "r", encoding="utf-8") as f:
            gpx = gpxpy.parse(f)

        features = []
        for track in gpx.tracks:
            for segment in track.segments:
                coordinates = [
                    [p.longitude, p.latitude] for p in segment.points
                ]
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coordinates},
                    "properties": {"name": track.name or "Unnamed Track"},
                })

        geojson = {"type": "FeatureCollection", "features": features}
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, indent=2)

        print(f"Converted: {input_path.name} → {output_path}")


if __name__ == "__main__":
    gpx_to_geojson("data/raw/", "data/processed/")
    gpx_to_geojson("data/bike/raw/", "data/bike/processed/")