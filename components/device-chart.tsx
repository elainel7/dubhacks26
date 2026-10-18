"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FootageToggle } from "@/components/footage-toggle";
import { getFootageServerSnapshot, getFootageSnapshot, subscribeFootage } from "@/components/footage-session";
import { rememberDevice } from "@/components/site-nav";
import { Button } from "@/components/ui/button";

type Point = {
  bucket: string;
  good_samples: number;
  bad_samples: number;
};

type Summary = {
  samples: number;
  good_samples: number;
  bad_samples: number;
  percent_good: number | null;
  most_common_bad_label: string | null;
};

type Payload = {
  timeline?: { hours?: number; points?: Point[] };
  summary?: Summary;
  message?: string;
};

const WINDOWS = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
] as const;

function formatPostureLabel(label: string) {
  return label.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBucket(iso: string, hours: number) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (hours > 12) {
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric" });
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function PostureTimelineChart({ points, hours }: { points: Point[]; hours: number }) {
  const width = 720;
  const height = 280;
  const padLeft = 46;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 36;
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const peak = Math.max(1, ...points.map((point) => Math.max(point.good_samples, point.bad_samples)));
  const yMax = Math.max(1, peak);
  const yTicks = [...new Set([yMax, Math.round(yMax / 2), 0])];

  function xAt(index: number) {
    if (points.length === 1) return padLeft + innerWidth / 2;
    return padLeft + (index * innerWidth) / (points.length - 1);
  }

  function yAt(value: number) {
    return padTop + innerHeight - (value / yMax) * innerHeight;
  }

  function path(key: "good_samples" | "bad_samples") {
    return points
      .map((point, index) => {
        const command = index === 0 ? "M" : "L";
        return `${command}${xAt(index).toFixed(1)} ${yAt(point[key]).toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-64 w-full sm:h-72"
        role="img"
        aria-label="Good posture and bad posture, in samples per minute"
      >
        <title>Good posture and bad posture, in samples per minute</title>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="currentColor"
              strokeOpacity={tick === 0 ? 0.35 : 0.12}
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
          Samples
        </text>
        <path d={path("good_samples")} fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" className="text-good" />
        <path
          d={path("bad_samples")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="7 5"
          className="text-bad"
        />
        {tickIndexes(points.length).map((index) => {
          const anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
          return (
            <text
              key={index}
              x={xAt(index)}
              y={height - 10}
              textAnchor={anchor}
              fill="currentColor"
              fontSize="12"
              className="text-muted-foreground"
            >
              {formatBucket(points[index].bucket, hours)}
            </text>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-foreground">
        <span className="inline-flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-good" />
          </svg>
          Good posture
        </span>
        <span className="inline-flex items-center gap-2">
          <svg width="28" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="28"
              y2="4"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="6 4"
              className="text-bad"
            />
          </svg>
          Bad posture
        </span>
      </figcaption>
    </figure>
  );
}

export function DeviceChart({ deviceId }: { deviceId: string }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]["hours"]>(6);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const footage = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot);

  useEffect(() => {
    if (!footage.collecting) return;
    const timer = window.setInterval(() => setReload((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, [footage.collecting]);

  useEffect(() => {
    rememberDevice(deviceId);
    const controller = new AbortController();
    let ignore = false;
    fetch(`/api/posture/${encodeURIComponent(deviceId)}?hours=${hours}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as Payload;
        if (!response.ok) throw new Error(body.message ?? "Could not load this device.");
        return body;
      })
      .then((body) => {
        if (ignore) return;
        setPayload(body);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (ignore || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setError(cause instanceof Error ? cause.message : "Could not load this device.");
        setPayload(null);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [deviceId, hours, reload]);

  const summary = payload?.summary;
  const points = payload?.timeline?.points ?? [];
  const percent =
    summary?.percent_good === null || summary?.percent_good === undefined ? "—" : `${summary.percent_good}%`;
  const percentTone =
    summary?.percent_good === null || summary?.percent_good === undefined
      ? "text-foreground"
      : summary.percent_good >= 50
        ? "text-good"
        : "text-bad";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">Device id</p>
          <h1 className="mt-1 text-4xl break-all text-foreground sm:text-5xl">{deviceId}</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Percent upright, good and bad posture, and the most common problem. Footage stays off this
            screen.
          </p>
          <FootageToggle />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Time window">
          {WINDOWS.map((window) => (
            <Button
              key={window.hours}
              type="button"
              variant={hours === window.hours ? "default" : "outline"}
              aria-pressed={hours === window.hours}
              className="h-10 px-3"
              onClick={() => {
                setLoading(true);
                setHours(window.hours);
              }}
            >
              {window.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
          </div>
          <p className="text-sm text-muted-foreground">Loading posture for this device id…</p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-bad/30 bg-card px-5 py-4">
          <h2 className="text-xl text-foreground">Could not load this device id</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {!loading && !error && summary ? (
        <>
          <section aria-label="Posture summary" className="grid gap-3 sm:grid-cols-3">
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Percent upright</h2>
              <p className={`mt-2 font-heading text-4xl tabular-nums ${percentTone}`}>{percent}</p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Good and bad samples</h2>
              <p className="mt-2 font-heading text-3xl leading-tight">
                <span className="text-good tabular-nums">{summary.good_samples}</span>
                <span className="font-sans text-base font-medium text-muted-foreground"> good</span>
                <span className="text-muted-foreground"> · </span>
                <span className="text-bad tabular-nums">{summary.bad_samples}</span>
                <span className="font-sans text-base font-medium text-muted-foreground"> bad</span>
              </p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Most common problem</h2>
              <p className="mt-2 font-heading text-3xl leading-tight text-foreground">
                {summary.most_common_bad_label ? formatPostureLabel(summary.most_common_bad_label) : "None"}
              </p>
            </article>
          </section>

          <section className="rounded-2xl bg-card px-4 py-5 ring-1 ring-foreground/10 sm:px-5">
            <div className="mb-2 flex flex-col gap-1 px-1">
              <h2 className="text-2xl text-foreground">Good and bad posture</h2>
              <p className="text-sm text-muted-foreground">
                Samples each minute. The solid line is good posture. The dashed line is bad posture.
              </p>
            </div>
            {points.length === 0 ? (
              <div className="flex min-h-48 flex-col items-start justify-center rounded-xl bg-muted/70 px-5 py-8">
                <p className="font-heading text-2xl text-foreground">No readings yet</p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  No posture for device id {deviceId} in the last {hours} {hours === 1 ? "hour" : "hours"}.
                  Scores show up here after footage collection sees a face.
                </p>
              </div>
            ) : (
              <PostureTimelineChart points={points} hours={hours} />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
