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
  printf("ok\n");
  return 0;
}
