"""Read posture rollups from Tiger Data and accept camera events.

Run from backend/:

    uvicorn api.main:app --port 8000
"""

import os
from datetime import datetime, timezone
from typing import Iterator

import psycopg2
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel, Field, field_validator

app = FastAPI(title="Posture API")

# The dashboard is a static site (GoDaddy or a local file server) on another origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn() -> Iterator:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not set")
    conn = psycopg2.connect(url)
    try:
        yield conn
    finally:
        conn.close()


TIMELINE_SQL = """
SELECT
  bucket,
  good_samples,
  bad_samples,
  samples,
  avg_confidence
FROM posture_per_minute
WHERE user_id = %s
  AND bucket >= now() - (%s * INTERVAL '1 hour')
ORDER BY bucket ASC
"""

SUMMARY_SQL = """
SELECT
  COALESCE(SUM(good_samples), 0) AS good_samples,
  COALESCE(SUM(bad_samples), 0) AS bad_samples,
  COALESCE(SUM(samples), 0) AS samples
FROM posture_per_minute
WHERE user_id = %s
  AND bucket >= now() - (%s * INTERVAL '1 hour')
"""

LIVE_SQL = """
SELECT time, label, confidence
FROM posture_events
WHERE user_id = %s
  AND time >= now() - INTERVAL '10 minutes'
ORDER BY time ASC
LIMIT 600
"""

BAD_LABEL_SQL = """
SELECT label
FROM posture_events
WHERE user_id = %s
  AND label <> 'good'
  AND time >= now() - (%s * INTERVAL '1 hour')
GROUP BY label
ORDER BY count(*) DESC, label ASC
LIMIT 1
"""

INSERT_SQL = """
INSERT INTO posture_events (time, user_id, label, confidence)
VALUES (%s, %s, %s, %s)
RETURNING time, user_id, label, confidence
"""


def percent_good(good: int, samples: int) -> float | None:
    if samples <= 0:
        return None
    return round(100.0 * good / samples, 1)


class TimelinePoint(BaseModel):
    bucket: datetime
    good_samples: int
    bad_samples: int
    samples: int
    avg_confidence: float | None


class TimelineResponse(BaseModel):
    user_id: str
    hours: float
    points: list[TimelinePoint]


class SummaryResponse(BaseModel):
    user_id: str
    hours: float
    samples: int
    good_samples: int
    bad_samples: int
    percent_good: float | None
    most_common_bad_label: str | None


class PostureEventIn(BaseModel):
    time: datetime
    user_id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)

    @field_validator("user_id", "label", mode="before")
    @classmethod
    def strip_text(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("time")
    @classmethod
    def assume_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class PostureEventOut(BaseModel):
    time: datetime
    user_id: str
    label: str
    confidence: float | None


class LiveEvent(BaseModel):
    time: datetime
    label: str
    confidence: float | None
    posture: int | None


class LiveResponse(BaseModel):
    user_id: str
    events: list[LiveEvent]


def _as_int(value) -> int:
    return int(value)


def _as_float(value):
    if value is None:
        return None
    return float(value)


def fetch_timeline(conn, user_id: str, hours: float) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(TIMELINE_SQL, (user_id, hours))
        rows = cur.fetchall()
    return [
        {
            "bucket": row["bucket"],
            "good_samples": _as_int(row["good_samples"]),
            "bad_samples": _as_int(row["bad_samples"]),
            "samples": _as_int(row["samples"]),
            "avg_confidence": _as_float(row["avg_confidence"]),
        }
        for row in rows
    ]


def fetch_summary(conn, user_id: str, hours: float) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(SUMMARY_SQL, (user_id, hours))
        totals = cur.fetchone()
        cur.execute(BAD_LABEL_SQL, (user_id, hours))
        label_row = cur.fetchone()
    good = _as_int(totals["good_samples"])
    bad = _as_int(totals["bad_samples"])
    samples = _as_int(totals["samples"])
    return {
        "samples": samples,
        "good_samples": good,
        "bad_samples": bad,
        "percent_good": percent_good(good, samples),
        "most_common_bad_label": label_row["label"] if label_row else None,
    }


def insert_event(conn, event: PostureEventIn) -> dict:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            INSERT_SQL,
            (event.time, event.user_id, event.label, event.confidence),
        )
        row = cur.fetchone()
    conn.commit()
    return {
        "time": row["time"],
        "user_id": row["user_id"],
        "label": row["label"],
        "confidence": _as_float(row["confidence"]),
    }


def fetch_live(conn, user_id: str) -> list[dict]:
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(LIVE_SQL, (user_id,))
        rows = cur.fetchall()
    events = []
    for row in rows:
        confidence = _as_float(row["confidence"])
        posture = None if confidence is None else max(0, min(100, round(confidence * 100)))
        events.append(
            {
                "time": row["time"],
                "label": row["label"],
                "confidence": confidence,
                "posture": posture,
            }
        )
    return events


def _clean_user_id(user_id: str) -> str:
    user_id = user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    return user_id


@app.get("/users/{user_id}/timeline", response_model=TimelineResponse)
def timeline(
    user_id: str,
    hours: float = Query(default=6, gt=0, le=168),
    conn=Depends(get_conn),
):
    user_id = _clean_user_id(user_id)
    return {
        "user_id": user_id,
        "hours": hours,
        "points": fetch_timeline(conn, user_id, hours),
    }


@app.get("/users/{user_id}/summary", response_model=SummaryResponse)
def summary(
    user_id: str,
    hours: float = Query(default=6, gt=0, le=168),
    conn=Depends(get_conn),
):
    user_id = _clean_user_id(user_id)
    return {"user_id": user_id, "hours": hours, **fetch_summary(conn, user_id, hours)}


@app.get("/users/{user_id}/live", response_model=LiveResponse)
def live(user_id: str, conn=Depends(get_conn)):
    user_id = _clean_user_id(user_id)
    return {"user_id": user_id, "events": fetch_live(conn, user_id)}


@app.post("/events", response_model=PostureEventOut, status_code=201)
def create_event(event: PostureEventIn, conn=Depends(get_conn)):
    return insert_event(conn, event)
