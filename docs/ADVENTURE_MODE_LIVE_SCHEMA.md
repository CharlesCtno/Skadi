# Adventure Mode Live Schema (v1)

This document defines the minimal JSON contract for Adventure Mode phase 1.

## 1) Active trip file

Path: `live/activeTrip.json`

```json
{
  "isActive": true,
  "tripId": "2026-03-26_test-trip",
  "tripName": "Test Trip",
  "updatedAt": "2026-03-26T10:00:00+01:00",
  "liveDayActive": true,
  "liveDayUpdatedAt": "2026-03-26T08:30:00+01:00"
}
```

### Fields
- `isActive` (`boolean`, required): whether an adventure trip is currently active.
- `tripId` (`string`, required when active): format `YYYY-MM-DD_name`.
- `tripName` (`string`, optional): display label for the trip.
- `updatedAt` (`string`, optional): ISO timestamp of latest active-trip update.
- `liveDayActive` (`boolean`, optional): whether day live sharing is currently active.
- `liveDayUpdatedAt` (`string`, optional): ISO timestamp of latest day-live toggle.

## 2) Trip points file

Path: `live/trips/<tripId>/points.json`

```json
{
  "tripId": "2026-03-26_test-trip",
  "points": [
    {
      "lat": 46.5191,
      "lng": 6.633,
      "ts": "2026-03-26T09:00:00Z"
    }
  ]
}
```

### Fields
- `tripId` (`string`, optional but recommended): should match folder name and active trip id.
- `points` (`array`, required): chronologically sortable GPS samples.

Each point:
- `lat` (`number`, required): latitude in decimal degrees.
- `lng` (`number`, required): longitude in decimal degrees.
- `ts` (`string`, required): ISO timestamp.

## Forward-compatible enrichment (next phase)

The point model is intentionally extensible. Future optional fields:
- `note` (`string`)
- `photos` (`string[]`, URL list)

Current rendering ignores unknown fields and only uses `lat/lng/ts`.
