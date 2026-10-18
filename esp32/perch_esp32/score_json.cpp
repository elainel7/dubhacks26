#include "score_json.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void foldEscapes(char* text) {
  size_t w = 0;
  for (size_t r = 0; text[r]; r++) {
    char c = text[r];
    if (c == '\\' && text[r + 1]) {
      char next = text[r + 1];
      if (next == '"' || next == '\\' || next == '/') {
        text[w++] = next;
        r++;
        continue;
      }
      if (next == 'n') {
        text[w++] = '\n';
        r++;
        continue;
      }
      if (next == 'r') {
        text[w++] = '\r';
        r++;
        continue;
      }
      if (next == 't') {
        text[w++] = '\t';
        r++;
        continue;
      }
    }
    text[w++] = c;
  }
  text[w] = 0;
}

static const char* afterKey(const char* json, const char* key) {
  char pattern[40];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* found = strstr(json, pattern);
  if (!found) return nullptr;
  found += strlen(pattern);
  while (*found == ' ' || *found == '"' || *found == ':' || *found == '\n' || *found == '\r' || *found == '\t') {
    found++;
  }
  return found;
}

static void readToken(const char* from, char* out, size_t cap) {
  size_t n = 0;
  while (from[n] && from[n] != '"' && from[n] != '\\' && from[n] != ',' && from[n] != '}' && n + 1 < cap) {
    out[n] = from[n];
    n++;
  }
  out[n] = 0;
}

static bool knownHead(const char* value) {
  return strcmp(value, "upright") == 0 || strcmp(value, "forward") == 0 || strcmp(value, "unknown") == 0;
}

static bool knownShoulders(const char* value) {
  return strcmp(value, "level") == 0 || strcmp(value, "tilted") == 0 || strcmp(value, "unknown") == 0;
}

static int postureOutOf100(int raw) {
  int score = raw >= 1 && raw <= 10 ? raw * 10 : raw;
  if (score < 1) score = 1;
  if (score > 100) score = 100;
  return score;
}

bool readDeskScore(char* body, DeskScoreRead* out) {
  if (!body || !out) return false;
  foldEscapes(body);
  const char* faceAt = afterKey(body, "face_visible");
  const char* blinksAt = afterKey(body, "blink_count");
  const char* postureAt = afterKey(body, "posture_score");
  const char* headAt = afterKey(body, "head");
  const char* shouldersAt = afterKey(body, "shoulders");
  if (!faceAt || !blinksAt || !postureAt || !headAt || !shouldersAt) return false;

  out->face = faceAt[0] == 't' || faceAt[0] == 'T' || faceAt[0] == '1';
  int blinks = atoi(blinksAt);
  if (blinks < 0) blinks = 0;
  if (blinks > 4) blinks = 4;
  out->blinks = blinks;
  out->posture = postureOutOf100(atoi(postureAt));
  readToken(headAt, out->head, sizeof(out->head));
  readToken(shouldersAt, out->shoulders, sizeof(out->shoulders));
  if (!knownHead(out->head)) strncpy(out->head, "unknown", sizeof(out->head));
  if (!knownShoulders(out->shoulders)) strncpy(out->shoulders, "unknown", sizeof(out->shoulders));
  out->head[sizeof(out->head) - 1] = 0;
  out->shoulders[sizeof(out->shoulders) - 1] = 0;
  return true;
}

void deskScoreExcerpt(const char* body, char* out, size_t cap) {
  if (!out || cap == 0) return;
  out[0] = 0;
  if (!body || cap < 2) return;
  const char* start = strstr(body, "\"content\"");
  if (!start) start = body;
  size_t n = 0;
  while (*start && n + 1 < cap) {
    char c = *start++;
    if (c < 32) c = ' ';
    out[n++] = c;
  }
  out[n] = 0;
}
