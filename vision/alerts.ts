export const BLINK_GAP_MS = 8_000;
export const POSTURE_BAD_AT = 4;
export const POSTURE_STREAK = 3;
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
  breakUntil: number | null;
  lastBreakStartedAt: number;
  postureScore: number | null;
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
    breakUntil: null,
    lastBreakStartedAt: now,
    postureScore: null,
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

export function tick(state: AlertState, now: number): StepResult {
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

  const secondsSinceBlink = Math.max(0, (now - state.lastBlinkAt) / 1000);
  if (Math.abs(secondsSinceBlink - state.secondsSinceBlink) < 0.05) {
    return { state, buzz: null, note: "" };
  }

  return {
    state: { ...state, secondsSinceBlink },
    buzz: null,
    note: "",
  };
}

export function applyReading(state: AlertState, reading: Reading, now: number): StepResult {
  if (state.phase === "break") {
    return { state, buzz: null, note: "" };
  }

  const due = tick(state, now);
  if (due.buzz === "R") return due;

  if (!reading.faceVisible) {
    return {
      state: {
        ...state,
        phase: "no-face",
        postureScore: null,
        head: "unknown",
        shoulders: "unknown",
      },
      buzz: null,
      note: "Step into frame.",
    };
  }

  const blinked = reading.blinkCount > 0;
  const lastBlinkAt = blinked ? reading.clipEndedAt : due.state.lastBlinkAt;
  const secondsSinceBlink = Math.max(0, (reading.clipEndedAt - lastBlinkAt) / 1000);
  const events = blinked
    ? [...due.state.blinkEvents, { at: reading.clipEndedAt, count: reading.blinkCount }]
    : due.state.blinkEvents;
  const { kept, blinksPerMinute } = blinksInLastMinute(events, reading.clipEndedAt);

  const bad = reading.postureScore <= POSTURE_BAD_AT;
  const badPostureStreak = bad ? due.state.badPostureStreak + 1 : 0;

  let next: AlertState = {
    ...due.state,
    phase: "live",
    lastBlinkAt,
    secondsSinceBlink,
    blinkEvents: kept,
    blinksPerMinute,
    badPostureStreak,
    postureScore: reading.postureScore,
    head: reading.head,
    shoulders: reading.shoulders,
  };

  const blinkReady =
    !reading.degraded &&
    !blinked &&
    reading.clipEndedAt - lastBlinkAt >= BLINK_GAP_MS &&
    (next.lastBlinkAlertAt === null || now - next.lastBlinkAlertAt >= COOLDOWN_MS);

  const postureReady =
    badPostureStreak >= POSTURE_STREAK &&
    (next.lastPostureAlertAt === null || now - next.lastPostureAlertAt >= COOLDOWN_MS);

  if (blinkReady) {
    next = { ...next, lastBlinkAlertAt: now };
    return { state: next, buzz: "B", note: "Blink." };
  }

  if (postureReady) {
    next = { ...next, lastPostureAlertAt: now, badPostureStreak: 0 };
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
