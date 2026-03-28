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
- `accuracy` (`number`, optional): GPS accuracy in meters.

## Forward-compatible enrichment (next phase)

For phase 2 enrichment, `pointId` is the point `ts` value (string equality).

Optional enrichment fields on a point:
- `note` (`string`): short text attached to the point.
- `photo` (`string`): repo-relative path to one photo, e.g. `live/trips/<tripId>/photos/<pointId>.jpg`.
- `photos` (`string[]`, optional legacy/future format): optional list of photo URLs.

Current rendering uses `lat/lng/ts` for geometry and displays `note/photo` when available.

### Enrich workflow (`enrich_point`)

- Notes and `points.json` updates are applied by `scripts/adventure_live_dispatch.py` via `workflow_dispatch`.
- **Photos:** do not pass large base64 blobs as workflow inputs (size limits). The admin page uploads the JPEG with the **GitHub Contents API** to `live/trips/<tripId>/photos/<pointId>.jpg`, then dispatches `enrich_point` with `photo_uploaded: true` and an empty `photo` input so the workflow only updates `points.json` with the `photo` path.
