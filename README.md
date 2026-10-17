# dubhacks readme

## Database

Posture labels from the camera feed are stored in Tiger Data (TimescaleDB on Postgres). Dashboards read per-user rollups; user IDs are hardcoded per user. Schema, the one-minute continuous aggregate, and a seed script live in this repo.

Copy `.env.example` to `.env` and set `DATABASE_URL` locally. `.env` is gitignored — do not commit credentials.

```bash
pip install -r requirements.txt
```

Apply the schema and the continuous aggregate as two separate `psql` runs:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/aggregates.sql
```

Seed fake posture events (default 6 hours; pass a number of hours as the first argument) and refresh `posture_per_minute`:

```bash
python scripts/seed.py
# python scripts/seed.py 12
```

`seed.py` reads `DATABASE_URL` from the environment. Load `.env` first, for example `set -a && source .env && set +a`.

## API

A small FastAPI app reads `posture_per_minute` and accepts camera events. From the repo root, with `DATABASE_URL` set:

```bash
uvicorn api.main:app --port 8000
```

Interactive docs are at `http://127.0.0.1:8000/docs`.

- `GET /users/{user_id}/timeline?hours=6` — per-minute `good_samples` and `bad_samples` from `posture_per_minute`. `hours` is optional (default 6, max 168).
- `GET /users/{user_id}/summary?hours=6` — percent good posture from that aggregate, and the most common bad label from `posture_events` in the same window.
- `POST /events` — insert one event. JSON body: `time`, `user_id`, `label`, `confidence` (0–1). Example labels: `good`, `slouching`, `leaning_forward`, `head_tilt`.

```bash
curl -s "http://127.0.0.1:8000/users/user_1/summary?hours=6"
curl -s -X POST "http://127.0.0.1:8000/events" \
  -H "content-type: application/json" \
  -d '{"time":"2026-10-17T20:00:00Z","user_id":"user_1","label":"good","confidence":0.95}'
```

CORS is open so a static site on another origin can call the API. There is no auth; user ids are plain strings such as `user_1` and `user_2`.

A new event lands in `posture_events` immediately. It shows up in `posture_per_minute` after the refresh policy runs (about a minute), or when `scripts/seed.py` refreshes the aggregate.

## Dashboard

`web/index.html` is a single static page: a user selector (`user_1`, `user_2`), good-vs-bad chart, and summary stats. Chart.js is loaded from a CDN, so there is no build step. Upload the contents of `web/` to the GoDaddy static host.

Set the API origin in the script at the top of `web/index.html`:

```javascript
const API_BASE = "http://127.0.0.1:8000";
```

If the site is served over https, point `API_BASE` at an https API origin.

Locally, serve the page (opening the file directly can block requests from the page):

```bash
python -m http.server 8080 --directory web
```

Then open `http://127.0.0.1:8080`.

## Deploy

`render.yaml` is a Render blueprint for a free Python web service. Create the Blueprint from this repo in the Render dashboard and set `DATABASE_URL` when prompted. That variable is `sync: false`, so the connection string stays in the dashboard and is not stored in the repo.

After the service is up, set `API_BASE` at the top of `web/index.html` to the service's https URL, then upload `web/` to GoDaddy.
