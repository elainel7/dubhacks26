#pragma once

#include <stddef.h>
#include <stdint.h>

/* Perceptron returns the score as a JSON string inside message.content,
   so the quotes in the HTTP body are escaped. readDeskScore folds those
   escapes, then reads the five fields. It edits body in place. */

struct DeskScoreRead {
  bool face;
  int blinks;
  bool eyesClosed;
  int posture;
  char head[16];
  char shoulders[16];
};

bool readDeskScore(char* body, DeskScoreRead* out);
void deskScoreExcerpt(const char* body, char* out, size_t cap);
