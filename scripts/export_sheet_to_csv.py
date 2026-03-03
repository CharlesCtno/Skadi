import csv
import io
import requests


SHEET_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "e/2PACX-1vReJHYuqYbldPykQitSbHf--VtP6x1dq18OnmvGmajO6t-NzTtv6-uALyNzcipSZ5uRajKziZcZvS9N/"
    "pub?gid=0&single=true&output=csv"
)

OUTPUT_PATH = "data/processed/activities_clean.csv"


def normalize_decimal(value: str) -> str:
    """
    Replace comma decimal separators with dots, but leave empty strings as-is.
    """
    value = value.strip()
    if not value:
        return value
    return value.replace(",", ".")


def main() -> None:
    resp = requests.get(SHEET_CSV_URL)
    resp.raise_for_status()

    # Decode as UTF-8 explicitly to avoid mojibake with accented characters.
    text = resp.content.decode("utf-8")

    # Split into lines, skip first 3 (rows 1–3), then parse from row 4 onward.
    lines = text.splitlines()[3:]
    reader = csv.reader(lines)

    # We only keep columns D–O (12 columns): indices 3..14 (inclusive) in 0-based CSV rows.
    # Map them to the same header structure as the existing activities.csv.
    header = [
        "Name",
        "Altitude [m]",
        "Summit Latitude",
        "Summit Longitude",
        "Season",
        "Type",
        "Grade",
        "Distance [km]",
        "Duration [h]",
        "Elevation Gain [m]",
        "GPX File",
        "Project",
    ]

    with open(OUTPUT_PATH, "w", newline="", encoding="utf-8") as f_out:
        writer = csv.writer(f_out)
        writer.writerow(header)

        for row in reader:
            # Pad short rows so we can safely slice
            if len(row) < 15:  # need indices up to 14
                row = row + [""] * (15 - len(row))

            # Slice D–O -> indices 3..14
            d_to_o = row[3:15]

            # Unpack the fields we care about
            (
                name,
                altitude,
                summit_lat,
                summit_lon,
                season,
                type_,
                grade,
                distance,
                duration,
                elevation_gain,
                gpx_file,
                project,
            ) = d_to_o

            name_stripped = name.strip()
            project_stripped = project.strip()
            gpx_file_stripped = gpx_file.strip()

            # Skip rows that have no name and no coordinates – likely headers/empty.
            if not name_stripped and not summit_lat.strip() and not summit_lon.strip():
                continue

            # Skip header/section rows that repeat the column titles inside the table.
            if (
                name_stripped in ("Summit", "Name")
                or gpx_file_stripped == "GPX File"
                or project_stripped == "Project"
            ):
                continue

            # Normalize decimals for numeric fields
            altitude = normalize_decimal(altitude)
            summit_lat = normalize_decimal(summit_lat)
            summit_lon = normalize_decimal(summit_lon)
            distance = normalize_decimal(distance)
            duration = normalize_decimal(duration)
            elevation_gain = normalize_decimal(elevation_gain)

            writer.writerow(
                [
                    name_stripped,
                    altitude,
                    summit_lat,
                    summit_lon,
                    season.strip(),
                    type_.strip(),
                    grade.strip(),
                    distance,
                    duration,
                    elevation_gain,
                    gpx_file_stripped,
                    project_stripped or "No Project",
                ]
            )


if __name__ == "__main__":
    main()

