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

static char unicode[] =
    "{\"choices\":[{\"message\":{\"content\":\"{\\u0022face_visible\\u0022:true,"
    "\\u0022posture_score\\u0022:64}\"}}]}";

static char truncated[] =
    "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":"
    "\"{\\\"face_visible\\\":true,\\\"blink_count\\\":2,\\\"posture_score\\\":55\"}}]}";

int main() {
  DeskScoreRead score;
  if (!readDeskScore(sample, &score)) return 1;
  if (!score.face || score.blinks != 1 || score.posture != 72 || score.eyesClosed) return 2;
  if (strcmp(score.head, "upright") != 0 || strcmp(score.shoulders, "level") != 0) return 3;

  if (!readDeskScore(spaced, &score)) return 4;
  if (score.face || score.blinks != 0 || score.posture != 8) return 5;
  if (strcmp(score.head, "forward") != 0 || strcmp(score.shoulders, "tilted") != 0) return 6;

  if (!readDeskScore(raw, &score)) return 7;
  if (!score.face || score.blinks != 2 || score.posture != 40) return 8;

  if (readDeskScore(missing, &score)) return 9;
  char excerpt[80];
  deskScoreExcerpt(missing, excerpt, sizeof(excerpt));
  if (!strstr(excerpt, "could not read the sheet")) return 10;

  if (!readDeskScore(unicode, &score)) return 11;
  if (!score.face || score.posture != 64 || strcmp(score.head, "unknown") != 0) return 12;

  if (!readDeskScore(truncated, &score)) return 13;
  if (!score.face || score.blinks != 2 || score.posture != 55) return 14;
  if (strcmp(score.head, "unknown") != 0 || strcmp(score.shoulders, "unknown") != 0) return 15;

  printf("ok\n");
  return 0;
}
