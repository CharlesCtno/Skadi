# Adventure Mode Tasker MVP (Android)

This guide documents the MVP request format for Android Tasker to trigger Adventure Mode updates via GitHub Actions `workflow_dispatch`.

## Endpoint

`POST https://api.github.com/repos/CharlesCtno/Skadi/actions/workflows/adventure_live_dispatch.yml/dispatches`

## Headers

- `Authorization: Bearer <FINE_GRAINED_PAT>`
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- `Content-Type: application/json`

## Body template

```json
{
  "ref": "main",
  "inputs": {
    "action": "start_trip",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "Dream adventure",
    "lat": "",
    "lng": "",
    "ts": ""
  }
}
```

## Action payloads

### 1) Start trip

```json
{
  "ref": "main",
  "inputs": {
    "action": "start_trip",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "Dream adventure",
    "lat": "",
    "lng": "",
    "ts": ""
  }
}
```

### 2) Start live day

```json
{
  "ref": "main",
  "inputs": {
    "action": "start_live_day",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "",
    "lng": "",
    "ts": ""
  }
}
```

### 3) Add point (phone GPS)

Optional **`note`**: one-line caption stored on the new point (no separate `enrich_point`).

```json
{
  "ref": "main",
  "inputs": {
    "action": "add_point",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "46.5191",
    "lng": "6.6330",
    "ts": "2026-03-27T10:12:00+01:00",
    "note": ""
  }
}
```

Example with caption:

```json
{
  "ref": "main",
  "inputs": {
    "action": "add_point",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "46.5191",
    "lng": "6.6330",
    "ts": "2026-03-27T10:12:00+01:00",
    "note": "Pause à la frontière"
  }
}
```

### 3b) Enrich point (note / photo after the fact)

Use the point’s **`ts`** as **`point_id`**.

- **`note`**: text on the point.
- **`photo`**: base64 JPEG (keep small; workflow input size limits).
- **`photo_url`**: `https://...` if the image is already online (recommended for large photos: upload to Cloudinary from the phone with an **unsigned preset**, then pass `secure_url` here).

```json
{
  "ref": "main",
  "inputs": {
    "action": "enrich_point",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "",
    "lng": "",
    "ts": "",
    "point_id": "2026-03-27T10:12:00+01:00",
    "note": "Détail du stop",
    "photo": "",
    "photo_url": "https://res.cloudinary.com/your-cloud/image/upload/v123/folder/id.jpg",
    "photo_uploaded": "false"
  }
}
```

### 4) Stop live day

```json
{
  "ref": "main",
  "inputs": {
    "action": "stop_live_day",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "",
    "lng": "",
    "ts": ""
  }
}
```

### 5) Stop trip

```json
{
  "ref": "main",
  "inputs": {
    "action": "stop_trip",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "",
    "lng": "",
    "ts": ""
  }
}
```

## Fine-grained PAT scope (recommended)

- Repository access: only `CharlesCtno/Skadi`
- Repository permission:
  - `Actions: Read and write`
- Set an expiration date and rotate periodically.
