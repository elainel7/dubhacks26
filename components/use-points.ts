"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getFootageServerSnapshot,
  getFootageSnapshot,
  subscribeFootage,
} from "@/components/footage-session";
import {
  freshUprightEvent,
  isUprightPosture,
  POINTS_HOURS,
  POINTS_POLL_MS,
  toastForPointEvent,
  uprightPointsToast,
  type PointsSnapshot,
} from "@/lib/points";

type LoadedPoints =
  | { id: string; status: "ready"; points: PointsSnapshot; error: null; loadedAt: number }
  | { id: string; status: "error"; points: null; error: string };

export function usePoints(deviceId: string | null) {
  const [loaded, setLoaded] = useState<LoadedPoints | null>(null);
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  const footage = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot);

  useEffect(() => {
    if (!deviceId) return;
    const controller = new AbortController();
    const requestedId = deviceId;
    let live = true;

    async function load(initial: boolean) {
      try {
        const response = await fetch(`/api/points/${encodeURIComponent(requestedId)}?hours=${POINTS_HOURS}`, {
          signal: controller.signal,
        });
        let body: PointsSnapshot & { message?: string };
        try {
          body = (await response.json()) as PointsSnapshot & { message?: string };
        } catch {
          throw new Error("Could not load points.");
        }
        if (!response.ok) throw new Error(body.message ?? "Could not load points.");
        if (live) setLoaded({ id: requestedId, status: "ready", points: body, error: null, loadedAt: Date.now() });
      } catch (cause) {
        if (!live || (cause instanceof DOMException && cause.name === "AbortError")) return;
        if (initial) {
          setLoaded({
            id: requestedId,
            status: "error",
            points: null,
            error: cause instanceof Error ? cause.message : "Could not load points.",
          });
        }
      }
    }

    void load(true);
    const timer = window.setInterval(() => void load(false), POINTS_POLL_MS);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [deviceId]);

  const ready = loaded && loaded.id === deviceId && loaded.status === "ready" ? loaded : null;
  const points = ready ? ready.points : null;
  const error = loaded && loaded.id === deviceId && loaded.status === "error" ? loaded.error : null;
  const status = !deviceId ? "idle" : points ? "ready" : error ? "error" : "loading";

  const liveScore = footage.liveScore;
  const serialKey = liveScore?.saved && isUprightPosture(liveScore) ? `serial:${liveScore.seq}` : null;
  const fresh = points && ready ? freshUprightEvent(points.recent, ready.loadedAt) : null;
  const freshKey = fresh ? `${fresh.time}|${fresh.reason}` : null;
  const toastKey = serialKey ?? freshKey;
  let toast: string | null = null;
  if (toastKey && toastKey !== hiddenKey) {
    if (serialKey && liveScore) toast = uprightPointsToast(points?.flow_multiplier ?? 1);
    else if (fresh) toast = toastForPointEvent(fresh);
  }

  useEffect(() => {
    if (!toastKey) return;
    const timer = window.setTimeout(() => setHiddenKey(toastKey), 7000);
    return () => window.clearTimeout(timer);
  }, [toastKey]);

  return {
    status,
    points,
    error,
    toast,
    dismissToast: () => {
      if (toastKey) setHiddenKey(toastKey);
    },
  } as const;
}
