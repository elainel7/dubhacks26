#include "../perch_esp32/score_json.h"

#include <stdio.h>
#include <string.h>

static char sample[] =
    "{\"id\":\"abc\",\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
    "\"{\\\"face_visible\\\":true,\\\"blink_count\\\":1,\\\"posture_score\\\":72,"
    "\\\"head\\\":\\\"upright\\\",\\\"shoulders\\\":\\\"level\\\"}\"},\"finish_reason\":\"stop\"}]}";

static char spaced[] =
    "{\"choices\":[{\"message\":{\"content\":\"{ \\\"face_visible\\\": false, \\\"blink_count\\\": 0, "
    "\\\"posture_score\\\": 8, \\\"head\\\": \\\"forward\\\", \\\"shoulders\\\": \\\"tilted\\\" }\"}}]}";

static char raw[] =
    "{\"face_visible\":true,\"blink_count\":2,\"posture_score\":40,\"head\":\"upright\",\"shoulders\":\"level\"}";

static char missing[] = "{\"choices\":[{\"message\":{\"content\":\"could not read the sheet\"}}]}";

int main() {
  DeskScoreRead score;
  if (!readDeskScore(sample, &score)) return 1;
  if (!score.face || score.blinks != 1 || score.posture != 72) return 2;
  if (strcmp(score.head, "upright") != 0 || strcmp(score.shoulders, "level") != 0) return 3;

  if (!readDeskScore(spaced, &score)) return 4;
  if (score.face || score.blinks != 0 || score.posture != 80) return 5;
  if (strcmp(score.head, "forward") != 0 || strcmp(score.shoulders, "tilted") != 0) return 6;

  if (!readDeskScore(raw, &score)) return 7;
  if (!score.face || score.blinks != 2 || score.posture != 40) return 8;

  if (readDeskScore(missing, &score)) return 9;
  char excerpt[80];
  deskScoreExcerpt(missing, excerpt, sizeof(excerpt));
  if (!strstr(excerpt, "could not read the sheet")) return 10;

  printf("ok\n");
  return 0;
}
