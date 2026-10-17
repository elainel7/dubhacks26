import assert from "node:assert/strict";
import test from "node:test";
import { BLINK_REFRACTORY_MS, initialBlinkTrack, trackBlink } from "./blink-track";

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
