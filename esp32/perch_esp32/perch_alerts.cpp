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
      step.note = "Break over.";
    }
    return step;
  }
  if (now - state.lastBreakStartedAt >= kBreakEveryMs) {
    step.state.phase = kPhaseBreak;
    step.state.breakUntil = now + kBreakDurationMs;
    step.state.badPostureStreak = 0;
    step.buzz = kBuzzBreak;
    step.note = "Look away from the screen for 20 seconds.";
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
  if (now - state.lastBlinkAt >= static_cast<uint32_t>(kBlinkGapMs)) {
    state.lastBlinkAlertAt = now;
    state.blinkAlertSet = true;
    return PerchStep{state, kBuzzBlink, "You've been staring."};
  }
  if (now - state.lastBreakStartedAt >= static_cast<uint32_t>(kBlinkRateAfterMs) &&
      state.blinksPerMinute < kBlinksPerMinute) {
    state.lastBlinkAlertAt = now;
    state.blinkAlertSet = true;
    return PerchStep{state, kBuzzBlink, "Under 20 blinks in the last minute."};
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

PerchStep perch_tick(PerchState state, uint32_t now) {
  PerchStep stepped = clock_only(state, now);
  if (stepped.buzz != kBuzzNone || stepped.state.phase != kPhaseLive) return stepped;
  PerchStep reminder = remind(stepped.state, now);
  if (reminder.buzz != kBuzzNone) return reminder;
  return stepped;
}

PerchStep perch_note_blink(PerchState state, uint32_t now) {
  if (state.phase == kPhaseBreak) return PerchStep{state, kBuzzNone, ""};
  push_blink(&state, now);
  state.phase = kPhaseLive;
  state.lastBlinkAt = now;
  return PerchStep{state, kBuzzNone, "Blink."};
}

PerchStep perch_apply(PerchState state, PerchReading reading, uint32_t now) {
  if (state.phase == kPhaseBreak) return PerchStep{state, kBuzzNone, ""};
  PerchStep due = clock_only(state, now);
  if (due.buzz == kBuzzBreak) return due;
  if (!reading.faceVisible) {
    due.state.phase = kPhaseNoFace;
    due.state.postureScore = -1;
    due.note = "Step into frame.";
    return due;
  }
  if (reading.blinkCount > 0) {
    int n = reading.blinkCount > 4 ? 4 : reading.blinkCount;
    for (int i = 0; i < n; i++) push_blink(&due.state, now);
  }
  due.state.phase = kPhaseLive;
  due.state.lastBlinkAt = reading.blinkCount > 0 ? now : due.state.lastBlinkAt;
  due.state.postureScore = reading.postureScore;
  if (reading.postureScore <= kPostureBadAt) due.state.badPostureStreak += 1;
  else due.state.badPostureStreak = 0;

  if (!reading.degraded && reading.blinkCount <= 0) {
    PerchStep reminder = remind(due.state, now);
    if (reminder.buzz != kBuzzNone) return reminder;
  }

  const bool postureReady =
      due.state.badPostureStreak >= kPostureStreak &&
      (!due.state.postureAlertSet || now - due.state.lastPostureAlertAt >= static_cast<uint32_t>(kCooldownMs));
  if (postureReady) {
    due.state.lastPostureAlertAt = now;
    due.state.postureAlertSet = true;
    due.state.badPostureStreak = 0;
    due.buzz = kBuzzPosture;
    due.note = "Sit up. Shoulders back, head over them.";
    return due;
  }
  if (reading.degraded) {
    due.note = "That window was too long to trust a blink count.";
    return due;
  }
  due.note = "";
  return due;
}
