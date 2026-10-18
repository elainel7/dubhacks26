import assert from "node:assert/strict";
import test from "node:test";
import {
  notePostureSample,
  postureChartPoints,
  postureFromLandmarks,
  type FacePoint,
  type PostureTrack,
} from "./posture-face";

function face(spec: {
  browY: number;
  chinY: number;
  eyeY: number;
  noseY: number;
  noseZ?: number;
  earZ?: number;
}): FacePoint[] {
  const points: FacePoint[] = Array.from({ length: 455 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[10] = { x: 0.5, y: spec.browY, z: 0 };
  points[152] = { x: 0.5, y: spec.chinY, z: 0 };
  points[33] = { x: 0.4, y: spec.eyeY, z: 0 };
  points[263] = { x: 0.6, y: spec.eyeY, z: 0 };
  points[1] = { x: 0.5, y: spec.noseY, z: spec.noseZ ?? 0 };
  points[234] = { x: 0.3, y: spec.eyeY, z: spec.earZ ?? 0 };
  points[454] = { x: 0.7, y: spec.eyeY, z: spec.earZ ?? 0 };
  return points;
}

const upright = face({ browY: 0.28, chinY: 0.62, eyeY: 0.4, noseY: 0.5, noseZ: -0.04, earZ: 0.03 });
const slouch = face({ browY: 0.36, chinY: 0.86, eyeY: 0.5, noseY: 0.72, noseZ: -0.22, earZ: 0.06 });

test("an upright face scores well above the poor-posture line", () => {
  const reading = postureFromLandmarks(upright);
  assert.ok(reading);
  assert.ok(reading.score > 80);
  assert.equal(reading.head, "upright");
});

test("the same slouch stays low instead of bouncing back to good", () => {
  const once = postureFromLandmarks(slouch);
  assert.ok(once);
  assert.ok(once.score <= 60);
  assert.equal(once.head, "forward");
  let track: PostureTrack = { score: null };
  for (let i = 0; i < 12; i += 1) {
    track = notePostureSample(track, postureFromLandmarks(slouch)?.score ?? null);
  }
  assert.ok(track.score != null && track.score <= 60);
  const spiked = notePostureSample(track, 100);
  assert.ok(spiked.score != null && spiked.score <= 60);
});

test("sitting back up can recover, and a missing face holds the last score", () => {
  let track: PostureTrack = { score: 30 };
  track = notePostureSample(track, null);
  assert.equal(track.score, 30);
  for (let i = 0; i < 40; i += 1) {
    track = notePostureSample(track, postureFromLandmarks(upright)?.score ?? null);
  }
  assert.ok(track.score != null && track.score > 75);
});

test("the live chart keeps the camera score and drops board scores from this session", () => {
  const saved = [
    { time: "2026-10-18T14:00:00.000Z", posture: 80, label: "good" },
    { time: "2026-10-18T14:00:04.000Z", posture: 60, label: "slouching" },
    { time: "2026-10-18T14:00:08.000Z", posture: 80, label: "good" },
  ];
  const sessionStart = Date.parse("2026-10-18T14:00:05.000Z");
  const points = postureChartPoints(saved, [
    { t: sessionStart + 1000, score: 32 },
    { t: sessionStart + 2000, score: 32 },
  ], sessionStart);
  assert.deepEqual(points.map((point) => point.posture), [80, 60, 32, 32]);
  assert.equal(points[2].label, "slouching");
  assert.equal(points[3].label, "slouching");
});
