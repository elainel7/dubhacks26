/** Posture from the laptop camera. A held slouch keeps a low score. */

export type FacePoint = { x: number; y: number; z?: number };

export type PostureReading = {
  score: number;
  head: "upright" | "forward";
};

export type PostureTrack = { score: number | null };

const NOSE = 1;
const BROW = 10;
const CHIN = 152;
const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const LEFT_EAR = 234;
const RIGHT_EAR = 454;

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

/**
 * Front-camera posture. Nose drop, nose-closer-than-ears, a low face, and a
 * large face each pull the score down. The same landmarks always return the
 * same score, so holding a slouch does not drift back up.
 */
export function postureFromLandmarks(points: FacePoint[] | null | undefined): PostureReading | null {
  if (!points || points.length <= RIGHT_EAR) return null;
  const brow = points[BROW];
  const chin = points[CHIN];
  const nose = points[NOSE];
  const leftEye = points[LEFT_EYE];
  const rightEye = points[RIGHT_EYE];
  const leftEar = points[LEFT_EAR];
  const rightEar = points[RIGHT_EAR];
  if (!brow || !chin || !nose || !leftEye || !rightEye) return null;
  const faceH = chin.y - brow.y;
  if (!(faceH > 0.08)) return null;
  const eyeY = (leftEye.y + rightEye.y) / 2;
  const drop = (nose.y - eyeY) / faceH;
  const midY = (brow.y + chin.y) / 2;
  let forwardZ = 0;
  if (typeof nose.z === "number" && typeof leftEar?.z === "number" && typeof rightEar?.z === "number") {
    forwardZ = (leftEar.z + rightEar.z) / 2 - nose.z;
  }
  const dropPenalty = clamp01((drop - 0.34) / 0.12);
  const zPenalty = clamp01((forwardZ - 0.14) / 0.12);
  const lowPenalty = clamp01((midY - 0.58) / 0.14);
  const sizePenalty = clamp01((faceH - 0.46) / 0.14);
  const cues = [dropPenalty, zPenalty, lowPenalty, sizePenalty];
  const strongest = Math.max(...cues);
  const average = cues.reduce((sum, cue) => sum + cue, 0) / cues.length;
  const weight = strongest * 0.8 + average * 0.2;
  const score = clamp(Math.round(100 - weight * 95), 1, 100);
  return { score, head: score <= 60 ? "forward" : "upright" };
}

/** Fall quickly when the pose gets worse. Rise slowly, so one upright frame cannot erase a slouch. */
export function notePostureSample(track: PostureTrack, sample: number | null): PostureTrack {
  if (sample == null || !Number.isFinite(sample)) return track;
  if (track.score == null || !Number.isFinite(track.score)) return { score: Math.round(sample) };
  const keep = sample < track.score ? 0.45 : 0.9;
  return { score: Math.round(track.score * keep + sample * (1 - keep)) };
}

export type SavedPosturePoint = { time: string; posture: number | null; label?: string };

/** While the camera is on, the live tail is the laptop score. Earlier saved points stay. */
export function postureChartPoints<T extends SavedPosturePoint>(
  saved: T[],
  local: { t: number; score: number }[],
  sessionStart: number | null,
): { time: string; posture: number; label: string }[] {
  const history = saved
    .filter((event) => typeof event.posture === "number" && Number.isFinite(event.posture))
    .map((event) => ({
      time: event.time,
      posture: event.posture as number,
      label: event.label ?? (event.posture != null && event.posture <= 60 ? "slouching" : "good"),
    }));
  if (sessionStart == null || local.length === 0) return history;
  const prior = history.filter((event) => new Date(event.time).getTime() < sessionStart);
  const live = local.map((point) => ({
    time: new Date(point.t).toISOString(),
    posture: point.score,
    label: point.score <= 60 ? "slouching" : "good",
  }));
  return prior.concat(live);
}
