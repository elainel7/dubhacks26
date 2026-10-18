"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FootageToggle } from "@/components/footage-toggle";
import { getFootageServerSnapshot, getFootageSnapshot, subscribeFootage } from "@/components/footage-session";
import { rememberDevice } from "@/components/site-nav";

type LiveEvent = {
  time: string;
  label: string;
  posture: number | null;
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

function PostureScoreChart({ events }: { events: LiveEvent[] }) {
  const width = 720;
  const height = 280;
  const padLeft = 46;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const scores = events.map((event) => event.posture ?? 0);

  function xAt(index: number) {
    if (scores.length === 1) return padLeft + innerWidth / 2;
    return padLeft + (index * innerWidth) / (scores.length - 1);
  }

  function yAt(value: number) {
    return padTop + innerHeight - (value / 100) * innerHeight;
  }

  const path = scores
    .map((score, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(1)} ${yAt(score).toFixed(1)}`)
    .join(" ");

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full sm:h-72"
        role="img"
        aria-label="Posture score from 1 to 100 over the last 10 minutes"
      >
        <title>Posture score, 1 to 100</title>
        {[100, 60, 0].map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="currentColor"
              strokeOpacity={tick === 60 ? 0.45 : 0.12}
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
          Score
        </text>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
        {tickIndexes(events.length).map((index) => {
          const anchor = index === 0 ? "start" : index === events.length - 1 ? "end" : "middle";
          return (
            <text
              key={`${events[index].time}-${index}`}
              x={xAt(index)}
              y={height - 10}
              textAnchor={anchor}
              fill="currentColor"
              fontSize="12"
              className="text-muted-foreground"
            >
              {formatClock(events[index].time)}
            </text>
          );
        })}
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        Each point is one score saved by the ESP32. 60 is the line between upright and poor posture.
      </figcaption>
    </figure>
  );
}

export function DeviceChart({ deviceId }: { deviceId: string }) {
  const [events, setEvents] = useState<LiveEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blink = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot).liveScore;

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
          <p className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">Device id</p>
          <h1 className="mt-1 text-4xl break-all text-foreground sm:text-5xl">{deviceId}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            The last 10 minutes of scores. The chart asks Tiger Data every second. A new point is saved after four frames, about twice as often as an eight-frame sheet.
          </p>
        </div>
        <FootageToggle />
      </div>

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
                {blink && Number.isFinite(blink.gap) ? `${blink.gap} s` : "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Over 5 seconds is the fast beep. The board screen does not show this.</p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Blinks this minute</h2>
              <p className="mt-2 font-heading text-4xl tabular-nums text-foreground">
                {blink && Number.isFinite(blink.rate) ? blink.rate : "—"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">From the latest sheet.</p>
            </article>
          </section>

          <section className="rounded-2xl bg-card px-4 py-5 ring-1 ring-foreground/10 sm:px-5">
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
              <PostureScoreChart events={events ?? []} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
