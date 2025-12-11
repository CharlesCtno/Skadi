import pandas as pd
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderUnavailable
import time

# Load your Excel file
df = pd.read_excel('Coordinates.xlsx', engine='openpyxl')

# Initialize the geocoder with a descriptive user agent
geolocator = Nominatim(user_agent="skadi_summit_map/1.0")

# Function to get coordinates for a summit
def get_coordinates(name, altitude):
    try:
        # Include altitude and specify the Alps region
        location = geolocator.geocode(f"{name}, {altitude}m, Alps, France or Switzerland", exactly_one=True, timeout=10)
        if location:
            return location.latitude, location.longitude
        else:
            return None, None
    except (GeocoderTimedOut, GeocoderUnavailable):
        return None, None

# Fill in the coordinates for each summit
for index, row in df.iterrows():
    if pd.isnull(row['Summit Latitude']) and not pd.isnull(row['Name']):
        latitude, longitude = get_coordinates(row['Name'], row['Altitude [m]'])
        df.at[index, 'Summit Latitude'] = latitude
        df.at[index, 'Summit Longitude'] = longitude
        time.sleep(1)  # Add a delay between requests

# Save the updated DataFrame to a new Excel file
df.to_excel('Coordinates_Filled.xlsx', index=False)
