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

```json
{
  "ref": "main",
  "inputs": {
    "action": "add_point",
    "trip_id": "2026-03-27_dream-adventure",
    "trip_name": "",
    "lat": "46.5191",
    "lng": "6.6330",
    "ts": "2026-03-27T10:12:00+01:00"
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
