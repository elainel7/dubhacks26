import { normalizeDeviceId } from "@/lib/device-id";
import type { DeskScore } from "@/vision/desk";

/** Labels already stored by the posture API and scripts/seed.py. */
export const POSTURE_LABELS = ["good", "slouching", "leaning_forward", "head_tilt"] as const;

export type PostureLabel = (typeof POSTURE_LABELS)[number];

export type StoredPostureEvent = {
  time: string;
  user_id: string;
  label: PostureLabel;
  confidence: number;
};

export const SAVED_NOTE = "saved to Tiger Data";
export const UNSAVED_NOTE = "couldn't save";

export const DEFAULT_POSTURE_API_BASE = "https://posture-api-x1my.onrender.com";

export function isPostureLabel(value: string): value is PostureLabel {
  return (POSTURE_LABELS as readonly string[]).includes(value);
}

/**
 * good at posture_score >= 6. A forward head or any lower score is slouching.
 * A hidden face is not an event.
 */
export function postureLabel(score: {
  face_visible: boolean;
  posture_score: number;
  head?: string;
}): PostureLabel | null {
  if (score.face_visible !== true) return null;
  if (!Number.isFinite(score.posture_score)) return null;
  if (score.posture_score >= 6) return "good";
  return "slouching";
}

export function postureConfidence(postureScore: number) {
  if (!Number.isFinite(postureScore)) return null;
  const confidence = Number((Math.round(postureScore) / 10).toFixed(1));
  if (confidence < 0 || confidence > 1) return null;
  return confidence;
}

export function postureEventFromScore(
  score: Pick<DeskScore, "face_visible" | "posture_score" | "head">,
  deviceId: string | null,
  at: Date = new Date(),
): StoredPostureEvent | null {
  if (!deviceId) return null;
  const id = normalizeDeviceId(deviceId);
  if (!id) return null;
  const label = postureLabel(score);
  if (!label) return null;
  const confidence = postureConfidence(score.posture_score);
  if (confidence === null) return null;
  return {
    time: at.toISOString(),
    user_id: id,
    label,
    confidence,
  };
}

export function parseStoredEvent(value: unknown): { event: StoredPostureEvent } | { message: string } {
  if (!value || typeof value !== "object") {
    return { message: "Send a posture event as JSON." };
  }
  const record = value as Record<string, unknown>;
  const deviceId = typeof record.user_id === "string" ? normalizeDeviceId(record.user_id) : null;
  if (!deviceId) {
    return { message: "The device id must use letters, numbers, hyphens, or underscores." };
  }
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!isPostureLabel(label)) {
    return { message: "label must be good, slouching, leaning_forward, or head_tilt." };
  }
  if (
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    return { message: "confidence must be a number from 0 to 1." };
  }

  let time: string;
  if (record.time === undefined) {
    time = new Date().toISOString();
  } else if (typeof record.time !== "string" || Number.isNaN(Date.parse(record.time))) {
    return { message: "time must be an ISO timestamp." };
  } else {
    time = new Date(record.time).toISOString();
  }

  return {
    event: {
      time,
      user_id: deviceId,
      label,
      confidence: record.confidence,
    },
  };
}

export function postureApiBase(env: NodeJS.ProcessEnv = process.env) {
  return (env.POSTURE_API_BASE || DEFAULT_POSTURE_API_BASE).replace(/\/$/, "");
}

export async function forwardPostureEvent(
  event: StoredPostureEvent,
  options?: { fetchImpl?: typeof fetch; apiBase?: string },
): Promise<Response> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const apiBase = (options?.apiBase ?? postureApiBase()).replace(/\/$/, "");
  try {
    const upstream = await fetchImpl(`${apiBase}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      return Response.json(
        { error: "upstream", message: "The posture API rejected this score." },
        { status: 502 },
      );
    }
    let saved: unknown = null;
    try {
      saved = await upstream.json();
    } catch {
      saved = { ok: true };
    }
    return Response.json(saved, { status: 201 });
  } catch {
    return Response.json(
      { error: "upstream", message: "Could not reach the posture API." },
      { status: 502 },
    );
  }
}
