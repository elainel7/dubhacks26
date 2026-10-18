"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FootageToggle } from "@/components/footage-toggle";
import { getFootageServerSnapshot, getFootageSnapshot, subscribeFootage } from "@/components/footage-session";
import { Leaderboard } from "@/components/leaderboard-list";
import { PointsPanel } from "@/components/points-panel";
import { shownGapAt } from "@/vision/blink-track";
import { rememberDevice } from "@/components/site-nav";

type LiveEvent = {
  time: string;
  label: string;
  posture: number | null;
  blink_gap?: number | null;
  blinks_per_minute?: number | null;
};

type Payload = {
  events?: LiveEvent[];
  message?: string;
};

function formatPostureLabel(label: string) {
  return label.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatClock(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function tickIndexes(count: number) {
  if (count <= 1) return [0];
  const slots = Math.min(4, count);
  const indexes: number[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    indexes.push(Math.round((slot * (count - 1)) / (slots - 1)));
  }
  return [...new Set(indexes)];
}

function summarize(events: LiveEvent[]) {
  const good = events.filter((event) => event.label === "good").length;
  const bad = events.length - good;
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.label === "good") continue;
    counts.set(event.label, (counts.get(event.label) ?? 0) + 1);
  }
  let problem: string | null = null;
  let problemCount = 0;
  for (const [label, count] of counts) {
    if (count > problemCount) {
      problem = label;
      problemCount = count;
    }
  }
  return {
    good,
    bad,
    percent: events.length ? Math.round((1000 * good) / events.length) / 10 : null,
    problem,
  };
}

function SeriesChart({
  times,
  values,
  yMax,
  ticks,
  mark,
  yLabel,
  strokeClass,
  ariaLabel,
  title,
}: {
  times: string[];
  values: Array<number | null>;
  yMax: number;
  ticks: number[];
  mark: number | null;
  yLabel: string;
  strokeClass: string;
  ariaLabel: string;
  title: string;
}) {
  const width = 720;
  const height = 280;
  const padLeft = 46;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  function xAt(index: number) {
    if (values.length === 1) return padLeft + innerWidth / 2;
    return padLeft + (index * innerWidth) / (values.length - 1);
  }

  function yAt(value: number) {
    const clamped = Math.max(0, Math.min(yMax, value));
    return padTop + innerHeight - (clamped / yMax) * innerHeight;
  }

  const segments: string[] = [];
  let drawing = false;
  values.forEach((value, index) => {
    if (value == null || Number.isNaN(value)) {
      drawing = false;
      return;
    }
    segments.push(`${drawing ? "L" : "M"}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)}`);
    drawing = true;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full sm:h-64" role="img" aria-label={ariaLabel}>
      <title>{title}</title>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={yAt(tick)}
            y2={yAt(tick)}
            stroke="currentColor"
            strokeOpacity={tick === mark ? 0.45 : 0.12}
            className="text-foreground"
          />
          <text
            x={padLeft - 8}
            y={yAt(tick)}
            textAnchor="end"
            dominantBaseline="middle"
            fill="currentColor"
            fontSize="12"
            className="text-muted-foreground"
          >
            {tick}
          </text>
        </g>
      ))}
      <text
        x="14"
        y={padTop + innerHeight / 2}
        fill="currentColor"
        fontSize="12"
        textAnchor="middle"
        transform={`rotate(-90 14 ${padTop + innerHeight / 2})`}
        className="text-muted-foreground"
      >
        {yLabel}
      </text>
      <path d={segments.join(" ")} fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" className={strokeClass} />
      {tickIndexes(times.length).map((index) => {
        const anchor = index === 0 ? "start" : index === times.length - 1 ? "end" : "middle";
        return (
          <text
            key={`${times[index]}-${index}`}
            x={xAt(index)}
            y={height - 10}
            textAnchor={anchor}
            fill="currentColor"
            fontSize="12"
            className="text-muted-foreground"
          >
            {formatClock(times[index])}
          </text>
        );
      })}
    </svg>
  );
}

export function DeviceChart({ deviceId }: { deviceId: string }) {
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const footage = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot);
  const blink = footage.liveScore;
  const blinkLive = footage.blink;

  useEffect(() => {
    rememberDevice(deviceId);
    let ignore = false;
    let pending = false;

    async function load() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/posture/${encodeURIComponent(deviceId)}`, { cache: "no-store" });
        const body = (await response.json()) as Payload;
        if (!response.ok) throw new Error(body.message ?? "Could not load this device.");
        if (!ignore) {
          setEvents(body.events ?? []);
          setError(null);
        }
      } catch (cause: unknown) {
        if (!ignore) {
          setError(cause instanceof Error ? cause.message : "Could not load this device.");
        }
      } finally {
        pending = false;
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [deviceId]);

  const summary = events ? summarize(events) : null;
  const savedBlink = [...(events ?? [])].reverse().find((event) => event.blink_gap != null || event.blinks_per_minute != null);
  const blinkGap = blinkLive ? blinkLive.gap : blink && Number.isFinite(blink.gap) ? blink.gap : savedBlink?.blink_gap;
  const blinkRate = blinkLive
    ? blinkLive.rate
    : blink && Number.isFinite(blink.rate)
      ? blink.rate
      : savedBlink?.blinks_per_minute;
  const blinkMarks = blinkLive?.marks ?? [];
  const blinkGaps = (events ?? []).map((event) =>
    shownGapAt(blinkMarks, typeof event.blink_gap === "number" ? event.blink_gap : null, new Date(event.time).getTime()),
  );
  const hasBlinks = blinkGaps.some((gap) => gap != null);
  const blinkMax = hasBlinks ? Math.max(10, ...blinkGaps.filter((gap): gap is number => gap != null)) : 10;
  const blinkTop = Math.ceil(blinkMax);
  const latest = events?.at(-1);
  const remindBlink = !blinkLive?.holding && typeof blinkGap === "number" && blinkGap >= 5;
  const remindPosture =
    latest != null &&
    ((latest.posture != null && latest.posture <= 60) || latest.label === "slouching" || latest.label === "leaning_forward");
  const reminder = !events?.length
    ? "Waiting for a score."
    : [remindBlink ? "Blink" : null, remindPosture ? "Sit up taller" : null].filter(Boolean).join(" · ") || "Good";
  const percent = summary?.percent === null || summary?.percent === undefined ? "—" : `${summary.percent}%`;
  const percentTone =
    summary?.percent === null || summary?.percent === undefined
      ? "text-foreground"
      : summary.percent >= 50
        ? "text-good"
        : "text-bad";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-xl flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Device id</p>
          <h1 className="mt-1 text-3xl break-all text-foreground sm:text-4xl">{deviceId}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Posture comes from the board. Blinks are counted on this computer, so the timer resets when your eyes open.
          </p>
          <p
            className={`font-heading text-4xl tracking-tight ${
              reminder === "Good" ? "text-good" : reminder === "Waiting for a score." ? "text-foreground" : "text-bad"
            }`}
            role="status"
          >
            {reminder}
          </p>
        </div>
        <FootageToggle />
      </div>

      <PointsPanel deviceId={deviceId} />

      {error ? (
        <div role="alert" className="rounded-2xl border border-bad/30 bg-card px-5 py-4">
          <h2 className="text-xl text-foreground">Could not load this device id</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {events === null && !error ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading the latest scores…
        </p>
      ) : null}

      {summary ? (
        <>
          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl bg-card px-4 py-5 ring-1 ring-foreground/10 sm:px-5">
              <div className="mb-2 flex flex-col gap-1 px-1">
                <h2 className="text-2xl text-foreground">Posture</h2>
                <p className="text-sm text-muted-foreground">1 is collapsed. 100 is upright. The mark at 60 is poor posture.</p>
              </div>
              {events && events.length === 0 ? (
                <div className="flex min-h-48 flex-col items-start justify-center rounded-xl bg-muted/70 px-5 py-8">
                  <p className="font-heading text-2xl text-foreground">No scores yet</p>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    Nothing for {deviceId} in the last 10 minutes. A new score shows up here within a second of the ESP32 saving it.
                  </p>
                </div>
              ) : (
                <SeriesChart
                  times={(events ?? []).map((event) => event.time)}
                  values={(events ?? []).map((event) => event.posture ?? 0)}
                  yMax={100}
                  ticks={[100, 60, 0]}
                  mark={60}
                  yLabel="Score"
                  strokeClass="text-primary"
                  ariaLabel="Posture score from 1 to 100 over the last 10 minutes"
                  title="Posture score, 1 to 100"
                />
              )}
            </article>
            <article className="rounded-2xl bg-card px-4 py-5 ring-1 ring-foreground/10 sm:px-5">
              <div className="mb-2 flex flex-col gap-1 px-1">
                <h2 className="text-2xl text-foreground">Blinks</h2>
                <p className="text-sm text-muted-foreground">Seconds since the last blink. The mark at 5 is the fast beep.</p>
              </div>
              {hasBlinks ? (
                <SeriesChart
                  times={(events ?? []).map((event) => event.time)}
                  values={blinkGaps}
                  yMax={blinkTop}
                  ticks={[...new Set([blinkTop, 5, 0])].sort((a, b) => b - a)}
                  mark={5}
                  yLabel="Seconds"
                  strokeClass="text-bad"
                  ariaLabel="Seconds since the last blink over the last 10 minutes"
                  title="Seconds since the last blink"
                />
              ) : (
                <div className="flex min-h-48 flex-col items-start justify-center rounded-xl bg-muted/70 px-5 py-8">
                  <p className="font-heading text-2xl text-foreground">No blink times yet</p>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    Blink times are saved with each new score. Older points on this chart only have posture.
                  </p>
                </div>
              )}
            </article>
          </section>

          <section aria-label="Posture summary" className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Percent upright</h2>
              <p className={`mt-2 font-heading text-4xl tabular-nums ${percentTone}`}>{percent}</p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Good and bad scores</h2>
              <p className="mt-2 font-heading text-3xl leading-tight">
                <span className="text-good tabular-nums">{summary.good}</span>
                <span className="font-sans text-base font-medium text-muted-foreground"> good</span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-bad tabular-nums">{summary.bad}</span>
                <span className="font-sans text-base font-medium text-muted-foreground"> bad</span>
              </p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Most common problem</h2>
              <p className="mt-2 font-heading text-3xl leading-tight text-foreground">
                {summary.problem ? formatPostureLabel(summary.problem) : "None"}
              </p>
            </article>
          </section>

          <section aria-label="Blinks" className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Since last blink</h2>
              <p className="mt-2 font-heading text-4xl tabular-nums text-foreground">
                {typeof blinkGap === "number" ? `${blinkGap.toFixed(1)} s` : "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Resets when your eyes open. Over 5 seconds is the fast beep.</p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Blinks this minute</h2>
              <p className="mt-2 font-heading text-4xl tabular-nums text-foreground">
                {typeof blinkRate === "number" ? blinkRate : "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">From the latest saved score.</p>
            </article>
          </section>
        </>
      ) : null}

      <Leaderboard heading="section" />
    </div>
  );
}
