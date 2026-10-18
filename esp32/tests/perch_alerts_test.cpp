#include "../perch_esp32/perch_alerts.h"

#include <stdio.h>
#include <string.h>

int main() {
  PerchState state = perch_initial(0);
  PerchStep stare = perch_tick(state, 5000);
  if (stare.buzz != kBuzzBlink) return 1;
  if (!stare.note || strcmp(stare.note, "looking at screen for too long!") != 0) return 1;
  state = perch_initial(0);
  for (int i = 1; i <= 19; i++) state = perch_note_blink(state, static_cast<uint32_t>(i * 3000)).state;
  PerchStep low = perch_tick(state, 60000);
  if (low.buzz != kBuzzBlink || low.state.blinksPerMinute != 19) return 1;
  state = perch_initial(0);
  for (int i = 1; i <= 3; i++) {
    PerchStep step = perch_apply(state, PerchReading{true, 1, 40, false}, static_cast<uint32_t>(i * 1000));
    state = step.state;
    if (i == 3 && step.buzz != kBuzzPosture) return 1;
  }
  PerchStep repeat = perch_tick(state, 3000 + 15000);
  if (repeat.buzz != kBuzzPosture) return 1;
  PerchState blinked = perch_note_blink(repeat.state, 3000 + 15000).state;
  PerchStep tooSoon = perch_tick(blinked, 3000 + 15000 + 4000);
  if (tooSoon.buzz != kBuzzNone) return 1;
  state = perch_initial(0);
  PerchStep closed = perch_apply(state, PerchReading{true, 0, 80, false, true}, 4000);
  if (closed.buzz != kBuzzNone || !closed.state.eyesShut || closed.state.blinksPerMinute != 1) return 2;
  if (closed.state.lastBlinkAt != 0 || closed.state.heldGapMs != 4000) return 2;
  PerchStep held = perch_apply(closed.state, PerchReading{true, 0, 80, false, true}, 9000);
  if (held.buzz != kBuzzNone || held.state.blinksPerMinute != 1 || held.state.heldGapMs != 4000) return 3;
  PerchStep during = perch_tick(held.state, 12000);
  if (during.buzz != kBuzzNone) return 4;
  PerchStep opened = perch_apply(during.state, PerchReading{true, 0, 80, false, false}, 13000);
  if (opened.state.eyesShut || opened.state.lastBlinkAt != 13000 || opened.state.blinksPerMinute != 1) return 5;
  PerchStep heldShut = perch_apply(perch_initial(0), PerchReading{true, 0, 80, false, true, false}, 4000);
  if (perch_tick(heldShut.state, 10000).buzz != kBuzzNone) return 6;
  PerchStep laptop = perch_note_blink(heldShut.state, 7000);
  if (laptop.state.eyesShut || laptop.state.heldGapMs != 0 || laptop.state.lastBlinkAt != 7000) return 7;
  if (perch_tick(laptop.state, 12000).buzz != kBuzzBlink) return 8;
  printf("ok\n");
  return 0;
}
