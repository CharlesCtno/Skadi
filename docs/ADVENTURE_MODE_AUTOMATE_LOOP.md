# Adventure Mode Automate Loop (offline buffer)

This guide describes the Android Automate flow for live GPS posting with offline buffering.

## Goal
- Send `add_point` updates to GitHub Actions when trip sharing is active.
- Keep collecting points when network is unavailable.
- Flush buffered points first when connectivity returns.

## Files on phone storage
- `skadi_state.json`: state flags written by HTTP Shortcuts start/stop actions.
- `skadi_buffer.json`: queued points not yet posted.

Suggested paths:
- `/storage/emulated/0/Skadi/skadi_state.json`
- `/storage/emulated/0/Skadi/skadi_buffer.json`

## `skadi_state.json` shape
```json
{
  "tripActive": true,
  "liveDayActive": true,
  "tripId": "2026-03-27_dream-adventure"
}
```

## `skadi_buffer.json` shape
```json
{
  "points": [
    {
      "lat": 46.5191,
      "lng": 6.6330,
      "acc": 11.2,
      "ts": "2026-03-27T11:35:00+01:00"
    }
  ]
}
```

## Automate flow blocks
Flow name: `Skadi Live GPS Loop`

1. **Flow beginning**
   - Enable *Run in background*.
2. **Read file**
   - Read `skadi_state.json` into `stateJson`.
   - If missing: jump to wait step.
3. **JSON decode**
   - Extract `tripActive`, `liveDayActive`, `tripId`.
4. **If**
   - Continue only when `tripActive == true` and `liveDayActive == true`.
5. **Read buffer file**
   - Load `skadi_buffer.json`; if missing, initialize `{"points":[]}`.
6. **Flush buffer loop**
   - For each buffered point, call workflow dispatch (`add_point`).
   - On success: remove point from buffer and write file.
   - On failure: keep remaining points and continue to location capture.
7. **Get location**
   - GPS + Network, best accuracy, timeout 30 seconds.
   - Capture `lat`, `lon`, `accuracy`.
8. **Network check**
   - If online: dispatch `add_point`.
   - If offline or request fails: append to `skadi_buffer.json`.
9. **Wait**
   - Sleep 60 minutes (or your chosen cadence).
10. **Go to step 2**

## GitHub dispatch endpoint and payload
Endpoint:
- `https://api.github.com/repos/CharlesCtno/Skadi/actions/workflows/adventure_live_dispatch.yml/dispatches`

Required headers:
- `Authorization: Bearer <PAT>`
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- `Content-Type: application/json`

Payload for live point:
```json
{
  "ref": "main",
  "inputs": {
    "action": "add_point",
    "trip_id": "2026-03-27_dream-adventure",
    "lat": "46.5191",
    "lon": "6.6330",
    "accuracy": "11.2",
    "ts": "2026-03-27T11:35:00+01:00",
    "note": ""
  }
}
```

Optional **`note`**: set a short caption on the same request (see `docs/ADVENTURE_MODE_LIVE_SCHEMA.md`).

## Photo from the phone (large files)

GitHub `workflow_dispatch` inputs are not suited to huge base64 blobs. Prefer:

1. Upload the JPEG to Cloudinary from Automate (multipart `POST` to `https://api.cloudinary.com/v1_1/<cloud>/image/upload` with `upload_preset` and `file`).
2. Read `secure_url` from the JSON response.
3. Dispatch **`enrich_point`** with `point_id` = that point’s `ts`, `photo_url` = `secure_url`, `photo` = empty, `photo_uploaded` = `false`.

See `docs/ADVENTURE_MODE_TASKER_MVP.md` §3b and `docs/ADVENTURE_MODE_LIVE_SCHEMA.md`.

## Reliability notes
- Keep points in buffer until GitHub returns success.
- Use ISO timestamps from phone local timezone.
- If you add deduplication later, compare `(tripId, ts)` before append.
