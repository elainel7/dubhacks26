#include "perch_alerts.h"

namespace {

void keep_minute(PerchState* state, uint32_t now) {
  int kept = 0;
  for (int i = 0; i < state->blinkCount; i++) {
    const uint32_t at = state->blinkAt[i];
    if (now - at <= 60000u) state->blinkAt[kept++] = at;
  }
  state->blinkCount = kept;
  state->blinksPerMinute = kept;
}

void push_blink(PerchState* state, uint32_t now) {
  if (state->blinkCount >= 32) {
    for (int i = 1; i < state->blinkCount; i++) state->blinkAt[i - 1] = state->blinkAt[i];
    state->blinkCount--;
  }
  state->blinkAt[state->blinkCount++] = now;
  keep_minute(state, now);
}

PerchStep clock_only(PerchState state, uint32_t now) {
  PerchStep step{state, kBuzzNone, ""};
  if (state.phase == kPhaseBreak) {
    if (now >= state.breakUntil) {
      step.state.phase = kPhaseLive;
      step.state.breakUntil = 0;
      step.state.lastBreakStartedAt = state.breakUntil;
      step.state.lastBlinkAt = state.breakUntil;
      step.state.eyesShut = false;
      step.state.heldGapMs = 0;
      step.note = "break over.";
    }
    return step;
  }
  if (now - state.lastBreakStartedAt >= kBreakEveryMs) {
    step.state.phase = kPhaseBreak;
    step.state.breakUntil = now + kBreakDurationMs;
    step.state.badPostureStreak = 0;
    step.buzz = kBuzzBreak;
    step.note = "time for a break! look away for 20 seconds.";
    return step;
  }
  if (state.phase != kPhaseLive) return step;
  keep_minute(&step.state, now);
  return step;
}

PerchStep remind(PerchState state, uint32_t now) {
  PerchStep quiet{state, kBuzzNone, ""};
  if (state.phase != kPhaseLive) return quiet;
  const bool cooled = !state.blinkAlertSet || now - state.lastBlinkAlertAt >= static_cast<uint32_t>(kCooldownMs);
  if (!cooled) return quiet;
  keep_minute(&state, now);
  if (!state.eyesShut && now - state.lastBlinkAt >= static_cast<uint32_t>(kBlinkGapMs)) {
    state.lastBlinkAlertAt = now;
    state.blinkAlertSet = true;
    return PerchStep{state, kBuzzBlink, "looking at screen for too long!"};
  }
  if (now - state.lastBreakStartedAt >= static_cast<uint32_t>(kBlinkRateAfterMs) &&
      state.blinksPerMinute < kBlinksPerMinute) {
    state.lastBlinkAlertAt = now;
    state.blinkAlertSet = true;
    return PerchStep{state, kBuzzBlink, "not blinking enough!"};
  }
  return quiet;
}

}  // namespace

PerchState perch_initial(uint32_t now) {
  PerchState state{};
  state.lastBlinkAt = now;
  state.lastBreakStartedAt = now;
  state.postureScore = -1;
  state.phase = kPhaseLive;
  return state;
}

PerchStep posture_repeat(PerchState state, uint32_t now) {
  PerchStep quiet{state, kBuzzNone, ""};
  if (state.phase != kPhaseLive || !state.postureAlertSet) return quiet;
  const bool bad = (state.postureScore >= 0 && state.postureScore <= kPostureBadAt) || state.headForward;
  if (!bad) return quiet;
  if (now - state.lastPostureAlertAt < static_cast<uint32_t>(kPostureRepeatMs)) return quiet;
  state.lastPostureAlertAt = now;
  return PerchStep{state, kBuzzPosture, "sit up!"};
}

PerchStep perch_tick(PerchState state, uint32_t now) {
  PerchStep stepped = clock_only(state, now);
  if (stepped.buzz != kBuzzNone || stepped.state.phase != kPhaseLive) return stepped;
  PerchStep posture = posture_repeat(stepped.state, now);
  if (posture.buzz != kBuzzNone) return posture;
  PerchStep reminder = remind(stepped.state, now);
  if (reminder.buzz != kBuzzNone) return reminder;
  return stepped;
}

PerchStep perch_note_blink(PerchState state, uint32_t now) {
  if (state.phase == kPhaseBreak) return PerchStep{state, kBuzzNone, ""};
  push_blink(&state, now);
  state.phase = kPhaseLive;
  state.lastBlinkAt = now;
  state.eyesShut = false;
  state.heldGapMs = 0;
  return PerchStep{state, kBuzzNone, ""};
}

PerchStep perch_apply(PerchState state, PerchReading reading, uint32_t now) {
  if (state.phase == kPhaseBreak) return PerchStep{state, kBuzzNone, ""};
  PerchStep due = clock_only(state, now);
  if (due.buzz == kBuzzBreak) return due;
  if (!reading.faceVisible) {
    due.state.phase = kPhaseNoFace;
    due.state.postureScore = -1;
    due.state.eyesShut = false;
    due.state.headForward = false;
    due.note = "step into frame.";
    return due;
  }
  due.state.phase = kPhaseLive;
  if (reading.eyesClosed) {
    if (!due.state.eyesShut) {
      int n = reading.blinkCount > 0 ? reading.blinkCount : 1;
      if (n > 4) n = 4;
      for (int i = 0; i < n; i++) push_blink(&due.state, now);
      due.state.heldGapMs = now - due.state.lastBlinkAt;
      due.state.eyesShut = true;
    } else if (reading.blinkCount > 0) {
      int n = reading.blinkCount > 4 ? 4 : reading.blinkCount;
      for (int i = 0; i < n; i++) push_blink(&due.state, now);
    }
  } else if (due.state.eyesShut || reading.blinkCount > 0) {
    if (reading.blinkCount > 0) {
      int n = reading.blinkCount > 4 ? 4 : reading.blinkCount;
      for (int i = 0; i < n; i++) push_blink(&due.state, now);
    }
    due.state.eyesShut = false;
    due.state.heldGapMs = 0;
    due.state.lastBlinkAt = now;
  }
  due.state.postureScore = reading.postureScore;
  due.state.headForward = reading.headForward;
  if (reading.postureScore <= kPostureBadAt || reading.headForward) due.state.badPostureStreak += 1;
  else {
    due.state.badPostureStreak = 0;
    due.state.postureAlertSet = false;
  }

  if (!reading.degraded && !due.state.eyesShut && reading.blinkCount <= 0) {
    PerchStep reminder = remind(due.state, now);
    if (reminder.buzz != kBuzzNone) return reminder;
  }

  const bool postureReady = due.state.badPostureStreak >= kPostureStreak && !due.state.postureAlertSet;
  if (postureReady) {
    due.state.lastPostureAlertAt = now;
    due.state.postureAlertSet = true;
    due.state.badPostureStreak = 0;
    due.buzz = kBuzzPosture;
    due.note = "sit up!";
    return due;
  }
  if (reading.degraded) {
    due.note = "that sheet was too slow to count blinks.";
    return due;
  }
  due.note = "";
  return due;
}
