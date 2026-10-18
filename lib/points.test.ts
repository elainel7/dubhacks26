import assert from "node:assert/strict";
import test from "node:test";
import {
  dayStreakDetail,
  flowDetail,
  formatMultiplier,
  freshUprightEvent,
  goalFraction,
  isUprightPosture,
  levelFraction,
  toastForPointEvent,
  uprightPointsToast,
} from "./points";

test("an upright saved score is above 60 and not a forward head", () => {
  assert.equal(isUprightPosture({ face: true, posture: 61, head: "upright" }), true);
  assert.equal(isUprightPosture({ face: true, posture: 90, head: "unknown" }), true);
  assert.equal(isUprightPosture({ face: true, posture: 60, head: "upright" }), false);
  assert.equal(isUprightPosture({ face: true, posture: 80, head: "forward" }), false);
  assert.equal(isUprightPosture({ face: false, posture: 90, head: "upright" }), false);
  assert.equal(isUprightPosture({ face: true, posture: Number.NaN, head: "upright" }), false);
});

test("the live toast uses base points times the flow multiplier", () => {
  assert.equal(formatMultiplier(1), "1");
  assert.equal(formatMultiplier(1.5), "1.5");
  assert.equal(formatMultiplier(2), "2");
  assert.equal(formatMultiplier(3), "3");
  assert.equal(uprightPointsToast(1), "+10 points ×1");
  assert.equal(uprightPointsToast(1.5), "+15 points ×1.5");
  assert.equal(uprightPointsToast(2), "+20 points ×2");
  assert.equal(uprightPointsToast(3), "+30 points ×3");
  assert.equal(toastForPointEvent({ points: 15, reason: "Upright minute ×1.5" }), "+15 points ×1.5");
  assert.equal(toastForPointEvent({ points: 10, reason: "Upright minute ×1" }), "+10 points ×1");
  assert.equal(toastForPointEvent({ points: 15, reason: "Quick fix" }), null);
  assert.equal(toastForPointEvent({ points: 0, reason: "Upright minute ×1" }), null);
});

test("only a fresh upright minute becomes a toast", () => {
  const now = Date.parse("2026-10-18T18:00:00Z");
  const recent = [
    { time: "2026-10-18T17:58:00Z", points: 100, reason: "Daily goal" },
    { time: "2026-10-18T17:58:00Z", points: 15, reason: "Upright minute ×1.5" },
    { time: "2026-10-18T12:00:00Z", points: 30, reason: "Upright minute ×3" },
  ];
  assert.equal(freshUprightEvent(recent, now)?.reason, "Upright minute ×1.5");
  assert.equal(freshUprightEvent(recent, now + 10 * 60 * 1000), null);
});

test("goal and level fractions stay between zero and one", () => {
  assert.equal(goalFraction(0, 60), 0);
  assert.equal(goalFraction(30, 60), 0.5);
  assert.equal(goalFraction(90, 60), 1);
  assert.equal(goalFraction(10, 0), 0);
  assert.equal(levelFraction(0, 100), 0);
  assert.equal(levelFraction(25, 75), 0.25);
  assert.equal(levelFraction(10, 0), 1);
});

test("streak copy explains the next step", () => {
  assert.equal(dayStreakDetail(0, 4), "30 upright minutes starts a day streak.");
  assert.equal(dayStreakDetail(2, 30), "Today is in the streak.");
  assert.equal(dayStreakDetail(2, 29), "1 more upright minute today extends it.");
  assert.equal(flowDetail(0, 1, 0), "Sit upright to start a streak.");
  assert.equal(flowDetail(0, 1, 12), "No live streak. Best is 12 minutes.");
  assert.equal(flowDetail(8, 1.5, 40), "8 minutes at ×1.5. Best is 40.");
  assert.equal(flowDetail(1, 1, 1), "1 minute at ×1. Best is 1.");
});
