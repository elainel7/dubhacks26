import assert from "node:assert/strict";
import test from "node:test";
import {
  BLINK_REFRACTORY_MS,
  blinkGapSeconds,
  initialBlinkTrack,
  initialBlinkWatch,
  postureHonkDue,
  shownGapAt,
  stareChirpDue,
  takeBoardGap,
  trackBlink,
  watchBlink,
} from "./blink-track";

test("a soft closure counts on the second shut frame and then holds", () => {
  const first = trackBlink(initialBlinkTrack(), 0.55, 1_000);
  assert.equal(first.blinked, false);

  const second = trackBlink(first.track, 0.6, 1_040);
  assert.equal(second.blinked, true);

  const held = trackBlink(second.track, 0.9, 1_200);
  assert.equal(held.blinked, false);
});

test("one hard closure counts immediately", () => {
  const step = trackBlink(initialBlinkTrack(), 0.8, 1_000);
  assert.equal(step.blinked, true);
});

test("the lids have to open before the next blink, and the refractory holds", () => {
  const fired = trackBlink(initialBlinkTrack(), 0.8, 1_000);
  const opened = trackBlink(fired.track, 0.2, 1_100);
  assert.equal(opened.track.armed, true);

  const early = trackBlink(opened.track, 0.8, 1_200);
  assert.equal(early.blinked, false);

  const reopened = trackBlink(early.track, 0.2, 1_300);
  const later = trackBlink(reopened.track, 0.8, 1_000 + BLINK_REFRACTORY_MS);
  assert.equal(later.blinked, true);
});

test("the stare clock resets when the lids open, and a held close does not run it", () => {
  const shut = watchBlink(initialBlinkWatch(), 0.8, true, 5_000);
  assert.equal(shut.committed, false);
  assert.equal(shut.watch.holding, true);
  assert.equal(blinkGapSeconds(shut.watch, 9_000), 0);

  const still = watchBlink(shut.watch, 0.9, false, 9_200);
  assert.equal(still.committed, false);
  assert.equal(still.watch.marks.length, 0);

  const open = watchBlink(shut.watch, 0.1, true, 5_200);
  assert.equal(open.committed, true);
  assert.equal(open.watch.marks[0], 5_200);
  assert.equal(blinkGapSeconds(open.watch, 8_200), 3);
});

test("a climbing board gap does not overwrite a laptop blink", () => {
  let watch = initialBlinkWatch();
  let previous: number | null = null;
  const seeded = takeBoardGap(watch, 90, 100_000, previous);
  watch = seeded.watch;
  previous = seeded.previousBoardGap;
  assert.equal(blinkGapSeconds(watch, 103_000), 93);

  const climbed = takeBoardGap(watch, 96, 106_000, previous);
  watch = climbed.watch;
  previous = climbed.previousBoardGap;
  assert.equal(watch.marks.length, 1);

  const shut = watchBlink(watch, 0.85, true, 106_500);
  const opened = watchBlink(shut.watch, 0.1, true, 106_700);
  watch = opened.watch;
  assert.equal(blinkGapSeconds(watch, 108_000), 1.3);

  const stale = takeBoardGap(watch, 99, 109_000, previous);
  assert.equal(stale.watch.marks.length, opened.watch.marks.length);
  assert.equal(blinkGapSeconds(stale.watch, 109_000), 2.3);

  const caught = takeBoardGap(stale.watch, 0.4, 110_000, stale.previousBoardGap);
  assert.equal(caught.watch.marks.length, stale.watch.marks.length + 1);
  assert.ok(Math.abs((blinkGapSeconds(caught.watch, 110_000) ?? 0) - 0.4) < 0.05);
});

test("the chirp fires at every five second mark", () => {
  const under = stareChirpDue(0, 4.9, false);
  assert.equal(under.fire, false);
  assert.equal(under.index, 0);

  const five = stareChirpDue(0, 5, false);
  assert.equal(five.fire, true);
  assert.equal(five.index, 1);

  const still = stareChirpDue(1, 9.9, false);
  assert.equal(still.fire, false);

  const ten = stareChirpDue(1, 10, false);
  assert.equal(ten.fire, true);
  assert.equal(ten.index, 2);

  const fifteen = stareChirpDue(2, 15.2, false);
  assert.equal(fifteen.fire, true);
  assert.equal(fifteen.index, 3);

  const held = stareChirpDue(1, 12, true);
  assert.equal(held.fire, false);
  assert.equal(held.index, 1);

  const reset = stareChirpDue(3, 0.2, false);
  assert.equal(reset.index, 0);
  assert.equal(reset.fire, false);
});

test("a slouch asks for another honk every fifteen seconds", () => {
  const early = postureHonkDue(1_000, 10_000, true, 0);
  assert.equal(early.ask, false);

  const first = postureHonkDue(1_000, 16_000, true, 0);
  assert.equal(first.ask, true);

  const soon = postureHonkDue(1_000, 18_000, true, 16_000);
  assert.equal(soon.ask, false);

  const again = postureHonkDue(1_000, 21_000, true, 16_000);
  assert.equal(again.ask, true);

  const fixed = postureHonkDue(1_000, 40_000, false, 21_000);
  assert.equal(fixed.badSince, null);
  assert.equal(fixed.ask, false);
});

test("a chart point uses the blink that happened before it", () => {
  const marks = [1_000, 8_000];
  assert.equal(shownGapAt(marks, 90, 500), 90);
  assert.equal(shownGapAt(marks, 90, 4_000), 3);
  assert.equal(shownGapAt(marks, null, 9_000), 1);
});
