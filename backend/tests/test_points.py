"""Points are derived from minute rows. These tests never open a database."""

import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

import api.main as main
import api.points as points
from tests.test_api import FakeConn

LA = ZoneInfo("America/Los_Angeles")
UTC = timezone.utc


def at_utc(minute, *, origin=None, good=5, samples=5):
    start = origin or datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
    return {
        "bucket": start + timedelta(minutes=minute),
        "good_samples": good,
        "bad_samples": samples - good,
        "samples": samples,
    }


def local_minute(when, good=5, samples=5):
    return {
        "bucket": when,
        "good_samples": good,
        "bad_samples": max(0, samples - good),
        "samples": samples,
    }


def upright_block(start, count, *, good=5, samples=5):
    return [local_minute(start + timedelta(minutes=i), good, samples) for i in range(count)]


def score(rows, now, tz="America/Los_Angeles"):
    return points.score_posture(rows, tz=tz, now=now)


class ConstantTests(unittest.TestCase):
    def test_rules_are_named_constants(self):
        self.assertEqual(points.MIN_SAMPLES, 3)
        self.assertEqual(points.UPRIGHT_RATIO, 0.7)
        self.assertEqual(points.BASE_POINTS, 10)
        self.assertEqual(points.PER_MINUTE_CAP, 60)
        self.assertEqual(points.STREAK_GAP_MINUTES, 2)
        self.assertEqual(points.COMEBACK_BONUS, 15)
        self.assertEqual(points.COMEBACK_WINDOW_MINUTES, 3)
        self.assertEqual(points.DAILY_GOAL_MINUTES, 60)
        self.assertEqual(points.DAILY_GOAL_BONUS, 100)
        self.assertEqual(points.DAY_STREAK_MINUTES, 30)
        self.assertEqual(points.DAY_STREAK_STEP, 0.05)
        self.assertEqual(points.DAY_STREAK_CAP, 0.50)
        self.assertEqual(points.DEFAULT_TZ, "America/Los_Angeles")

    def test_flow_multiplier_steps(self):
        self.assertEqual(points.multiplier_for_streak(0), 1.0)
        self.assertEqual(points.multiplier_for_streak(1), 1.0)
        self.assertEqual(points.multiplier_for_streak(4), 1.0)
        self.assertEqual(points.multiplier_for_streak(5), 1.5)
        self.assertEqual(points.multiplier_for_streak(14), 1.5)
        self.assertEqual(points.multiplier_for_streak(15), 2.0)
        self.assertEqual(points.multiplier_for_streak(29), 2.0)
        self.assertEqual(points.multiplier_for_streak(30), 3.0)
        self.assertEqual(points.multiplier_for_streak(80), 3.0)


class UprightMinuteTests(unittest.TestCase):
    def test_ratio_boundaries_use_integers(self):
        self.assertTrue(points.is_upright_minute(7, 10))
        self.assertFalse(points.is_upright_minute(6, 10))
        self.assertTrue(points.is_upright_minute(3, 3))
        self.assertFalse(points.is_upright_minute(2, 3))
        self.assertFalse(points.is_upright_minute(2, 2))
        self.assertFalse(points.is_upright_minute(0, 0))

    def test_upright_minute_earns_base_points_and_short_minutes_earn_zero(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        now = origin + timedelta(minutes=5)
        rows = [
            at_utc(0, origin=origin, good=4, samples=5),
            at_utc(1, origin=origin, good=2, samples=5),
            at_utc(2, origin=origin, good=5, samples=2),
        ]
        result = score(rows, now)
        self.assertEqual(result["total_points"], 10)
        self.assertEqual(result["recent"][0]["points"], 10)
        self.assertEqual(result["recent"][0]["reason"], "Upright minute ×1")
        self.assertGreaterEqual(result["total_points"], 0)

    def test_input_order_does_not_matter_and_duplicate_buckets_merge(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        now = origin + timedelta(minutes=2)
        rows = [
            at_utc(1, origin=origin),
            at_utc(0, origin=origin, good=2, samples=2),
            at_utc(0, origin=origin, good=2, samples=2),
        ]
        result = score(rows, now)
        # Two sparse rows at minute 0 merge into 4 good samples and count.
        self.assertEqual(result["total_points"], 20)
        self.assertEqual(result["best_streak_minutes"], 2)


class FlowStreakTests(unittest.TestCase):
    def test_multiplier_applies_across_a_long_streak(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(i, origin=origin) for i in range(32)]
        now = origin + timedelta(minutes=31)
        result = score(rows, now)
        flow = 4 * 10 + 10 * 15 + 15 * 20 + 3 * 30
        day_bonus, _percent = points.day_streak_bonus(32 * 10, 1)
        self.assertEqual(result["total_points"], flow + day_bonus)
        self.assertEqual(result["flow_streak_minutes"], 32)
        self.assertEqual(result["flow_multiplier"], 3.0)
        self.assertEqual(result["best_streak_minutes"], 32)
        self.assertTrue(any(event["reason"] == "Upright minute ×3" for event in result["recent"]))

    def test_gap_of_two_minutes_keeps_the_streak(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(0, origin=origin), at_utc(2, origin=origin)]
        result = score(rows, origin + timedelta(minutes=2))
        self.assertEqual(result["flow_streak_minutes"], 2)
        self.assertEqual(result["total_points"], 20)
        self.assertEqual(result["flow_multiplier"], 1.0)

    def test_gap_over_two_minutes_breaks_the_streak(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(i, origin=origin) for i in range(4)]
        rows.append(at_utc(7, origin=origin))
        result = score(rows, origin + timedelta(minutes=7))
        self.assertEqual(result["flow_streak_minutes"], 1)
        self.assertEqual(result["best_streak_minutes"], 4)
        self.assertEqual(result["total_points"], 50)
        self.assertEqual(result["recent"][0]["reason"], "Upright minute ×1")

    def test_non_upright_minute_breaks_the_streak(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(i, origin=origin) for i in range(5)]
        rows.append(at_utc(5, origin=origin, good=1, samples=5))
        rows.append(at_utc(6, origin=origin))
        result = score(rows, origin + timedelta(minutes=6))
        self.assertEqual(result["best_streak_minutes"], 5)
        self.assertEqual(result["flow_streak_minutes"], 1)
        # 4*10 + 15 for the fifth, then a fresh minute at ×1. Comeback is separate.
        self.assertEqual(result["total_points"], 4 * 10 + 15 + 10 + 15)

    def test_sparse_bucket_is_ignored_and_does_not_break_a_two_minute_gap(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [
            at_utc(0, origin=origin),
            at_utc(1, origin=origin, good=2, samples=2),
            at_utc(2, origin=origin),
        ]
        result = score(rows, origin + timedelta(minutes=2))
        self.assertEqual(result["flow_streak_minutes"], 2)
        self.assertEqual(result["total_points"], 20)

    def test_streak_expires_when_the_latest_minute_is_stale(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(0, origin=origin), at_utc(1, origin=origin)]
        result = score(rows, origin + timedelta(minutes=10))
        self.assertEqual(result["flow_streak_minutes"], 0)
        self.assertEqual(result["flow_multiplier"], 1.0)
        self.assertEqual(result["best_streak_minutes"], 2)


class ComebackTests(unittest.TestCase):
    def test_quick_fix_is_awarded_once_per_recovery(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [
            at_utc(0, origin=origin, good=0, samples=5),
            at_utc(1, origin=origin),
            at_utc(2, origin=origin),
            at_utc(3, origin=origin),
        ]
        result = score(rows, origin + timedelta(minutes=3))
        fixes = [event for event in result["recent"] if event["reason"] == "Quick fix"]
        self.assertEqual(len(fixes), 1)
        self.assertEqual(fixes[0]["points"], 15)
        self.assertEqual(result["total_points"], 10 + 15 + 10 + 10)

    def test_a_new_slouch_starts_another_quick_fix(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [
            at_utc(0, origin=origin, good=0, samples=5),
            at_utc(1, origin=origin),
            at_utc(2, origin=origin, good=0, samples=5),
            at_utc(3, origin=origin),
        ]
        result = score(rows, origin + timedelta(minutes=3))
        fixes = [event for event in result["recent"] if event["reason"] == "Quick fix"]
        self.assertEqual(len(fixes), 2)

    def test_quick_fix_window_is_three_minutes_inclusive(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        inside = score(
            [at_utc(0, origin=origin, good=0, samples=5), at_utc(3, origin=origin)],
            origin + timedelta(minutes=3),
        )
        outside = score(
            [at_utc(0, origin=origin, good=0, samples=5), at_utc(4, origin=origin)],
            origin + timedelta(minutes=4),
        )
        self.assertTrue(any(event["reason"] == "Quick fix" for event in inside["recent"]))
        self.assertFalse(any(event["reason"] == "Quick fix" for event in outside["recent"]))
        self.assertEqual(outside["total_points"], 10)

    def test_five_quick_fixes_earn_comeback_kid_once(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = []
        for pair in range(6):
            rows.append(at_utc(pair * 2, origin=origin, good=0, samples=5))
            rows.append(at_utc(pair * 2 + 1, origin=origin))
        result = score(rows, origin + timedelta(minutes=12))
        badge = next(item for item in result["badges"] if item["id"] == "comeback_kid")
        self.assertTrue(badge["earned"])
        self.assertEqual(badge["earned_at"], origin + timedelta(minutes=9))


class DailyGoalTests(unittest.TestCase):
    def test_daily_goal_is_awarded_once_on_the_sixtieth_minute(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(i, origin=origin) for i in range(61)]
        result = score(rows, origin + timedelta(minutes=60))
        flow = 4 * 10 + 10 * 15 + 15 * 20 + 32 * 30
        day_bonus, _percent = points.day_streak_bonus(61 * 10, 1)
        self.assertEqual(result["total_points"], flow + points.DAILY_GOAL_BONUS + day_bonus)
        self.assertEqual(result["today_upright_minutes"], 61)
        self.assertEqual(result["goal_progress"], 1.0)
        self.assertEqual(result["points_today"], result["total_points"])
        badge = next(item for item in result["badges"] if item["id"] == "hour_of_power")
        self.assertTrue(badge["earned"])
        self.assertEqual(badge["earned_at"], origin + timedelta(minutes=59))

    def test_timezone_boundary_gives_the_bonus_to_the_local_day(self):
        # 23:00–23:59 Pacific on Oct 17, then 00:00 on Oct 18. 06:59 UTC is still
        # the 17th; 07:00 UTC is the 18th.
        start = datetime(2026, 10, 17, 23, 0, tzinfo=LA)
        rows = upright_block(start, 60)
        rows.append(local_minute(datetime(2026, 10, 18, 0, 0, tzinfo=LA)))
        later = datetime(2026, 10, 18, 0, 30, tzinfo=LA)
        result = score(rows, later)
        flow_sixty = 4 * 10 + 10 * 15 + 15 * 20 + 31 * 30
        day_bonus, _percent = points.day_streak_bonus(60 * 10, 1)
        self.assertEqual(result["today_upright_minutes"], 1)
        self.assertEqual(result["points_today"], 30)
        self.assertLess(result["goal_progress"], 1)
        self.assertEqual(result["total_points"], flow_sixty + day_bonus + points.DAILY_GOAL_BONUS + 30)
        badge = next(item for item in result["badges"] if item["id"] == "hour_of_power")
        self.assertEqual(badge["earned_at"], datetime(2026, 10, 17, 23, 59, tzinfo=LA))

        still_yesterday = score(rows[:-1], datetime(2026, 10, 17, 23, 59, tzinfo=LA))
        self.assertEqual(still_yesterday["today_upright_minutes"], 60)
        self.assertEqual(still_yesterday["points_today"], flow_sixty + day_bonus + points.DAILY_GOAL_BONUS)


class DayStreakTests(unittest.TestCase):
    def _day(self, local_day, count):
        start = datetime(local_day.year, local_day.month, local_day.day, 9, 0, tzinfo=LA)
        return upright_block(start, count)

    def test_percent_applies_to_base_points_and_caps_at_fifty(self):
        rows = []
        for offset in range(11):
            rows.extend(self._day(datetime(2026, 10, 1 + offset).date(), 30))
        now = datetime(2026, 10, 11, 18, 0, tzinfo=LA)
        result = score(rows, now)
        # 30 consecutive upright minutes: minutes 15–29 are ×2, minute 30 is ×3.
        flow = 4 * 10 + 10 * 15 + 15 * 20 + 30
        base = 30 * 10
        bonuses = []
        for day_number in range(1, 12):
            percent = min(50, day_number * 5)
            bonuses.append((base * percent + 50) // 100)
        self.assertEqual(bonuses[0], 15)
        self.assertEqual(bonuses[9], 150)
        self.assertEqual(bonuses[10], 150)
        self.assertEqual(result["total_points"], flow * 11 + sum(bonuses))
        self.assertEqual(result["day_streak"], 11)
        self.assertTrue(any(event["reason"] == "Day streak +50%" for event in result["recent"]))

    def test_a_missed_calendar_day_resets_the_streak(self):
        rows = []
        rows.extend(self._day(datetime(2026, 10, 12).date(), 30))
        rows.extend(self._day(datetime(2026, 10, 14).date(), 30))
        now = datetime(2026, 10, 14, 18, 0, tzinfo=LA)
        result = score(rows, now)
        self.assertEqual(result["day_streak"], 1)
        reasons = [event["reason"] for event in result["recent"] if event["reason"].startswith("Day streak")]
        self.assertEqual(reasons, ["Day streak +5%"])

    def test_today_below_thirty_does_not_break_yesterdays_streak(self):
        rows = []
        rows.extend(self._day(datetime(2026, 10, 16).date(), 30))
        rows.extend(self._day(datetime(2026, 10, 17).date(), 40))
        rows.extend(self._day(datetime(2026, 10, 18).date(), 10))
        now = datetime(2026, 10, 18, 12, 0, tzinfo=LA)
        result = score(rows, now)
        self.assertEqual(result["day_streak"], 2)
        self.assertEqual(result["today_upright_minutes"], 10)
        day_bonuses = [event for event in result["recent"] if event["reason"].startswith("Day streak")]
        # The feed may only show today's minutes. Totals prove yesterday's bonus exists
        # and today, under 30, did not add a third bonus.
        flow_30 = 4 * 10 + 10 * 15 + 15 * 20 + 30
        flow_40 = flow_30 + 10 * 30
        flow_10 = 4 * 10 + 6 * 15
        bonuses = (300 * 5 + 50) // 100 + (400 * 10 + 50) // 100
        self.assertEqual(result["total_points"], flow_30 + flow_40 + flow_10 + bonuses)
        self.assertEqual(day_bonuses, [])

    def test_three_and_seven_day_badges_use_the_thirtieth_minute(self):
        rows = []
        for offset in range(7):
            rows.extend(self._day(datetime(2026, 10, 10 + offset).date(), 35))
        now = datetime(2026, 10, 16, 18, 0, tzinfo=LA)
        result = score(rows, now)
        three = next(item for item in result["badges"] if item["id"] == "streak_3")
        seven = next(item for item in result["badges"] if item["id"] == "streak_7")
        self.assertEqual(three["earned_at"], datetime(2026, 10, 12, 9, 29, tzinfo=LA))
        self.assertEqual(seven["earned_at"], datetime(2026, 10, 16, 9, 29, tzinfo=LA))
        self.assertEqual(result["day_streak"], 7)


class CapAndLevelTests(unittest.TestCase):
    def test_per_minute_cap_shrinks_the_quick_fix_first(self):
        self.assertEqual(points.cap_minute_points(15, 15), (15, 15))
        self.assertEqual(points.cap_minute_points(50, 15), (50, 10))
        self.assertEqual(points.cap_minute_points(80, 15), (60, 0))
        self.assertEqual(points.cap_minute_points(-5, -3), (0, 0))

        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        original = points.PER_MINUTE_CAP
        try:
            points.PER_MINUTE_CAP = 12
            rows = [at_utc(0, origin=origin, good=0, samples=5), at_utc(1, origin=origin)]
            rows.extend(at_utc(i, origin=origin) for i in range(2, 6))
            result = score(rows, origin + timedelta(minutes=5))
            # Minute 1 of the recovery is ×1 (10) plus a quick fix squeezed to 2.
            # Minutes 2-4 are 10. Minute 5 of the streak is ×1.5 (15) capped to 12.
            self.assertEqual(result["total_points"], 10 + 2 + 10 + 10 + 10 + 12)
        finally:
            points.PER_MINUTE_CAP = original

    def test_level_curve_and_titles(self):
        self.assertEqual(points.xp_to_complete_level(1), 100)
        self.assertEqual(points.xp_to_complete_level(2), 300)
        self.assertEqual(points.xp_to_complete_level(3), 600)
        self.assertEqual(points.xp_to_complete_level(4), 1000)
        self.assertEqual(points.xp_to_complete_level(25), 32500)

        start = points.level_for_xp(0)
        self.assertEqual(start["level"], 1)
        self.assertEqual(start["title"], "Slouch Survivor")
        self.assertEqual(start["points_into_level"], 0)
        self.assertEqual(start["points_to_next_level"], 100)

        second = points.level_for_xp(150)
        self.assertEqual(second["level"], 2)
        self.assertEqual(second["title"], "Neck Rookie")
        self.assertEqual(second["points_into_level"], 50)
        self.assertEqual(second["points_to_next_level"], 150)

        desk = points.level_for_xp(600)
        self.assertEqual(desk["level"], 4)
        self.assertEqual(desk["title"], "Desk Upright")
        self.assertEqual(desk["points_into_level"], 0)
        self.assertEqual(points.level_for_xp(32500)["title"], "Perch Legend")
        self.assertEqual(points.level_for_xp(32499)["title"], "Iron Vertebra")
        self.assertEqual(len(points.LEVEL_TITLES), 10)

    def test_empty_history_is_level_one_with_locked_badges(self):
        result = score([], datetime(2026, 10, 18, 18, 0, tzinfo=LA))
        self.assertEqual(result["total_points"], 0)
        self.assertEqual(result["points_today"], 0)
        self.assertEqual(result["flow_streak_minutes"], 0)
        self.assertEqual(result["day_streak"], 0)
        self.assertEqual(result["level"]["level"], 1)
        self.assertEqual(result["recent"], [])
        self.assertEqual(len(result["badges"]), 9)
        self.assertTrue(all(badge["earned"] is False and badge["earned_at"] is None for badge in result["badges"]))


class BadgeClockTests(unittest.TestCase):
    def test_night_owl_and_early_bird_follow_local_clock(self):
        rows = [
            local_minute(datetime(2026, 10, 18, 7, 59, tzinfo=LA)),
            local_minute(datetime(2026, 10, 18, 8, 0, tzinfo=LA)),
            local_minute(datetime(2026, 10, 18, 21, 59, tzinfo=LA)),
            local_minute(datetime(2026, 10, 18, 22, 0, tzinfo=LA)),
        ]
        result = score(rows, datetime(2026, 10, 18, 22, 5, tzinfo=LA))
        early = next(item for item in result["badges"] if item["id"] == "early_bird")
        night = next(item for item in result["badges"] if item["id"] == "night_owl")
        self.assertEqual(early["earned_at"], datetime(2026, 10, 18, 7, 59, tzinfo=LA))
        self.assertEqual(night["earned_at"], datetime(2026, 10, 18, 22, 0, tzinfo=LA))

    def test_flow_badges_stick_at_the_first_qualifying_minute(self):
        origin = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = [at_utc(i, origin=origin) for i in range(31)]
        result = score(rows, origin + timedelta(minutes=30))
        flow_10 = next(item for item in result["badges"] if item["id"] == "flow_10")
        flow_30 = next(item for item in result["badges"] if item["id"] == "flow_30")
        first = next(item for item in result["badges"] if item["id"] == "first_upright")
        self.assertEqual(first["earned_at"], origin)
        self.assertEqual(flow_10["earned_at"], origin + timedelta(minutes=9))
        self.assertEqual(flow_30["earned_at"], origin + timedelta(minutes=29))

    def test_unknown_timezone_is_rejected(self):
        with self.assertRaises(points.UnknownTimezone):
            points.resolve_timezone("Not/AZone")
        with self.assertRaises(points.UnknownTimezone):
            points.resolve_timezone("   ")


class PointsApiTests(unittest.TestCase):
    def setUp(self):
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

    def test_points_endpoint_uses_one_aggregate_query(self):
        bucket = datetime(2026, 10, 18, 18, 0, tzinfo=UTC)
        conn = FakeConn(
            [
                [
                    {
                        "bucket": bucket,
                        "good_samples": 8,
                        "bad_samples": 1,
                        "samples": 9,
                    },
                    {
                        "bucket": bucket + timedelta(minutes=1),
                        "good_samples": 1,
                        "bad_samples": 4,
                        "samples": 5,
                    },
                    {
                        "bucket": bucket + timedelta(minutes=2),
                        "good_samples": 9,
                        "bad_samples": 0,
                        "samples": 9,
                    },
                ]
            ]
        )
        self.use_conn(conn)
        response = self.client.get("/users/desk-lamp_01/points?hours=24&tz=America/Los_Angeles")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["user_id"], "desk-lamp_01")
        self.assertEqual(body["hours"], 24)
        self.assertEqual(body["tz"], "America/Los_Angeles")
        self.assertEqual(body["total_points"], 10 + 10 + 15)
        self.assertEqual(body["level"]["title"], "Slouch Survivor")
        self.assertTrue(body["badges"][0]["earned"])
        self.assertEqual(len(conn.queries), 1)
        sql, params = conn.queries[0]
        self.assertIn("FROM posture_per_minute", sql)
        self.assertNotIn("posture_events", sql)
        self.assertNotIn("INSERT", sql)
        self.assertEqual(params, ("desk-lamp_01", 24.0))
        self.assertFalse(conn.committed)

    def test_points_defaults_and_rejects_bad_input(self):
        conn = FakeConn([[]])
        self.use_conn(conn)
        response = self.client.get("/users/user_1/points")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["hours"], 168)
        self.assertEqual(response.json()["tz"], "America/Los_Angeles")
        self.assertEqual(response.json()["total_points"], 0)
        self.assertEqual(conn.queries[0][1], ("user_1", 168.0))

        bad_tz = self.client.get("/users/user_1/points?tz=Mars/Olympus")
        self.assertEqual(bad_tz.status_code, 400)
        self.assertEqual(self.client.get("/users/user_1/points?hours=0").status_code, 422)
        self.assertEqual(self.client.get("/users/user_1/points?hours=9000").status_code, 422)
        blank = self.client.get("/users/%20/points")
        self.assertEqual(blank.status_code, 400)

    def test_leaderboard_ranks_display_names_and_hides_user_ids(self):
        start = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)
        rows = []
        for offset in range(6):
            rows.append(
                {
                    "user_id": "user_1",
                    "display_name": "Demo User 1",
                    "bucket": start + timedelta(minutes=offset),
                    "good_samples": 5,
                    "bad_samples": 0,
                    "samples": 5,
                }
            )
        for offset in range(2):
            rows.append(
                {
                    "user_id": "user_2",
                    "display_name": "",
                    "bucket": start + timedelta(minutes=offset),
                    "good_samples": 5,
                    "bad_samples": 0,
                    "samples": 5,
                }
            )
        conn = FakeConn([rows])
        self.use_conn(conn)
        response = self.client.get("/leaderboard?hours=12&limit=10")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(conn.queries), 1)
        sql, params = conn.queries[0]
        self.assertIn("FROM posture_per_minute", sql)
        self.assertIn("JOIN users", sql)
        self.assertIn("display_name", sql)
        self.assertNotIn("posture_events", sql)
        self.assertEqual(params, (12.0,))
        self.assertEqual(
            body["leaders"],
            [
                {"rank": 1, "display_name": "Demo User 1", "points": 4 * 10 + 2 * 15},
                {"rank": 2, "display_name": "user_2", "points": 20},
            ],
        )
        self.assertNotIn("user_id", response.text)
        self.assertNotIn("confidence", response.text)

    def test_leaderboard_limit_and_cors(self):
        conn = FakeConn([[]])
        self.use_conn(conn)
        self.assertEqual(self.client.get("/leaderboard?limit=0").status_code, 422)
        self.assertEqual(self.client.get("/leaderboard?limit=80").status_code, 422)
        response = self.client.get("/leaderboard", headers={"Origin": "https://nohunch.club"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["leaders"], [])
        self.assertEqual(response.headers["access-control-allow-origin"], "*")


if __name__ == "__main__":
    unittest.main()
