"""Unit checks for the posture API. These never open a database connection."""

import os
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import api.main as main

REPO_ROOT = Path(__file__).resolve().parents[2]


class FakeCursor:
    def __init__(self, conn, cursor_factory=None):
        self.conn = conn
        self._result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.conn.queries.append((" ".join(sql.split()), params))
        self._result = self.conn.results.pop(0)

    def fetchall(self):
        return self._result

    def fetchone(self):
        return self._result


class FakeConn:
    def __init__(self, results):
        self.results = list(results)
        self.queries = []
        self.committed = False
        self.closed = False

    def cursor(self, cursor_factory=None):
        return FakeCursor(self, cursor_factory)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


class ApiTests(unittest.TestCase):
    def setUp(self):
        main._blink_store = False
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()

    def use_conn(self, conn):
        def override():
            try:
                yield conn
            finally:
                conn.close()

        main.app.dependency_overrides[main.get_conn] = override

    def test_percent_good(self):
        self.assertIsNone(main.percent_good(0, 0))
        self.assertEqual(main.percent_good(0, 4), 0.0)
        self.assertEqual(main.percent_good(1, 3), 33.3)
        self.assertEqual(main.percent_good(3, 4), 75.0)

    def test_timeline_reads_aggregate(self):
        bucket = datetime(2026, 10, 17, 18, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [
                [
                    {
                        "bucket": bucket,
                        "good_samples": 10,
                        "bad_samples": 2,
                        "samples": 12,
                        "avg_confidence": 0.91,
                    }
                ]
            ]
        )
        self.use_conn(conn)
        response = self.client.get("/users/user_1/timeline?hours=6")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["user_id"], "user_1")
        self.assertEqual(body["hours"], 6)
        self.assertEqual(body["points"][0]["good_samples"], 10)
        self.assertEqual(body["points"][0]["bad_samples"], 2)
        self.assertEqual(body["points"][0]["avg_confidence"], 0.91)
        sql, params = conn.queries[0]
        self.assertIn("FROM posture_per_minute", sql)
        self.assertIn("ORDER BY bucket ASC", sql)
        self.assertNotIn("posture_events", sql)
        self.assertEqual(params, ("user_1", 6.0))
        self.assertTrue(conn.closed)
        self.assertFalse(conn.committed)

    def test_timeline_defaults_hours_and_allows_null_confidence(self):
        bucket = datetime(2026, 10, 17, 18, 1, tzinfo=timezone.utc)
        conn = FakeConn(
            [
                [
                    {
                        "bucket": bucket,
                        "good_samples": 1,
                        "bad_samples": 0,
                        "samples": 1,
                        "avg_confidence": None,
                    }
                ]
            ]
        )
        self.use_conn(conn)
        response = self.client.get("/users/user_2/timeline")
        self.assertEqual(response.status_code, 200)
        point = response.json()["points"][0]
        self.assertIsNone(point["avg_confidence"])
        self.assertEqual(conn.queries[0][1], ("user_2", 6.0))

    def test_summary_percent_and_bad_label(self):
        conn = FakeConn(
            [
                {"good_samples": 8, "bad_samples": 2, "samples": 10},
                {"label": "slouching"},
            ]
        )
        self.use_conn(conn)
        response = self.client.get("/users/user_1/summary?hours=2")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["percent_good"], 80.0)
        self.assertEqual(body["good_samples"], 8)
        self.assertEqual(body["bad_samples"], 2)
        self.assertEqual(body["samples"], 10)
        self.assertEqual(body["most_common_bad_label"], "slouching")
        totals_sql, totals_params = conn.queries[0]
        label_sql, label_params = conn.queries[1]
        self.assertIn("FROM posture_per_minute", totals_sql)
        self.assertIn("SUM(good_samples)", totals_sql)
        self.assertEqual(totals_params, ("user_1", 2.0))
        self.assertIn("FROM posture_events", label_sql)
        self.assertIn("label <> 'good'", label_sql)
        self.assertNotIn("posture_per_minute", label_sql)
        self.assertEqual(label_params, ("user_1", 2.0))

    def test_summary_empty_window(self):
        conn = FakeConn(
            [
                {"good_samples": 0, "bad_samples": 0, "samples": 0},
                None,
            ]
        )
        self.use_conn(conn)
        response = self.client.get("/users/user_2/summary")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIsNone(body["percent_good"])
        self.assertIsNone(body["most_common_bad_label"])
        self.assertEqual(body["samples"], 0)

    def test_post_inserts_event(self):
        stored = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [
                {
                    "time": stored,
                    "user_id": "user_1",
                    "label": "leaning_forward",
                    "confidence": 0.88,
                }
            ]
        )
        self.use_conn(conn)
        response = self.client.post(
            "/events",
            json={
                "time": "2026-10-17T20:00:00Z",
                "user_id": " user_1 ",
                "label": " leaning_forward ",
                "confidence": 0.88,
            },
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["user_id"], "user_1")
        self.assertEqual(body["label"], "leaning_forward")
        self.assertEqual(body["confidence"], 0.88)
        sql, params = conn.queries[0]
        self.assertIn("INSERT INTO posture_events", sql)
        self.assertEqual(params[1:], ("user_1", "leaning_forward", 0.88))
        self.assertEqual(params[0], datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc))
        self.assertTrue(conn.committed)

    def test_post_naive_time_is_stored_as_utc(self):
        stored = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [
                {
                    "time": stored,
                    "user_id": "user_2",
                    "label": "head_tilt",
                    "confidence": 0,
                }
            ]
        )
        self.use_conn(conn)
        response = self.client.post(
            "/events",
            json={
                "time": "2026-10-17T20:00:00",
                "user_id": "user_2",
                "label": "head_tilt",
                "confidence": 0,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(conn.queries[0][1][0], stored)

    def test_post_rejects_bad_payload(self):
        conn = FakeConn([])
        self.use_conn(conn)
        missing = self.client.post("/events", json={"user_id": "user_1", "label": "good"})
        self.assertEqual(missing.status_code, 422)
        blank = self.client.post(
            "/events",
            json={
                "time": "2026-10-17T20:00:00Z",
                "user_id": "   ",
                "label": "good",
                "confidence": 0.5,
            },
        )
        self.assertEqual(blank.status_code, 422)
        confidence = self.client.post(
            "/events",
            json={
                "time": "2026-10-17T20:00:00Z",
                "user_id": "user_1",
                "label": "good",
                "confidence": 1.2,
            },
        )
        self.assertEqual(confidence.status_code, 422)
        self.assertEqual(conn.queries, [])

    def test_device_id_format_passes_clean_user_id(self):
        device_id = "desk-lamp_01"
        long_id = ("Ab" * 39) + "_Z"
        self.assertEqual(len(long_id), 80)
        self.assertEqual(main._clean_user_id(f"  {device_id}  "), device_id)
        self.assertEqual(main._clean_user_id(long_id), long_id)
        self.assertEqual(main._clean_user_id("user_1"), "user_1")

        stored = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [
                {
                    "time": stored,
                    "user_id": device_id,
                    "label": "slouching",
                    "confidence": 0.4,
                }
            ]
        )
        self.use_conn(conn)
        created = self.client.post(
            "/events",
            json={
                "time": "2026-10-17T20:00:00Z",
                "user_id": device_id,
                "label": "slouching",
                "confidence": 0.4,
            },
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["user_id"], device_id)
        self.assertEqual(conn.queries[0][1][1], device_id)

        bucket = datetime(2026, 10, 17, 20, 0, tzinfo=timezone.utc)
        timeline_conn = FakeConn(
            [
                [
                    {
                        "bucket": bucket,
                        "good_samples": 0,
                        "bad_samples": 1,
                        "samples": 1,
                        "avg_confidence": 0.4,
                    }
                ]
            ]
        )
        self.use_conn(timeline_conn)
        timeline = self.client.get(f"/users/{device_id}/timeline?hours=1")
        self.assertEqual(timeline.status_code, 200)
        self.assertEqual(timeline.json()["user_id"], device_id)
        sql, params = timeline_conn.queries[0]
        self.assertIn("FROM posture_per_minute", sql)
        self.assertEqual(params, (device_id, 1.0))

        summary_conn = FakeConn(
            [
                {"good_samples": 0, "bad_samples": 1, "samples": 1},
                {"label": "slouching"},
            ]
        )
        self.use_conn(summary_conn)
        summary = self.client.get(f"/users/{long_id}/summary?hours=6")
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.json()["user_id"], long_id)
        self.assertEqual(summary.json()["most_common_bad_label"], "slouching")
        self.assertEqual(summary_conn.queries[0][1][0], long_id)

    def test_blink_fields_stay_off_the_insert_until_columns_exist(self):
        stored = datetime(2026, 10, 18, 2, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [{"time": stored, "user_id": "lamp-1", "label": "good", "confidence": 0.8}]
        )
        self.use_conn(conn)
        created = self.client.post(
            "/events",
            json={
                "time": "2026-10-18T02:00:00Z",
                "user_id": "lamp-1",
                "label": "good",
                "confidence": 0.8,
                "blink_gap": 6.5,
                "blinks_per_minute": 12,
            },
        )
        self.assertEqual(created.status_code, 201)
        sql, params = conn.queries[0]
        self.assertNotIn("blink_gap", sql)
        self.assertEqual(params, (stored, "lamp-1", "good", 0.8))

    def test_blink_fields_are_stored_and_returned(self):
        main._blink_store = True
        stored = datetime(2026, 10, 18, 2, 0, tzinfo=timezone.utc)
        conn = FakeConn(
            [{"time": stored, "user_id": "lamp-1", "label": "good", "confidence": 0.8}]
        )
        self.use_conn(conn)
        created = self.client.post(
            "/events",
            json={
                "time": "2026-10-18T02:00:00Z",
                "user_id": "lamp-1",
                "label": "good",
                "confidence": 0.8,
                "blink_gap": 6.5,
                "blinks_per_minute": 12,
            },
        )
        self.assertEqual(created.status_code, 201)
        sql, params = conn.queries[0]
        self.assertIn("blink_gap", sql)
        self.assertEqual(params[-2:], (6.5, 12))

        when = datetime(2026, 10, 18, 2, 1, tzinfo=timezone.utc)
        live_conn = FakeConn(
            [
                [
                    {
                        "time": when,
                        "label": "good",
                        "confidence": 0.8,
                        "blink_gap": 6.5,
                        "blinks_per_minute": 12,
                    }
                ]
            ]
        )
        self.use_conn(live_conn)
        live = self.client.get("/users/lamp-1/live")
        self.assertEqual(live.status_code, 200)
        event = live.json()["events"][0]
        self.assertEqual(event["posture"], 80)
        self.assertEqual(event["blink_gap"], 6.5)
        self.assertEqual(event["blinks_per_minute"], 12)
        self.assertIn("blink_gap", live_conn.queries[0][0])

    def test_live_reads_recent_scores(self):
        when = datetime(2026, 10, 18, 1, 0, tzinfo=timezone.utc)
        conn = FakeConn([[{"time": when, "label": "slouching", "confidence": 0.42}]])
        self.use_conn(conn)
        response = self.client.get("/users/lamp-1/live")
        self.assertEqual(response.status_code, 200)
        event = response.json()["events"][0]
        self.assertEqual(event["posture"], 42)
        self.assertEqual(event["label"], "slouching")
        self.assertIn("posture_events", conn.queries[0][0])

    def test_hours_out_of_range(self):
        conn = FakeConn([])
        self.use_conn(conn)
        self.assertEqual(self.client.get("/users/user_1/timeline?hours=0").status_code, 422)
        self.assertEqual(self.client.get("/users/user_1/summary?hours=200").status_code, 422)
        self.assertEqual(conn.queries, [])

    def test_missing_database_url_does_not_connect(self):
        env = os.environ.copy()
        env.pop("DATABASE_URL", None)
        with patch.dict(os.environ, env, clear=True):
            with patch.object(main.psycopg2, "connect", side_effect=AssertionError("connected")):
                response = self.client.get("/users/user_1/timeline")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "DATABASE_URL is not set")

    def test_cors_allows_static_origin(self):
        conn = FakeConn([[]])
        self.use_conn(conn)
        response = self.client.get(
            "/users/user_1/timeline",
            headers={"Origin": "https://nohunch.club"},
        )
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        preflight = self.client.options(
            "/events",
            headers={
                "Origin": "https://nohunch.club",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertIn(preflight.status_code, (200, 204))
        self.assertEqual(preflight.headers["access-control-allow-origin"], "*")
        self.assertIn("POST", preflight.headers["access-control-allow-methods"])

    def test_dashboard_contract(self):
        html = (REPO_ROOT / "web" / "index.html").read_text(encoding="utf-8")
        self.assertEqual((REPO_ROOT / "index.html").read_text(encoding="utf-8"), html)
        self.assertIn('const API_BASE = "https://posture-api-x1my.onrender.com"', html)
        self.assertNotIn("posture-api-x1my.onrender.com/", html)
        self.assertLess(html.index("API_BASE"), html.index("<body>"))
        self.assertIn('value="user_1"', html)
        self.assertIn('value="user_2"', html)
        self.assertIn("/live", html)
        self.assertNotIn('id="hours"', html)
        self.assertIn("/points?hours=", html)
        self.assertIn("/leaderboard?hours=", html)
        self.assertIn("percent_good", html)
        self.assertIn("most_common_bad_label", html)
        self.assertIn("good_samples", html)
        self.assertIn("bad_samples", html)
        self.assertIn("chart.umd.min.js", html)
        self.assertNotIn("package.json", html)


if __name__ == "__main__":
    unittest.main()
