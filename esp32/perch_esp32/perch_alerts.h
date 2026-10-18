#pragma once

#include <stdint.h>

/* Same clock as vision/alerts.ts. Times are milliseconds. */

constexpr int kBlinkGapMs = 5000;
constexpr int kBlinksPerMinute = 20;
constexpr int kBlinkRateAfterMs = 60000;
constexpr int kPostureBadAt = 60;
constexpr int kPostureStreak = 3;
constexpr int kPostureRepeatMs = 15000;
constexpr int kCooldownMs = 45000;
constexpr uint32_t kBreakEveryMs = 20u * 60u * 1000u;
constexpr uint32_t kBreakDurationMs = 20000;

enum PerchBuzz { kBuzzNone = 0, kBuzzBlink = 'B', kBuzzPosture = 'P', kBuzzBreak = 'R' };
enum PerchPhase { kPhaseLive = 0, kPhaseBreak = 1, kPhaseNoFace = 2 };

struct PerchState {
  uint32_t lastBlinkAt;
  uint32_t heldGapMs;
  bool eyesShut;
  bool headForward;
  uint32_t blinkAt[32];
  int blinkCount;
  int blinksPerMinute;
  int badPostureStreak;
  int postureScore;
  uint32_t lastBlinkAlertAt;
  uint32_t lastPostureAlertAt;
  bool blinkAlertSet;
  bool postureAlertSet;
  uint32_t breakUntil;
  uint32_t lastBreakStartedAt;
  PerchPhase phase;
};

struct PerchReading {
  bool faceVisible;
  int blinkCount;
  int postureScore;
  bool degraded;
  bool eyesClosed;
  bool headForward;
};

struct PerchStep {
  PerchState state;
  PerchBuzz buzz;
  const char* note;
};

PerchState perch_initial(uint32_t now);
PerchStep perch_tick(PerchState state, uint32_t now);
PerchStep perch_note_blink(PerchState state, uint32_t now);
PerchStep perch_apply(PerchState state, PerchReading reading, uint32_t now);
