export const BLINK_GAP_MS = 5_000;
export const BLINKS_PER_MINUTE = 20;
export const BLINK_RATE_AFTER_MS = 60_000;
export const POSTURE_BAD_AT = 60;
export const POSTURE_STREAK = 3;
export const POSTURE_REPEAT_MS = 15_000;
export const COOLDOWN_MS = 45_000;
export const BREAK_EVERY_MS = 20 * 60 * 1000;
export const BREAK_DURATION_MS = 20_000;

export type Buzz = "B" | "P" | "R";

export type HeadState = "upright" | "forward" | "unknown";
export type ShoulderState = "level" | "tilted" | "unknown";

export type Reading = {
  faceVisible: boolean;
  blinkCount: number;
  postureScore: number;
  head: HeadState;
  shoulders: ShoulderState;
  degraded: boolean;
  /** Last panel still has the lids shut. The stare clock waits for the eyes to open. */
  eyesClosed?: boolean;
  /** Wall-clock time when the last frame in this window was captured. */
  clipEndedAt: number;
};

export type Phase = "live" | "break" | "no-face";

export type AlertState = {
  lastBlinkAt: number;
  secondsSinceBlink: number;
  blinkEvents: { at: number; count: number }[];
  blinksPerMinute: number;
  badPostureStreak: number;
  lastBlinkAlertAt: number | null;
  lastPostureAlertAt: number | null;
  postureAlertSet: boolean;
  breakUntil: number | null;
  lastBreakStartedAt: number;
  postureScore: number | null;
  eyesShut: boolean;
  head: HeadState | null;
  shoulders: ShoulderState | null;
  phase: Phase;
};

export type StepResult = {
  state: AlertState;
  buzz: Buzz | null;
  note: string;
};

export function initialAlertState(now: number): AlertState {
  return {
    lastBlinkAt: now,
    secondsSinceBlink: 0,
    blinkEvents: [],
    blinksPerMinute: 0,
    badPostureStreak: 0,
    lastBlinkAlertAt: null,
    lastPostureAlertAt: null,
    postureAlertSet: false,
    breakUntil: null,
    lastBreakStartedAt: now,
    postureScore: null,
    eyesShut: false,
    head: null,
    shoulders: null,
    phase: "live",
  };
}

function blinksInLastMinute(events: { at: number; count: number }[], at: number) {
  const kept = events.filter((event) => at - event.at <= 60_000 && at - event.at >= 0);
  const blinksPerMinute = kept.reduce((sum, event) => sum + event.count, 0);
  return { kept, blinksPerMinute };
}

export function startBreak(state: AlertState, now: number): StepResult {
  if (state.phase === "break") {
    return { state, buzz: null, note: "Already on a break." };
  }
  return {
    state: {
      ...state,
      phase: "break",
      breakUntil: now + BREAK_DURATION_MS,
      badPostureStreak: 0,
    },
    buzz: "R",
    note: "Look away from the screen for 20 seconds.",
  };
}

function followClock(state: AlertState, now: number): StepResult {
  if (state.phase === "break") {
    if (state.breakUntil !== null && now >= state.breakUntil) {
      return {
        state: {
          ...state,
          phase: "live",
          breakUntil: null,
          lastBreakStartedAt: state.breakUntil,
          lastBlinkAt: state.breakUntil,
          secondsSinceBlink: 0,
          eyesShut: false,
        },
        buzz: null,
        note: "Break over.",
      };
    }
    return { state, buzz: null, note: "" };
  }

  if (now - state.lastBreakStartedAt >= BREAK_EVERY_MS) {
    return startBreak(state, now);
  }

  if (state.phase !== "live") {
    return { state, buzz: null, note: "" };
  }

  const secondsSinceBlink = state.eyesShut ? state.secondsSinceBlink : Math.max(0, (now - state.lastBlinkAt) / 1000);
  const { kept, blinksPerMinute } = blinksInLastMinute(state.blinkEvents, now);
  const countChanged = blinksPerMinute !== state.blinksPerMinute;
  if (!countChanged && Math.abs(secondsSinceBlink - state.secondsSinceBlink) < 0.05) {
    return { state, buzz: null, note: "" };
  }

  return {
    state: { ...state, secondsSinceBlink, blinkEvents: kept, blinksPerMinute },
    buzz: null,
    note: "",
  };
}

function postureStillBad(state: AlertState) {
  return (state.postureScore !== null && state.postureScore <= POSTURE_BAD_AT) || state.head === "forward";
}

function postureRepeat(state: AlertState, now: number): StepResult | null {
  if (state.phase !== "live" || !state.postureAlertSet || state.lastPostureAlertAt === null) return null;
  if (!postureStillBad(state)) return null;
  if (now - state.lastPostureAlertAt < POSTURE_REPEAT_MS) return null;
  return {
    state: { ...state, lastPostureAlertAt: now },
    buzz: "P",
    note: "Sit up. Shoulders back, head over them.",
  };
}

export function tick(state: AlertState, now: number): StepResult {
  const stepped = followClock(state, now);
  if (stepped.buzz || stepped.state.phase !== "live") return stepped;
  const posture = postureRepeat(stepped.state, now);
  if (posture) return posture;
  return blinkReminder(stepped.state, now) ?? stepped;
}

function blinkReminder(state: AlertState, now: number): StepResult | null {
  if (state.phase !== "live") return null;
  const cooled = state.lastBlinkAlertAt === null || now - state.lastBlinkAlertAt >= COOLDOWN_MS;
  if (!cooled) return null;

  const { kept, blinksPerMinute } = blinksInLastMinute(state.blinkEvents, now);
  const counted: AlertState = { ...state, blinkEvents: kept, blinksPerMinute };
  const secondsSinceBlink = Math.max(0, (now - state.lastBlinkAt) / 1000);

  if (!state.eyesShut && now - state.lastBlinkAt >= BLINK_GAP_MS) {
    return {
      state: { ...counted, secondsSinceBlink, lastBlinkAlertAt: now },
      buzz: "B",
      note: "You've been staring.",
    };
  }

  if (now - state.lastBreakStartedAt >= BLINK_RATE_AFTER_MS && blinksPerMinute < BLINKS_PER_MINUTE) {
    return {
      state: { ...counted, secondsSinceBlink, lastBlinkAlertAt: now },
      buzz: "B",
      note: "Under 20 blinks in the last minute.",
    };
  }

  return null;
}

/** A blink seen on the camera. Resets the stare clock without waiting for a contact sheet. */
export function noteBlink(state: AlertState, now: number): StepResult {
  if (state.phase === "break") {
    return { state, buzz: null, note: "" };
  }

  const events = [...state.blinkEvents, { at: now, count: 1 }];
  const { kept, blinksPerMinute } = blinksInLastMinute(events, now);
  return {
    state: {
      ...state,
      phase: "live",
      lastBlinkAt: now,
      secondsSinceBlink: 0,
      blinkEvents: kept,
      blinksPerMinute,
    },
    buzz: null,
    note: "Blink.",
  };
}

export function applyReading(state: AlertState, reading: Reading, now: number): StepResult {
  if (state.phase === "break") {
    return { state, buzz: null, note: "" };
  }

  const due = followClock(state, now);
  if (due.buzz === "R") return due;

  if (!reading.faceVisible) {
    return {
      state: {
        ...state,
        phase: "no-face",
        postureScore: null,
        eyesShut: false,
        head: "unknown",
        shoulders: "unknown",
      },
      buzz: null,
      note: "Step into frame.",
    };
  }

  const shut = reading.eyesClosed === true;
  let lastBlinkAt = due.state.lastBlinkAt;
  let secondsSinceBlink = due.state.eyesShut
    ? due.state.secondsSinceBlink
    : Math.max(0, (now - lastBlinkAt) / 1000);
  let eyesShut = due.state.eyesShut;
  let events = due.state.blinkEvents;
  if (shut) {
    if (!eyesShut) {
      const count = reading.blinkCount > 0 ? reading.blinkCount : 1;
      events = [...events, { at: now, count }];
      secondsSinceBlink = Math.max(0, (now - lastBlinkAt) / 1000);
      eyesShut = true;
    } else if (reading.blinkCount > 0) {
      events = [...events, { at: now, count: reading.blinkCount }];
    }
  } else if (eyesShut || reading.blinkCount > 0) {
    if (reading.blinkCount > 0) events = [...events, { at: now, count: reading.blinkCount }];
    lastBlinkAt = now;
    secondsSinceBlink = 0;
    eyesShut = false;
  }
  const { kept, blinksPerMinute } = blinksInLastMinute(events, now);

  const bad = reading.postureScore <= POSTURE_BAD_AT || reading.head === "forward";
  const badPostureStreak = bad ? due.state.badPostureStreak + 1 : 0;

  let next: AlertState = {
    ...due.state,
    phase: "live",
    lastBlinkAt,
    secondsSinceBlink,
    blinkEvents: kept,
    blinksPerMinute,
    badPostureStreak,
    postureAlertSet: bad ? due.state.postureAlertSet : false,
    postureScore: reading.postureScore,
    eyesShut,
    head: reading.head,
    shoulders: reading.shoulders,
  };

  const reminder = !reading.degraded && !eyesShut && reading.blinkCount <= 0 ? blinkReminder(next, now) : null;
  if (reminder) return reminder;

  const postureReady = badPostureStreak >= POSTURE_STREAK && !next.postureAlertSet;

  if (postureReady) {
    next = { ...next, lastPostureAlertAt: now, postureAlertSet: true, badPostureStreak: 0 };
    return { state: next, buzz: "P", note: "Sit up. Shoulders back, head over them." };
  }

  if (reading.degraded) {
    return {
      state: next,
      buzz: null,
      note: "That window was too long to trust a blink count.",
    };
  }

  return { state: next, buzz: null, note: "" };
}
