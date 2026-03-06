import csv
import os
import requests

SHEET_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "e/2PACX-1vReJHYuqYbldPykQitSbHf--VtP6x1dq18OnmvGmajO6t-NzTtv6-uALyNzcipSZ5uRajKziZcZvS9N/"
    "pub?gid=0&single=true&output=csv"
)

OUTPUT_PATH = "data/processed/activities_clean.csv"


def normalize_decimal(value: str) -> str:
    """Replace comma decimal separators with dots; leave empty strings as-is."""
    if not value or not value.strip():
        return value.strip()
    return value.strip().replace(",", ".")


def main() -> None:
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    resp = requests.get(SHEET_CSV_URL, timeout=30)
    resp.raise_for_status()

    # Decode as UTF-8 explicitly to avoid mojibake with accented characters.
    text = resp.content.decode("utf-8")

    # Split into lines, skip first 3 (rows 1–3), then parse from row 4 onward.
    lines = text.splitlines()[3:]
    reader = csv.reader(lines)

    # Keep columns C–O (13 columns): Status, Name, Altitude, ..., Project.
    # Indices 2..14 (0-based). Row must have at least 15 elements.
    header = [
        "Status",
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

        # When multiple summits share one activity, merged cells leave H–M empty on extra rows.
        # Column N (GPX File) identifies the activity. We never write N: if a row has N empty (e.g. Status "to do") we output empty for N and H–M.
        # Inherit H–M only when this row has N filled and N is the same as previous row.
        # Same summit can appear twice with different N (e.g. Grammont + "Grammont", Grammont + "Grammont_&_Alamont"); when name/lat/lon are empty (merged), inherit summit from previous row so we output two lines.
        last_activity = None  # (last_N, last_season, last_type, last_grade, last_distance, last_duration, last_elevation_gain)
        last_summit = None  # (name, altitude, summit_lat, summit_lon) after normalization, for rows with merged summit cells

        for row in reader:
            if len(row) < 15:
                row = row + [""] * (15 - len(row))

            c_to_o = row[2:15]
            (
                status,
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
            ) = c_to_o

            name_stripped = name.strip()
            project_stripped = project.strip()
            gpx_file_stripped = gpx_file.strip()
            season_stripped = season.strip()
            status_lower = status.strip().lower()
            is_to_do = status_lower == "to do"

            if not name_stripped and not summit_lat.strip() and not summit_lon.strip():
                if last_summit is None:
                    continue
                # Same summit, different activity (e.g. second GPX): inherit summit from previous row so we output two lines.
                name_stripped, altitude, summit_lat, summit_lon = last_summit[0], last_summit[1], last_summit[2], last_summit[3]
            if (
                name_stripped in ("Summit", "Name")
                or gpx_file_stripped == "GPX File"
                or project_stripped == "Project"
            ):
                continue

            # Rows with N empty (e.g. Status "to do"): we never write to N or H–M; leave them empty.
            # Only inherit H–M when this row has N filled and N is the same as previous row (same activity).
            same_activity = (
                not is_to_do
                and last_activity is not None
                and gpx_file_stripped
                and gpx_file_stripped == last_activity[0]
            )
            if same_activity:
                (
                    _last_n,
                    last_season,
                    last_type,
                    last_grade,
                    last_distance,
                    last_duration,
                    last_elevation_gain,
                ) = last_activity
                if not season_stripped:
                    season = last_season
                    season_stripped = season
                if not type_.strip():
                    type_ = last_type
                if not grade.strip():
                    grade = last_grade
                if not distance.strip():
                    distance = last_distance
                if not duration.strip():
                    duration = last_duration
                if not elevation_gain.strip():
                    elevation_gain = last_elevation_gain

            # When this row has N filled and is not "to do", store N and H–M for the next row.
            if gpx_file_stripped and not is_to_do:
                last_activity = (
                    gpx_file_stripped,
                    season.strip(),
                    type_.strip(),
                    grade.strip(),
                    distance.strip(),
                    duration.strip(),
                    elevation_gain.strip(),
                )

            altitude = normalize_decimal(altitude)
            summit_lat = normalize_decimal(summit_lat)
            summit_lon = normalize_decimal(summit_lon)
            distance = normalize_decimal(distance)
            duration = normalize_decimal(duration)
            elevation_gain = normalize_decimal(elevation_gain)

            # For "to do" rows (N empty): never write to N or H–M; output empty so CSV matches the sheet.
            if is_to_do:
                out_season = ""
                out_type = ""
                out_grade = ""
                out_distance = ""
                out_duration = ""
                out_elevation_gain = ""
                out_gpx_file = ""
            else:
                out_season = season.strip()
                out_type = type_.strip()
                out_grade = grade.strip()
                out_distance = distance
                out_duration = duration
                out_elevation_gain = elevation_gain
                out_gpx_file = gpx_file_stripped

            writer.writerow(
                [
                    status.strip(),
                    name_stripped,
                    altitude,
                    summit_lat,
                    summit_lon,
                    out_season,
                    out_type,
                    out_grade,
                    out_distance,
                    out_duration,
                    out_elevation_gain,
                    out_gpx_file,
                    project_stripped or "No Project",
                ]
            )
            last_summit = (name_stripped, altitude, summit_lat, summit_lon)


if __name__ == "__main__":
    main()

