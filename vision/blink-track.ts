/** Average of the two eyelid-closure scores. 0 is open, 1 is shut. */
export const BLINK_SHUT = 0.5;
/** One frame this high is enough. A softer closure has to last two frames. */
export const BLINK_HARD_SHUT = 0.75;
export const BLINK_REFRACTORY_MS = 400;

export type BlinkTrack = {
  armed: boolean;
  shutFrames: number;
  lastFireAt: number | null;
};

export function initialBlinkTrack(): BlinkTrack {
  return { armed: true, shutFrames: 0, lastFireAt: null };
}

/**
 * Fires once when the lids close. Holding them shut does not fire again.
 * The next blink can register only after the lids drop back below the
 * threshold and the refractory window has passed.
 */
export function trackBlink(track: BlinkTrack, score: number, now: number) {
  if (score < BLINK_SHUT) {
    return { track: { ...track, armed: true, shutFrames: 0 }, blinked: false };
  }

  const shutFrames = track.shutFrames + 1;
  const cooled = track.lastFireAt === null || now - track.lastFireAt >= BLINK_REFRACTORY_MS;
  const confirmed = score >= BLINK_HARD_SHUT || shutFrames >= 2;
  if (track.armed && cooled && confirmed) {
    return {
      track: { armed: false, shutFrames, lastFireAt: now },
      blinked: true,
    };
  }

  return { track: { ...track, shutFrames }, blinked: false };
}

export type BlinkWatch = {
  track: BlinkTrack;
  /** Lids are down. The stare clock stays put until they open. */
  holding: boolean;
  frozenGap: number | null;
  /** Times the lids opened after a close, in milliseconds. */
  marks: number[];
};

export function initialBlinkWatch(): BlinkWatch {
  return { track: initialBlinkTrack(), holding: false, frozenGap: null, marks: [] };
}

function trimMarks(marks: number[]) {
  return marks.length > 180 ? marks.slice(-180) : marks;
}

/**
 * Counts a blink when the lids close, and starts the stare clock again only
 * when they open. A held close is one blink and does not run the timer.
 */
export function watchBlink(watch: BlinkWatch, score: number, faceVisible: boolean, now: number) {
  if (!faceVisible) return { watch, committed: false };
  const step = trackBlink(watch.track, score, now);
  if (step.blinked) {
    const frozen = watch.marks.length ? Math.max(0, (now - watch.marks[watch.marks.length - 1]) / 1000) : 0;
    return {
      watch: { ...watch, track: step.track, holding: true, frozenGap: frozen },
      committed: false,
    };
  }
  if (watch.holding && score < BLINK_SHUT) {
    return {
      watch: { track: step.track, holding: false, frozenGap: null, marks: [...trimMarks(watch.marks), now] },
      committed: true,
    };
  }
  return { watch: { ...watch, track: step.track }, committed: false };
}

/** Seconds since the last open. Frozen while the lids stay shut. */
export function blinkGapSeconds(watch: BlinkWatch, now: number) {
  if (watch.holding && watch.frozenGap != null) return watch.frozenGap;
  if (!watch.marks.length) return null;
  return Math.max(0, (now - watch.marks[watch.marks.length - 1]) / 1000);
}

export function blinksInLastMinute(marks: number[], now: number) {
  return marks.filter((mark) => now - mark <= 60_000).length;
}

/**
 * The laptop clock is the one on screen. A board gap is kept only when it
 * drops, which means the board saw a blink the camera missed. A gap that
 * only climbs is the stale score and is ignored.
 */
export function takeBoardGap(watch: BlinkWatch, gapSeconds: number, now: number, previousBoardGap: number | null) {
  if (!Number.isFinite(gapSeconds) || gapSeconds < 0) return { watch, previousBoardGap };
  const dropped = previousBoardGap == null || gapSeconds + 0.4 < previousBoardGap;
  const implied = now - gapSeconds * 1000;
  const last = watch.marks.length ? watch.marks[watch.marks.length - 1] : null;
  const newer = last == null || implied > last + 250;
  if (!dropped || !newer || watch.holding) return { watch, previousBoardGap: gapSeconds };
  return {
    watch: { ...watch, holding: false, frozenGap: null, marks: [...trimMarks(watch.marks), implied] },
    previousBoardGap: gapSeconds,
  };
}

/** Live number. Laptop time wins once this page has seen a blink. */
export function shownGap(watch: BlinkWatch, saved: number | null | undefined, now: number) {
  const local = blinkGapSeconds(watch, now);
  if (local != null) return local;
  if (saved == null || Number.isNaN(Number(saved))) return null;
  return Number(saved);
}

/** One chart point. A later blink cannot rewrite an earlier score. */
export function shownGapAt(marks: number[], saved: number | null | undefined, at: number) {
  const board = saved == null || Number.isNaN(Number(saved)) ? null : Number(saved);
  let last: number | null = null;
  for (const mark of marks) {
    if (mark <= at) last = mark;
  }
  if (last == null) return board;
  const local = Math.max(0, (at - last) / 1000);
  if (board == null) return local;
  return Math.min(board, local);
}
