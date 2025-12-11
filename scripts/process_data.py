import pandas as pd

def excel_to_csv(input_excel, output_csv):
    """Convert Excel to CSV, including specified columns and adding GPXName."""
    df = pd.read_excel(input_excel, engine="openpyxl")

    # Select relevant columns
    columns = [
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
        "Project"  # Include the Project column
    ]
    df = df[columns]

    # Add GPXName column by replacing underscores with spaces in GPX File
    df['GPXName'] = df['GPX File'].str.replace('_', ' ')

    # Save to CSV
    df.to_csv(output_csv, index=False)
    print(f"Saved: {output_csv}")

# Example usage
excel_to_csv("data/raw/activities.xlsx", "data/processed/activities.csv")