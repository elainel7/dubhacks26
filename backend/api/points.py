"""Derived posture points.

Points are computed from per-minute rollups. Nothing in this module is stored.

An upright minute has at least ``MIN_SAMPLES`` samples and a good-sample ratio
of at least ``UPRIGHT_RATIO``. It earns ``BASE_POINTS``. Other minutes earn 0.

A flow streak is a run of upright minutes. A non-upright minute, or a gap of
more than ``STREAK_GAP_MINUTES`` with no considered minute, breaks it. The
multiplier steps up at minutes 5, 15, and 30.

A quick fix adds ``COMEBACK_BONUS`` once when an upright minute follows a
non-upright minute within ``COMEBACK_WINDOW_MINUTES``.

``DAILY_GOAL_MINUTES`` upright minutes in one local calendar day add
``DAILY_GOAL_BONUS`` once. The clock is ``tz`` (default America/Los_Angeles).

A day streak is consecutive local days with at least ``DAY_STREAK_MINUTES``
upright minutes. Day ``n`` of that streak adds ``n * 5%`` of that day's base
points (10 per upright minute), capped at 50%. The current day does not break
the streak until it is over.

Each minute bucket is capped at ``PER_MINUTE_CAP`` after the multiplier and
the quick fix. The daily goal and the day-streak percent are outside that cap.

XP is the total. Completing level ``n`` takes ``100 * n * (n + 1) / 2``
cumulative points. Level 1 starts at 0. Level 2 starts at 100, level 3 at 300,
level 4 at 600.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MIN_SAMPLES = 3
UPRIGHT_RATIO = 0.7
BASE_POINTS = 10
PER_MINUTE_CAP = 60

STREAK_GAP_MINUTES = 2
FLOW_TIER_1 = 1.0
FLOW_TIER_5 = 1.5
FLOW_TIER_15 = 2.0
FLOW_TIER_30 = 3.0

COMEBACK_BONUS = 15
COMEBACK_WINDOW_MINUTES = 3

DAILY_GOAL_MINUTES = 60
DAILY_GOAL_BONUS = 100

DAY_STREAK_MINUTES = 30
DAY_STREAK_STEP = 0.05
DAY_STREAK_CAP = 0.50

LEVEL_XP_UNIT = 100
DEFAULT_TZ = "America/Los_Angeles"
POINTS_DEFAULT_HOURS = 168
POINTS_MAX_HOURS = 2160
RECENT_LIMIT = 8

NIGHT_OWL_HOUR = 22
EARLY_BIRD_HOUR = 8

# Level bands, lowest level first. The last title covers every level above it.
LEVEL_TITLES: tuple[tuple[int, str], ...] = (
    (1, "Slouch Survivor"),
    (2, "Neck Rookie"),
    (3, "Desk Upright"),
    (5, "Spine Scout"),
    (7, "Posture Pro"),
    (10, "Core Keeper"),
    (13, "Spine of Steel"),
    (17, "Upright Warden"),
    (21, "Iron Vertebra"),
    (26, "Perch Legend"),
)

BADGE_SPECS: tuple[tuple[str, str, str], ...] = (
    ("first_upright", "First Upright Minute", "Earn points for one upright minute."),
    ("flow_10", "10-Minute Flow", "Stay upright for 10 minutes in a row."),
    ("flow_30", "30-Minute Flow", "Stay upright for 30 minutes in a row."),
    ("hour_of_power", "Hour of Power", "Log 60 upright minutes in a single day."),
    ("comeback_kid", "Comeback Kid", "Land 5 quick fixes."),
    ("streak_3", "Three Day Streak", "Hit 30 upright minutes three days in a row."),
    ("streak_7", "Seven Day Streak", "Hit 30 upright minutes seven days in a row."),
    ("night_owl", "Night Owl", "Earn an upright minute at 10pm or later."),
    ("early_bird", "Early Bird", "Earn an upright minute before 8am."),
)


class UnknownTimezone(ValueError):
    """The tz query value is not an IANA timezone name."""


@dataclass(frozen=True)
class MinuteBucket:
    bucket: datetime
    samples: int
    good_samples: int
    bad_samples: int = 0


@dataclass
class DayStats:
    upright: int = 0
    base_points: int = 0
    last_upright_at: datetime | None = None
    goal_minute_at: datetime | None = None
    streak_minute_at: datetime | None = None


@dataclass
class PointEvent:
    time: datetime
    points: int
    reason: str
    local_date: date
    order: int = 0


@dataclass
class _Awards:
    first_upright: datetime | None = None
    flow_10: datetime | None = None
    flow_30: datetime | None = None
    hour_of_power: datetime | None = None
    comeback_kid: datetime | None = None
    streak_3: datetime | None = None
    streak_7: datetime | None = None
    night_owl: datetime | None = None
    early_bird: datetime | None = None
    quick_fixes: list[datetime] = field(default_factory=list)


def resolve_timezone(name: str | None) -> ZoneInfo:
    cleaned = (name or DEFAULT_TZ).strip()
    if not cleaned or len(cleaned) > 64:
        raise UnknownTimezone(cleaned)
    try:
        return ZoneInfo(cleaned)
    except ZoneInfoNotFoundError as exc:
        raise UnknownTimezone(cleaned) from exc


def xp_to_complete_level(level: int) -> int:
    """Cumulative XP required to finish ``level`` and start the next one.

    This is ``100 * n * (n + 1) / 2``. Level 0 is 0, so level 1 starts at 0 XP
    and finishes at 100.
    """

    if level <= 0:
        return 0
    return LEVEL_XP_UNIT * level * (level + 1) // 2


def multiplier_for_streak(streak_minute: int) -> float:
    if streak_minute >= 30:
        return FLOW_TIER_30
    if streak_minute >= 15:
        return FLOW_TIER_15
    if streak_minute >= 5:
        return FLOW_TIER_5
    return FLOW_TIER_1


def title_for_level(level: int) -> str:
    title = LEVEL_TITLES[0][1]
    for minimum, name in LEVEL_TITLES:
        if level >= minimum:
            title = name
    return title


def level_for_xp(xp: int) -> dict:
    """Level 1 starts at 0. Completing level n costs 100*n*(n+1)/2 cumulative XP."""

    safe = max(0, int(xp))
    level = 1
    while safe >= xp_to_complete_level(level):
        level += 1
        if level > 100_000:
            break
    previous = xp_to_complete_level(level - 1)
    nxt = xp_to_complete_level(level)
    return {
        "level": level,
        "title": title_for_level(level),
        "points_into_level": safe - previous,
        "points_to_next_level": nxt - safe,
        "xp": safe,
    }


def is_upright_minute(good_samples: int, samples: int) -> bool:
    """True when the bucket meets the sample floor and the 70% good ratio.

    Compared in integers so 7/10 counts as upright. ``7/10 >= 0.7`` is not
    reliable in binary floating point.
    """

    if samples < MIN_SAMPLES or good_samples < 0:
        return False
    return good_samples * 10 >= samples * 7


def cap_minute_points(flow_points: int, extra: int = 0) -> tuple[int, int]:
    """Apply the per-minute cap. The quick fix is reduced before base points."""

    flow = max(0, int(flow_points))
    bonus = max(0, int(extra))
    if flow + bonus <= PER_MINUTE_CAP:
        return flow, bonus
    if flow >= PER_MINUTE_CAP:
        return PER_MINUTE_CAP, 0
    return flow, PER_MINUTE_CAP - flow


def day_streak_bonus(base_points: int, streak_days: int) -> tuple[int, int]:
    """Return ``(points, percent)`` for one day of a day streak.

    Percent is 5 points per streak day, capped at 50. Points round half up
    from that day's base points (10 per upright minute, before multipliers).
    """

    if base_points <= 0 or streak_days <= 0:
        return 0, 0
    percent = min(int(DAY_STREAK_CAP * 100), streak_days * int(DAY_STREAK_STEP * 100))
    bonus = (int(base_points) * percent + 50) // 100
    return bonus, percent


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _as_datetime(value) -> datetime:
    if isinstance(value, datetime):
        return _aware(value)
    if isinstance(value, str):
        text = value.replace("Z", "+00:00")
        return _aware(datetime.fromisoformat(text))
    raise TypeError("bucket time must be a datetime")


def buckets_from_rows(rows: list[dict]) -> list[MinuteBucket]:
    """Normalize aggregate rows and merge duplicate minute buckets."""

    merged: dict[datetime, MinuteBucket] = {}
    for row in rows:
        when = _as_datetime(row["bucket"]).astimezone(timezone.utc)
        samples = int(row.get("samples") or 0)
        good = int(row.get("good_samples") or 0)
        bad_raw = row.get("bad_samples")
        bad = int(bad_raw) if bad_raw is not None else max(0, samples - good)
        current = merged.get(when)
        if current is None:
            merged[when] = MinuteBucket(when, samples, good, bad)
        else:
            merged[when] = MinuteBucket(
                when,
                current.samples + samples,
                current.good_samples + good,
                current.bad_samples + bad,
            )
    return [merged[key] for key in sorted(merged)]


def _minutes_between(earlier: datetime, later: datetime) -> float:
    return (later - earlier).total_seconds() / 60.0


def _upright_reason(multiplier: float) -> str:
    if multiplier == int(multiplier):
        label = str(int(multiplier))
    else:
        label = f"{multiplier:.1f}"
    return f"Upright minute ×{label}"


def _badge(spec: tuple[str, str, str], earned_at: datetime | None) -> dict:
    badge_id, name, description = spec
    return {
        "id": badge_id,
        "name": name,
        "description": description,
        "earned": earned_at is not None,
        "earned_at": earned_at,
    }


def score_posture(rows: list[dict], tz: str | ZoneInfo | None = None, now: datetime | None = None) -> dict:
    """Score minute rows for one person. ``rows`` are ``posture_per_minute`` buckets."""

    zone = tz if isinstance(tz, ZoneInfo) else resolve_timezone(str(tz) if tz else DEFAULT_TZ)
    clock = _aware(now or datetime.now(timezone.utc))
    today = clock.astimezone(zone).date()
    buckets = buckets_from_rows(rows)
    considered = [bucket for bucket in buckets if bucket.samples >= MIN_SAMPLES]

    events: list[PointEvent] = []
    days: dict[date, DayStats] = {}
    awards = _Awards()
    streak = 0
    best = 0
    previous: datetime | None = None
    last_upright_at: datetime | None = None
    comeback_from: datetime | None = None

    for bucket in considered:
        upright = is_upright_minute(bucket.good_samples, bucket.samples)
        if previous is not None and _minutes_between(previous, bucket.bucket) > STREAK_GAP_MINUTES:
            streak = 0
        previous = bucket.bucket
        if not upright:
            streak = 0
            last_upright_at = None
            comeback_from = bucket.bucket
            continue

        streak += 1
        best = max(best, streak)
        multiplier = multiplier_for_streak(streak)
        flow = int(math.floor(BASE_POINTS * multiplier + 0.5))
        comeback = 0
        if comeback_from is not None:
            if _minutes_between(comeback_from, bucket.bucket) <= COMEBACK_WINDOW_MINUTES:
                comeback = COMEBACK_BONUS
            comeback_from = None
        flow, comeback = cap_minute_points(flow, comeback)

        local = bucket.bucket.astimezone(zone)
        local_day = local.date()
        stats = days.setdefault(local_day, DayStats())
        stats.upright += 1
        stats.base_points += BASE_POINTS
        stats.last_upright_at = bucket.bucket
        if stats.upright == DAY_STREAK_MINUTES:
            stats.streak_minute_at = bucket.bucket
        if stats.upright == DAILY_GOAL_MINUTES:
            stats.goal_minute_at = bucket.bucket

        if flow:
            events.append(PointEvent(bucket.bucket, flow, _upright_reason(multiplier), local_day, 0))
        if comeback:
            events.append(PointEvent(bucket.bucket, comeback, "Quick fix", local_day, 1))
            awards.quick_fixes.append(bucket.bucket)
        if stats.goal_minute_at == bucket.bucket:
            events.append(PointEvent(bucket.bucket, DAILY_GOAL_BONUS, "Daily goal", local_day, 2))
            if awards.hour_of_power is None:
                awards.hour_of_power = bucket.bucket

        if awards.first_upright is None:
            awards.first_upright = bucket.bucket
        if streak >= 10 and awards.flow_10 is None:
            awards.flow_10 = bucket.bucket
        if streak >= 30 and awards.flow_30 is None:
            awards.flow_30 = bucket.bucket
        if local.hour >= NIGHT_OWL_HOUR and awards.night_owl is None:
            awards.night_owl = bucket.bucket
        if local.hour < EARLY_BIRD_HOUR and awards.early_bird is None:
            awards.early_bird = bucket.bucket
        last_upright_at = bucket.bucket

    current = streak if last_upright_at is not None else 0
    if last_upright_at is not None and _minutes_between(last_upright_at, clock) > STREAK_GAP_MINUTES:
        current = 0

    day_streak = _apply_day_streak(days, today, events, awards)
    if len(awards.quick_fixes) >= 5:
        awards.comeback_kid = awards.quick_fixes[4]

    events.sort(key=lambda event: (event.time, event.order))
    total = sum(event.points for event in events)
    points_today = sum(event.points for event in events if event.local_date == today)
    today_upright = days[today].upright if today in days else 0
    progress = 0.0 if DAILY_GOAL_MINUTES <= 0 else min(1.0, today_upright / DAILY_GOAL_MINUTES)
    recent = [
        {"time": event.time, "points": event.points, "reason": event.reason}
        for event in events
        if event.points > 0
    ]

    earned = {
        "first_upright": awards.first_upright,
        "flow_10": awards.flow_10,
        "flow_30": awards.flow_30,
        "hour_of_power": awards.hour_of_power,
        "comeback_kid": awards.comeback_kid,
        "streak_3": awards.streak_3,
        "streak_7": awards.streak_7,
        "night_owl": awards.night_owl,
        "early_bird": awards.early_bird,
    }
    return {
        "total_points": total,
        "points_today": points_today,
        "today_upright_minutes": today_upright,
        "daily_goal_minutes": DAILY_GOAL_MINUTES,
        "goal_progress": round(progress, 4),
        "flow_streak_minutes": current,
        "flow_multiplier": multiplier_for_streak(current),
        "best_streak_minutes": best,
        "day_streak": day_streak,
        "level": level_for_xp(total),
        "badges": [_badge(spec, earned[spec[0]]) for spec in BADGE_SPECS],
        "recent": list(reversed(recent[-RECENT_LIMIT:])),
    }


def _apply_day_streak(
    days: dict[date, DayStats],
    today: date,
    events: list[PointEvent],
    awards: _Awards,
) -> int:
    if not days:
        return 0
    cursor = min(days)
    end = max(today, max(days))
    running = 0
    while cursor <= end:
        stats = days.get(cursor)
        upright = stats.upright if stats else 0
        if upright >= DAY_STREAK_MINUTES and stats is not None:
            running += 1
            bonus, percent = day_streak_bonus(stats.base_points, running)
            if bonus and stats.last_upright_at is not None:
                events.append(
                    PointEvent(
                        stats.last_upright_at,
                        bonus,
                        f"Day streak +{percent}%",
                        cursor,
                        3,
                    )
                )
            if running == 3 and awards.streak_3 is None:
                awards.streak_3 = stats.streak_minute_at or stats.last_upright_at
            if running == 7 and awards.streak_7 is None:
                awards.streak_7 = stats.streak_minute_at or stats.last_upright_at
        elif cursor != today:
            running = 0
        cursor += timedelta(days=1)
    return running
