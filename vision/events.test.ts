import assert from "node:assert/strict";
import test from "node:test";
import { readStoredDeviceId } from "../lib/device-id";
import { POST } from "../app/api/events/route";
import {
  postureConfidence,
  postureEventFromScore,
  postureLabel,
  SAVED_NOTE,
  UNSAVED_NOTE,
  type StoredPostureEvent,
} from "./events";
import type { DeskScore } from "./desk";

function score(overrides: Partial<DeskScore> = {}): DeskScore {
  return {
    face_visible: true,
    blink_count: 0,
    eyes_closed: false,
    posture_score: 8,
    head: "upright",
    shoulders: "level",
    ...overrides,
  };
}

test("a score of 6 or more is good, and the confidence is the score over 10", () => {
  assert.equal(postureLabel(score({ posture_score: 6, head: "forward" })), "good");
  assert.equal(postureLabel(score({ posture_score: 10 })), "good");
  assert.equal(postureConfidence(6), 0.6);
  assert.equal(postureConfidence(10), 1);
  const event = postureEventFromScore(score({ posture_score: 6 }), " desk-lamp_01 ", new Date("2026-10-17T20:00:00Z"));
  assert.deepEqual(event, {
    time: "2026-10-17T20:00:00.000Z",
    user_id: "desk-lamp_01",
    label: "good",
    confidence: 0.6,
  });
});

test("a forward head or any score below 6 is slouching", () => {
  assert.equal(postureLabel(score({ posture_score: 5, head: "forward" })), "slouching");
  assert.equal(postureLabel(score({ posture_score: 1, head: "upright", shoulders: "tilted" })), "slouching");
  assert.equal(postureLabel(score({ posture_score: 4, head: "unknown" })), "slouching");
  assert.equal(postureConfidence(4), 0.4);
  const event = postureEventFromScore(
    score({ posture_score: 4, head: "forward" }),
    "user_1",
    new Date("2026-10-17T20:00:00Z"),
  );
  assert.equal(event?.label, "slouching");
  assert.equal(event?.confidence, 0.4);
  assert.equal(event?.user_id, "user_1");
});

test("a hidden face or a missing device id is not an event", () => {
  assert.equal(postureLabel(score({ face_visible: false, posture_score: 5 })), null);
  assert.equal(postureEventFromScore(score({ face_visible: false }), "desk-lamp_01"), null);
  assert.equal(postureEventFromScore(score(), null), null);
  assert.equal(postureEventFromScore(score(), "bad id"), null);
  assert.equal(postureEventFromScore(score({ posture_score: 11 }), "desk-lamp_01"), null);
});

test("the camera reads the device id saved by the gate", () => {
  const storage = new Map<string, string>([["perch-device", " desk-lamp_01 "]]);
  assert.equal(readStoredDeviceId({ getItem: (key) => storage.get(key) ?? null }), "desk-lamp_01");
  assert.equal(readStoredDeviceId({ getItem: () => "has spaces" }), null);
  assert.equal(readStoredDeviceId(null), null);
});

test("save notes stay short", () => {
  assert.equal(SAVED_NOTE, "saved to Tiger Data");
  assert.equal(UNSAVED_NOTE, "couldn't save");
});

function jsonRequest(body: unknown) {
  return new Request("http://perch.local/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/events forwards one event to the posture API", async (t) => {
  const calls: { url: string; body: StoredPostureEvent }[] = [];
  const original = globalThis.fetch;
  const previous = process.env.POSTURE_API_BASE;
  process.env.POSTURE_API_BASE = "https://posture-api-x1my.onrender.com/";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as StoredPostureEvent });
    return new Response(JSON.stringify({ user_id: "desk-lamp_01", label: "slouching", confidence: 0.3 }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.POSTURE_API_BASE;
    else process.env.POSTURE_API_BASE = previous;
  });

  const response = await POST(
    jsonRequest({
      time: "2026-10-17T20:00:00Z",
      user_id: "desk-lamp_01",
      label: "slouching",
      confidence: 0.3,
    }),
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as { user_id: string; label: string; confidence: number };
  assert.equal(body.user_id, "desk-lamp_01");
  assert.equal(body.label, "slouching");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://posture-api-x1my.onrender.com/events");
  assert.equal(calls[0].body.user_id, "desk-lamp_01");
  assert.equal(calls[0].body.label, "slouching");
  assert.equal(calls[0].body.confidence, 0.3);
  assert.equal(calls[0].body.time, "2026-10-17T20:00:00.000Z");
});

test("POST /api/events rejects a bad payload before calling the API", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("upstream should not be called");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  const junk = await POST(new Request("http://perch.local/api/events", { method: "POST", body: "{" }));
  assert.equal(junk.status, 400);
  assert.match(((await junk.json()) as { message: string }).message, /JSON/);

  const badId = await POST(jsonRequest({ user_id: "has spaces", label: "good", confidence: 0.5 }));
  assert.equal(badId.status, 400);
  assert.match(((await badId.json()) as { message: string }).message, /device id/);

  const badLabel = await POST(jsonRequest({ user_id: "desk-lamp_01", label: "forward", confidence: 0.5 }));
  assert.equal(badLabel.status, 400);
  assert.match(((await badLabel.json()) as { message: string }).message, /slouching/);

  const badConfidence = await POST(
    jsonRequest({ user_id: "desk-lamp_01", label: "good", confidence: 1.2 }),
  );
  assert.equal(badConfidence.status, 400);
  assert.match(((await badConfidence.json()) as { message: string }).message, /0 to 1/);
});

test("POST /api/events reports a failed write without throwing", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  const response = await POST(
    jsonRequest({
      user_id: "user_2",
      label: "head_tilt",
      confidence: 0,
      time: "2026-10-17T20:00:00Z",
    }),
  );
  assert.equal(response.status, 502);
  const body = (await response.json()) as { error: string; message: string };
  assert.equal(body.error, "upstream");
  assert.match(body.message, /Could not reach/);
});
