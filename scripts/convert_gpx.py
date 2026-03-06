import argparse
import json
from pathlib import Path

import gpxpy


def convert_one(input_path: Path, output_path: Path) -> None:
    """Convert a single GPX file to GeoJSON."""
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

    output_path.parent.mkdir(parents=True, exist_ok=True)
    geojson = {"type": "FeatureCollection", "features": features}
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, indent=2)

    print(f"Converted: {input_path.name} → {output_path}")


def gpx_to_geojson(gpx_folder: str, output_folder: str) -> None:
    """Convert all GPX files in a folder to GeoJSON."""
    src = Path(gpx_folder)
    dst = Path(output_folder)
    if not src.is_dir():
        raise NotADirectoryError(f"GPX folder not found: {src}")
    dst.mkdir(parents=True, exist_ok=True)

    for input_path in sorted(src.glob("*.gpx")):
        output_path = dst / (input_path.stem + ".geojson")
        convert_one(input_path, output_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert GPX files to GeoJSON.")
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        help="Specific .gpx file path(s) to convert. If none, convert all in data/raw/ and data/bike/raw/.",
    )
    args = parser.parse_args()

    if args.files:
        for input_path in args.files:
            input_path = input_path.resolve()
            if not input_path.suffix.lower() == ".gpx":
                continue
            # data/bike/raw/foo.gpx → data/bike/processed/foo.geojson
            if "bike" in input_path.parts:
                output_path = Path("data/bike/processed") / (input_path.stem + ".geojson")
            else:
                output_path = Path("data/processed") / (input_path.stem + ".geojson")
            convert_one(input_path, output_path)
    else:
        gpx_to_geojson("data/raw/", "data/processed/")
        gpx_to_geojson("data/bike/raw/", "data/bike/processed/")


if __name__ == "__main__":
    main()