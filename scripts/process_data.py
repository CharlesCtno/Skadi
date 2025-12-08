import pandas as pd

def excel_to_csv(input_excel, output_csv):
    """Convert Excel to CSV, selecting relevant columns."""
    df = pd.read_excel(input_excel, engine="openpyxl")

    # Select columns (adjust as needed)
    columns = ["Name", "Type", "Altitude", "Elevation Gain", "Distance", "GPX File"]
    df = df[columns]

    # Save to CSV
    df.to_csv(output_csv, index=False)
    print(f"Saved: {output_csv}")

# Example usage
excel_to_csv("data/raw/activites.xlsx", "data/processed/activites.csv")
