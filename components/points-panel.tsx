"use client";

import Link from "next/link";
import { AwardToast } from "@/components/award-toast";
import { usePoints } from "@/components/use-points";
import {
  dayStreakDetail,
  flowDetail,
  formatMultiplier,
  goalFraction,
  levelFraction,
  type PointsSnapshot,
} from "@/lib/points";

function GoalRing({ minutes, goal }: { minutes: number; goal: number }) {
  const fraction = goalFraction(minutes, goal);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * fraction;
  return (
    <svg viewBox="0 0 120 120" className="size-28 shrink-0" role="img" aria-label={`${minutes} of ${goal} upright minutes today`}>
      <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-muted" />
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        className="stroke-good"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="58"
        textAnchor="middle"
        className="fill-foreground"
        fontSize="26"
        style={{ fontFamily: "var(--font-heading), Georgia, serif" }}
      >
        {minutes}
      </text>
      <text x="60" y="76" textAnchor="middle" className="fill-muted-foreground" fontSize="11">
        of {goal}
      </text>
    </svg>
  );
}

function Flame() {
  return (
    <svg viewBox="0 0 24 24" className="size-9 text-bad" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12.2 1.8c.3 2.4-.2 4-1.3 5.4-.8 1-.7 2 .3 2.6 1.4.8 2.2 2 2.2 3.6 0 .4 0 .8-.1 1.1.8-.9 1.2-2 1.2-3.2 0-1.2-.4-2.3-1-3.3 1.6 1.1 2.7 2.8 2.7 5.1 0 3.6-2.6 6.1-6.2 6.1S4 16.9 4 13.4c0-2.2.9-4 2.4-5.6.4 1.3 1.2 2.2 2.3 2.6-.6-1.6-.5-3.3.4-5.2 1-1.8 2.2-3 3.1-3.4z"
      />
    </svg>
  );
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function PointsBody({ points }: { points: PointsSnapshot }) {
  const into = points.level.points_into_level;
  const remaining = points.level.points_to_next_level;
  const fraction = levelFraction(into, remaining);
  const earned = points.badges.filter((badge) => badge.earned).length;

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <article className="rounded-2xl bg-card px-5 py-5 ring-1 ring-foreground/10">
          <p className="text-sm font-medium text-muted-foreground">Level {points.level.level}</p>
          <h3 className="mt-1 text-4xl text-foreground">{points.level.title}</h3>
          <p className="mt-2 font-heading text-5xl tabular-nums text-foreground">{points.total_points}</p>
          <p className="text-sm text-muted-foreground">points over the last 7 days</p>
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={into + remaining}
            aria-valuenow={into}
            aria-label={`${points.level.title}, ${remaining} points to the next level`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(fraction * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {into} into this level · {remaining} to the next
          </p>
        </article>
        <article className="flex items-center gap-4 rounded-2xl bg-card px-5 py-5 ring-1 ring-foreground/10">
          <GoalRing minutes={points.today_upright_minutes} goal={points.daily_goal_minutes} />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground">Today&apos;s goal</h3>
            <p className="mt-1 font-heading text-3xl tabular-nums text-foreground">{points.points_today}</p>
            <p className="text-sm text-muted-foreground">points today · 60 upright minutes</p>
          </div>
        </article>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <article className="flex items-start gap-3 rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
          <Flame />
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground">Flow streak</h3>
            <p className="mt-1 font-heading text-3xl tabular-nums text-foreground">
              {points.flow_streak_minutes} min · ×{formatMultiplier(points.flow_multiplier)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {flowDetail(points.flow_streak_minutes, points.flow_multiplier, points.best_streak_minutes)}
            </p>
          </div>
        </article>
        <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
          <h3 className="text-sm font-semibold text-muted-foreground">Day streak</h3>
          <p className="mt-1 font-heading text-3xl tabular-nums text-foreground">
            {points.day_streak} {points.day_streak === 1 ? "day" : "days"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {dayStreakDetail(points.day_streak, points.today_upright_minutes)}
          </p>
        </article>
      </div>

      <section className="rounded-2xl bg-card px-5 py-5 ring-1 ring-foreground/10" aria-labelledby="badges-title">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="badges-title" className="text-2xl text-foreground">
            Badges
          </h3>
          <p className="text-sm text-muted-foreground">
            {earned} of {points.badges.length} earned
          </p>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {points.badges.map((badge) => (
            <li
              key={badge.id}
              className={`rounded-xl px-3 py-3 ring-1 ${badge.earned ? "bg-accent ring-primary/15" : "bg-muted/50 ring-foreground/10"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{badge.name}</p>
                <span className={`text-xs font-bold tracking-wide uppercase ${badge.earned ? "text-good" : "text-muted-foreground"}`}>
                  {badge.earned ? "Earned" : "Locked"}
                </span>
              </div>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{badge.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-card px-5 py-5 ring-1 ring-foreground/10" aria-labelledby="feed-title">
        <h3 id="feed-title" className="text-2xl text-foreground">
          Recent points
        </h3>
        {points.recent.length === 0 ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            No upright minutes in this window yet. A minute with mostly good posture shows up here after the rollup,
            about a minute behind the camera.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-foreground/10">
            {points.recent.map((event) => (
              <li key={`${event.time}-${event.reason}`} className="flex items-baseline justify-between gap-3 py-2.5">
                <div>
                  <p className="font-semibold text-foreground">{event.reason}</p>
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={event.time}>{formatWhen(event.time)}</time>
                  </p>
                </div>
                <p className="font-heading text-xl tabular-nums text-good">+{event.points}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function PointsPanel({ deviceId }: { deviceId: string }) {
  const { status, points, error, toast, dismissToast } = usePoints(deviceId);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="points-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="points-title" className="text-3xl text-foreground">
            Points
          </h2>
        </div>
        <Link
          href="/leaderboard"
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-primary hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Leaderboard
        </Link>
      </div>

      {status === "loading" ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
          </div>
          <p className="text-sm text-muted-foreground">Loading points for this device id…</p>
        </div>
      ) : null}

      {status === "error" ? (
        <div role="alert" className="rounded-2xl border border-bad/30 bg-card px-5 py-4">
          <h3 className="text-xl text-foreground">Could not load points</h3>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {status === "ready" && points ? <PointsBody points={points} /> : null}
      <AwardToast message={toast} onDismiss={dismissToast} />
    </section>
  );
}
