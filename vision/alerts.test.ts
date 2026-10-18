import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReading,
  BLINK_GAP_MS,
  BREAK_DURATION_MS,
  BREAK_EVERY_MS,
  COOLDOWN_MS,
  initialAlertState,
  noteBlink,
  startBreak,
  tick,
  type Reading,
} from "./alerts";
import { contactSheetPrompt, parseDeskContent, tokenCost } from "./desk";
import { selectWindow } from "./frames";

function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    faceVisible: true,
    blinkCount: 0,
    postureScore: 90,
    head: "upright",
    shoulders: "level",
    degraded: false,
    clipEndedAt: 10_000,
    ...overrides,
  };
}

test("a stare of 5 seconds buzzes once, then waits out the cooldown", () => {
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

test("a minute under 20 blinks beeps, and 20 blinks stays quiet", () => {
  let sparse = initialAlertState(0);
  for (let i = 1; i <= 19; i++) sparse = noteBlink(sparse, i * 3_000).state;
  const low = tick(sparse, 60_000);
  assert.equal(low.buzz, "B");
  assert.equal(low.note, "Under 20 blinks in the last minute.");
  assert.equal(low.state.blinksPerMinute, 19);

  const held = tick(low.state, 70_000);
  assert.equal(held.buzz, null);

  let steady = initialAlertState(0);
  for (let i = 1; i <= 20; i++) steady = noteBlink(steady, i * 2_800).state;
  const enough = tick(steady, 60_000);
  assert.equal(enough.buzz, null);
  assert.equal(enough.state.blinksPerMinute, 20);

  const early = tick(initialAlertState(0), BLINK_GAP_MS);
  assert.equal(early.note, "You've been staring.");
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

  const late = applyReading(
    initialAlertState(0),
    reading({ blinkCount: 1, clipEndedAt: 1_000 }),
    8_000,
  );
  assert.equal(late.state.secondsSinceBlink, 0);
  assert.equal(late.state.lastBlinkAt, 8_000);
  assert.equal(late.state.blinksPerMinute, 1);
});

test("a camera blink resets the clock even after the face was missing", () => {
  const hidden = applyReading(initialAlertState(0), reading({ faceVisible: false }), 4_000);
  assert.equal(hidden.state.phase, "no-face");
  const blinked = noteBlink(hidden.state, 9_000);
  assert.equal(blinked.state.phase, "live");
  assert.equal(blinked.state.secondsSinceBlink, 0);
  assert.equal(blinked.state.lastBlinkAt, 9_000);
  assert.equal(blinked.state.blinksPerMinute, 1);

  const sheet = applyReading(blinked.state, reading({ blinkCount: 0 }), 10_000);
  assert.ok(sheet.state.secondsSinceBlink < 1.1);
  assert.equal(sheet.state.blinksPerMinute, 1);

  const resting = startBreak(initialAlertState(0), 1_000);
  assert.equal(noteBlink(resting.state, 2_000).state.phase, "break");
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

test("a score of 60 is already bad posture", () => {
  let state = initialAlertState(0);
  let buzz: string | null = null;
  for (let i = 1; i <= 3; i++) {
    const step = applyReading(
      state,
      reading({ postureScore: 60, blinkCount: 1, clipEndedAt: i * 1_000 }),
      i * 1_000,
    );
    state = step.state;
    buzz = step.buzz;
  }
  assert.equal(buzz, "P");

  let upright = initialAlertState(0);
  for (let i = 1; i <= 3; i++) {
    const step = applyReading(
      upright,
      reading({ postureScore: 75, blinkCount: 1, clipEndedAt: i * 1_000 }),
      i * 1_000,
    );
    upright = step.state;
    assert.equal(step.buzz, null);
  }
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

  const later = tick(third.state, 3_000 + 15_000);
  assert.equal(later.buzz, "P");
  const soon = tick(later.state, 3_000 + 15_000 + 5_000);
  assert.notEqual(soon.buzz, "P");
  assert.equal(soon.state.lastPostureAlertAt, later.state.lastPostureAlertAt);
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

test("the live clock advances without a new score", () => {
  const state = initialAlertState(1_000);
  const step = tick(state, 3_500);
  assert.equal(step.buzz, null);
  assert.equal(step.state.secondsSinceBlink, 2.5);
});

test("a missing face keeps the clock frozen", () => {
  const hidden = applyReading(
    initialAlertState(0),
    reading({ faceVisible: false, clipEndedAt: 1_000 }),
    1_000,
  );
  const later = tick(hidden.state, 5_000);
  assert.equal(later.state.phase, "no-face");
  assert.equal(later.state.secondsSinceBlink, hidden.state.secondsSinceBlink);
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

test("a held close stays a blink until the eyes open", () => {
  const prompt = contactSheetPrompt(4, 250);
  assert.match(prompt, /A held close is still a blink/);
  assert.match(prompt, /does not end until the eyes open/);
  assert.match(prompt, /eyes_closed is true/);
  assert.doesNotMatch(prompt, /fully close and open/);
});

test("closed eyes count as one blink and the stare clock waits for them to open", () => {
  const start = initialAlertState(0);
  const closed = applyReading(start, reading({ blinkCount: 0, eyesClosed: true }), 4_000);
  assert.equal(closed.buzz, null);
  assert.equal(closed.state.eyesShut, true);
  assert.equal(closed.state.blinksPerMinute, 1);
  assert.equal(closed.state.lastBlinkAt, 0);
  assert.equal(closed.state.secondsSinceBlink, 4);

  const still = applyReading(closed.state, reading({ blinkCount: 0, eyesClosed: true }), 9_000);
  assert.equal(still.buzz, null);
  assert.equal(still.state.blinksPerMinute, 1);
  assert.equal(still.state.lastBlinkAt, 0);
  assert.equal(still.state.secondsSinceBlink, 4);

  const quiet = tick(still.state, 12_000);
  assert.equal(quiet.buzz, null);
  assert.equal(quiet.state.secondsSinceBlink, 4);

  const opened = applyReading(quiet.state, reading({ blinkCount: 0, eyesClosed: false }), 13_000);
  assert.equal(opened.state.eyesShut, false);
  assert.equal(opened.state.lastBlinkAt, 13_000);
  assert.equal(opened.state.secondsSinceBlink, 0);
  assert.equal(opened.state.blinksPerMinute, 1);
});

test("desk JSON is clamped and rejected when a field is missing", () => {
  const parsed = parseDeskContent(
    '```json\n{"face_visible":true,"blink_count":9,"posture_score":0,"head":"forward","shoulders":"tilted"}\n```',
  );
  assert.deepEqual(parsed, {
    face_visible: true,
    blink_count: 4,
    eyes_closed: false,
    posture_score: 1,
    head: "forward",
    shoulders: "tilted",
  });
  assert.deepEqual(
    parseDeskContent(
      '{"face_visible":true,"blink_count":0,"posture_score":8,"head":"upright","shoulders":"level"}',
    ),
    {
      face_visible: true,
      blink_count: 0,
      eyes_closed: false,
      posture_score: 8,
      head: "upright",
      shoulders: "level",
    },
  );
  assert.equal(
    parseDeskContent(
      '{"face_visible":true,"blink_count":0,"posture_score":73,"head":"upright","shoulders":"level"}',
    )?.posture_score,
    73,
  );
  assert.equal(parseDeskContent('{"face_visible":true}'), null);
  assert.ok(tokenCost(1_000_000, 0) - 0.15 < 1e-9);
});
