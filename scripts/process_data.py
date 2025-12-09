import pandas as pd

def excel_to_csv(input_excel, output_csv):
    """Convert Excel to CSV, selecting relevant columns."""
    df = pd.read_excel(input_excel, engine="openpyxl")

    # Select columns (adjust as needed)
    columns = ["Name", "Altitude [m]", "Summit Latitude", "Summit Longitude", "Season", "Type", "Grade", "Distance [km]", "Duration [h]", "Elevation Gain [m]",  "GPX File"]
    df = df[columns]

    # Save to CSV
    df.to_csv(output_csv, index=False)
    print(f"Saved: {output_csv}")

# Example usage
excel_to_csv("data/raw/activities.xlsx", "data/processed/activities.csv")

#Print the number of lines on the csv
