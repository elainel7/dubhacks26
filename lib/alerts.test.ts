import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReading,
  BLINK_GAP_MS,
  BREAK_DURATION_MS,
  BREAK_EVERY_MS,
  COOLDOWN_MS,
  initialAlertState,
  startBreak,
  tick,
  type Reading,
} from "./alerts";
import { parseDeskContent, tokenCost } from "./desk";
import { selectWindow } from "./frames";

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    faceVisible: true,
    blinkCount: 0,
    postureScore: 8,
    head: "upright",
    shoulders: "level",
    degraded: false,
    clipEndedAt: 10_000,
    ...overrides,
  };
}

test("a stare of 8 seconds buzzes once, then waits out the cooldown", () => {
  const start = 1_000;
  let state = initialAlertState(start);
  const first = applyReading(
    state,
    reading({ clipEndedAt: start + BLINK_GAP_MS }),
    start + BLINK_GAP_MS,
  );
  assert.equal(first.buzz, "B");
  state = first.state;

  const second = applyReading(
    state,
    reading({ clipEndedAt: start + BLINK_GAP_MS + 2_000 }),
    start + BLINK_GAP_MS + 2_000,
  );
  assert.equal(second.buzz, null);

  const later = applyReading(
    second.state,
    reading({ clipEndedAt: start + BLINK_GAP_MS + COOLDOWN_MS + 1_000 }),
    start + BLINK_GAP_MS + COOLDOWN_MS + 1_000,
  );
  assert.equal(later.buzz, "B");
});

test("a blink resets the stare clock", () => {
  const start = 5_000;
  const state = initialAlertState(start);
  const blinked = applyReading(
    state,
    reading({ blinkCount: 1, clipEndedAt: start + 10_000 }),
    start + 10_000,
  );
  assert.equal(blinked.buzz, null);
  assert.equal(blinked.state.secondsSinceBlink, 0);
  assert.equal(blinked.state.blinksPerMinute, 1);
});

test("a missing face freezes the clock and stays quiet", () => {
  const start = 0;
  const seen = applyReading(
    initialAlertState(start),
    reading({ clipEndedAt: 2_000, blinkCount: 1 }),
    2_000,
  );
  const hidden = applyReading(
    seen.state,
    reading({ faceVisible: false, blinkCount: 0, clipEndedAt: 20_000 }),
    20_000,
  );
  assert.equal(hidden.buzz, null);
  assert.equal(hidden.state.phase, "no-face");
  assert.equal(hidden.state.secondsSinceBlink, seen.state.secondsSinceBlink);
  assert.equal(hidden.state.postureScore, null);
});

test("three low scores buzz posture, and the cooldown holds", () => {
  let state = initialAlertState(0);
  let buzz: string | null = null;
  for (let i = 1; i <= 3; i++) {
    const step = applyReading(
      state,
      reading({ postureScore: 3, blinkCount: 1, clipEndedAt: i * 1_000 }),
      i * 1_000,
    );
    state = step.state;
    buzz = step.buzz;
  }
  assert.equal(buzz, "P");
  assert.equal(state.badPostureStreak, 0);

  const held = applyReading(
    state,
    reading({ postureScore: 2, blinkCount: 1, clipEndedAt: 4_000 }),
    4_000,
  );
  const again = applyReading(
    held.state,
    reading({ postureScore: 2, blinkCount: 1, clipEndedAt: 5_000 }),
    5_000,
  );
  const third = applyReading(
    again.state,
    reading({ postureScore: 2, blinkCount: 1, clipEndedAt: 6_000 }),
    6_000,
  );
  assert.equal(third.buzz, null);
});

test("a long window does not fire a blink alert", () => {
  const start = 0;
  const step = applyReading(
    initialAlertState(start),
    reading({ degraded: true, clipEndedAt: start + 12_000 }),
    start + 12_000,
  );
  assert.equal(step.buzz, null);
  assert.ok(step.state.secondsSinceBlink >= 8);
});

test("a blink inside a long window still clears the stare", () => {
  const step = applyReading(
    initialAlertState(0),
    reading({ degraded: true, blinkCount: 2, clipEndedAt: 9_000 }),
    9_000,
  );
  assert.equal(step.buzz, null);
  assert.equal(step.state.secondsSinceBlink, 0);
  assert.equal(step.state.blinksPerMinute, 2);
});

test("break silences scores and ends after 20 seconds", () => {
  const started = startBreak(initialAlertState(0), 1_000);
  assert.equal(started.buzz, "R");
  const during = applyReading(
    started.state,
    reading({ clipEndedAt: 5_000, postureScore: 1 }),
    5_000,
  );
  assert.equal(during.buzz, null);
  assert.equal(during.state.phase, "break");

  const ended = tick(started.state, 1_000 + BREAK_DURATION_MS);
  assert.equal(ended.state.phase, "live");
  assert.equal(ended.buzz, null);
});

test("the 20 minute mark starts a break", () => {
  const state = initialAlertState(0);
  const step = tick(state, BREAK_EVERY_MS);
  assert.equal(step.buzz, "R");
  assert.equal(step.state.phase, "break");
});

test("frame selection keeps both ends and flags a long span", () => {
  const frames = Array.from({ length: 20 }, (_, index) => ({
    timestampMs: index * 300,
    id: index,
  }));
  const selected = selectWindow(frames, 8);
  assert.equal(selected.frames.length, 8);
  assert.equal(selected.frames[0].id, 0);
  assert.equal(selected.frames[7].id, 19);
  assert.equal(selected.degraded, true);

  const tight = selectWindow(
    [0, 250, 500, 750].map((timestampMs) => ({ timestampMs })),
    8,
  );
  assert.equal(tight.frames.length, 4);
  assert.equal(tight.degraded, false);
});

test("desk JSON is clamped and rejected when a field is missing", () => {
  const parsed = parseDeskContent(
    '```json\n{"face_visible":true,"blink_count":9,"posture_score":0,"head":"forward","shoulders":"tilted"}\n```',
  );
  assert.deepEqual(parsed, {
    face_visible: true,
    blink_count: 6,
    posture_score: 1,
    head: "forward",
    shoulders: "tilted",
  });
  assert.equal(parseDeskContent('{"face_visible":true}'), null);
  assert.ok(tokenCost(1_000_000, 0) - 0.15 < 1e-9);
});
