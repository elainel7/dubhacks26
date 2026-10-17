"use client";

import { useEffect, useState } from "react";
import { rememberDevice } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

const WINDOWS = [1, 6, 24] as const;

function pretty(label: string) {
  return label.replaceAll("_", " ");
}

function formatBucket(iso: string, hours: number) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (hours > 12) {
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Chart({ points, hours }: { points: Point[]; hours: number }) {
  const width = 640;
  const height = 220;
  const pad = 28;
  const max = Math.max(1, ...points.map((point) => Math.max(point.good_samples, point.bad_samples)));
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;

  function path(key: "good_samples" | "bad_samples") {
    return points
      .map((point, index) => {
        const x = pad + index * step;
        const y = height - pad - (point[key] / max) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const ticks = [0, Math.floor(points.length / 2), points.length - 1].filter(
    (index, position, all) => all.indexOf(index) === position && index >= 0,
  );

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img" aria-label="Good and bad samples over time">
      <path d={path("good_samples")} fill="none" className="stroke-chart-2" strokeWidth="2" />
      <path d={path("bad_samples")} fill="none" className="stroke-chart-1" strokeWidth="2" />
      {ticks.map((index) => (
        <text key={index} x={pad + index * step} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {formatBucket(points[index].bucket, hours)}
        </text>
      ))}
    </svg>
  );
}

export function DeviceChart({ uuid }: { uuid: string }) {
  const [hours, setHours] = useState<(typeof WINDOWS)[number]>(6);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    rememberDevice(uuid);
    const controller = new AbortController();
    let ignore = false;
    fetch(`/api/posture/${encodeURIComponent(uuid)}?hours=${hours}`, { signal: controller.signal })
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
  }, [uuid, hours]);

  const summary = payload?.summary;
  const points = payload?.timeline?.points ?? [];
  const percent =
    summary?.percent_good === null || summary?.percent_good === undefined ? "—" : `${summary.percent_good}%`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Device {uuid}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Numbers only. The camera picture stays on the Camera page.</p>
        </div>
        <div className="flex gap-2">
          {WINDOWS.map((window) => (
            <Button
              key={window}
              type="button"
              size="sm"
              variant={hours === window ? "default" : "outline"}
              onClick={() => {
                setLoading(true);
                setHours(window);
              }}
            >
              {window}h
            </Button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading readings…</p> : null}
      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>Could not load readings</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!loading && !error && summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Time upright</CardDescription>
                <CardTitle className="font-mono text-3xl tabular-nums">{percent}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Samples</CardDescription>
                <CardTitle className="text-xl">
                  {summary.good_samples} good · {summary.bad_samples} bad
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Most common problem</CardDescription>
                <CardTitle className="text-xl">
                  {summary.most_common_bad_label ? pretty(summary.most_common_bad_label) : "None"}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Each minute</CardTitle>
              <CardDescription>The darker line is upright samples. The lighter line is bad posture.</CardDescription>
            </CardHeader>
            <CardContent>
              {points.length === 0 ? (
                <p className="text-sm text-muted-foreground">No readings for this device in the last {hours} hours.</p>
              ) : (
                <>
                  <Chart points={points} hours={hours} />
                  <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
                    <span>Upright</span>
                    <span>Bad posture</span>
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
