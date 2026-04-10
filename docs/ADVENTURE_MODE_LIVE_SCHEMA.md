# Adventure Mode Live Schema (v2)

This document defines the JSON contract for Adventure Mode live trips and how enrichment is stored.

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
      "ts": "2026-03-26T09:00:00Z",
      "accuracy": 12.5,
      "note": "Pause café",
      "photo": "https://res.cloudinary.com/.../image/upload/..."
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
- `ts` (`string`, required): ISO timestamp (used as stable id for enrichment).
- `accuracy` (`number`, optional): GPS accuracy in meters.
- `note` (`string`, optional): short text attached to the point (caption). May be set on `add_point` or updated on `enrich_point`.
- `photo` (`string`, optional): **HTTPS URL** to the image (typically **Cloudinary `secure_url`**). The site loads this URL directly; do not rely on repo-stored JPEGs for new data.

Legacy data may still have `photo` as a repo-relative path (e.g. `live/trips/.../photos/...jpg`) or a `photos` array; the frontend resolves relative paths against the site origin. Prefer HTTPS Cloudinary URLs for all new uploads.

## 3) Actions (`workflow_dispatch`)

### `add_point`

Appends a GPS sample. Optional workflow input **`note`**: if non-empty, stored on the new point as `note` (one-shot caption from the phone without a separate `enrich_point` call).

Inputs: `trip_id`, `lat`, `lng` (or `lon`), optional `accuracy`, `ts`, **`note`**.

### `enrich_point`

Updates an existing point matched by **`point_id`** = that point’s **`ts`** (string equality).

Optional fields (any combination):
- **`note`**: replaces/sets the text on the point.
- **`photo`**: base64-encoded JPEG. The Actions runner uploads it to **Cloudinary** (`skadi/live/<tripId>/` folder, `public_id` = `point_id`) and stores the returned **`secure_url`** in `photo`. Keep payloads small (workflow input size limits); `admin/enrich.html` resizes before base64.
- **`photo_url`**: **HTTPS URL** to an image already hosted (e.g. you uploaded from the phone to Cloudinary via an **unsigned upload preset**). Stored as-is in `photo` (no second upload). Must be `https://` only.

If both `photo` (base64) and `photo_url` are provided, **base64 upload wins** (Cloudinary upload from Actions).

**Deprecated:** `photo_uploaded` + GitHub Contents API repo paths are no longer used for new flows; see history in git if you need to migrate old JSON.

## Phone: photo without huge base64 in GitHub

1. In Cloudinary, create an **unsigned upload preset** restricted to a folder (e.g. `skadi/live-uploads`) and allowed formats (image/jpeg). Do not expose full account upload.
2. From Automate / HTTP Shortcuts: `POST https://api.cloudinary.com/v1_1/<cloud_name>/image/upload` with `upload_preset`, `file` (multipart), optional `folder` / `public_id` per Cloudinary docs.
3. Read `secure_url` from the JSON response.
4. Dispatch **`enrich_point`** with `point_id` = the point’s `ts`, `photo_url` = that `secure_url`, and optional `note`.

See also `docs/ADVENTURE_MODE_TASKER_MVP.md` and `docs/ADVENTURE_MODE_AUTOMATE_LOOP.md` for dispatch payloads.
