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
