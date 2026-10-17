export type Timed<T> = T & { timestampMs: number };

/** Evenly thin a capture buffer down to `max` frames. A span over 4s is degraded. */
export function selectWindow<T>(
  frames: Timed<T>[],
  max = 8,
): { frames: Timed<T>[]; degraded: boolean; spanMs: number } {
  if (frames.length === 0) {
    return { frames: [], degraded: false, spanMs: 0 };
  }

  const spanMs = frames[frames.length - 1].timestampMs - frames[0].timestampMs;
  const degraded = spanMs > 4_000;

  if (frames.length <= max) {
    return { frames: frames.slice(), degraded, spanMs };
  }

  const picked: Timed<T>[] = [];
  const seen = new Set<number>();
  const last = frames.length - 1;
  for (let i = 0; i < max; i++) {
    const index = Math.round((i * last) / (max - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(frames[index]);
  }

  return { frames: picked, degraded, spanMs };
}
