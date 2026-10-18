#include "score_json.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

/* Turn \" and \u0022 into real quotes so the score fields can be found. */
static void foldEscapes(char* text) {
  size_t w = 0;
  for (size_t r = 0; text[r]; r++) {
    char c = text[r];
    if (c == '\\' && text[r + 1]) {
      char next = text[++r];
      if (next == '"' || next == '\\' || next == '/') {
        text[w++] = next;
        continue;
      }
      if (next == 'n') {
        text[w++] = '\n';
        continue;
      }
      if (next == 'r') {
        text[w++] = '\r';
        continue;
      }
      if (next == 't') {
        text[w++] = '\t';
        continue;
      }
      if (next == 'u') {
        int h0 = hexNibble(text[r + 1]);
        int h1 = hexNibble(text[r + 2]);
        int h2 = hexNibble(text[r + 3]);
        int h3 = hexNibble(text[r + 4]);
        if (h0 >= 0 && h1 >= 0 && h2 >= 0 && h3 >= 0) {
          r += 4;
          int code = (h0 << 12) | (h1 << 8) | (h2 << 4) | h3;
          if (code > 0 && code < 128) text[w++] = (char)code;
          continue;
        }
      }
      text[w++] = next;
      continue;
    }
    text[w++] = c;
  }
  text[w] = 0;
}

static bool isNumberStart(char c) { return c == '-' || (c >= '0' && c <= '9'); }

static const char* skipPunct(const char* value) {
  while (*value == ' ' || *value == '"' || *value == ':' || *value == '\n' || *value == '\r' || *value == '\t') {
    value++;
  }
  return value;
}

/* The last match whose value looks like data, so an echoed schema loses to the score. */
static const char* lastValue(const char* json, const char* key, bool numeric) {
  char pattern[40];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* cursor = json;
  const char* found = nullptr;
  size_t keyLen = strlen(pattern);
  while ((cursor = strstr(cursor, pattern)) != nullptr) {
    const char* value = skipPunct(cursor + keyLen);
    bool good = numeric ? isNumberStart(*value)
                        : ((*value >= 'A' && *value <= 'Z') || (*value >= 'a' && *value <= 'z') || *value == '0' ||
                           *value == '1');
    if (good) found = value;
    cursor += keyLen;
  }
  return found;
}

static void readToken(const char* from, char* out, size_t cap) {
  size_t n = 0;
  if (!from) {
    if (cap) out[0] = 0;
    return;
  }
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
  if (raw < 1) return 1;
  if (raw > 100) return 100;
  return raw;
}

bool readDeskScore(char* body, DeskScoreRead* out) {
  if (!body || !out) return false;
  foldEscapes(body);
  const char* faceAt = lastValue(body, "face_visible", false);
  const char* postureAt = lastValue(body, "posture_score", true);
  if (!faceAt || !postureAt) return false;

  const char* blinksAt = lastValue(body, "blink_count", true);
  const char* headAt = lastValue(body, "head", false);
  const char* shouldersAt = lastValue(body, "shoulders", false);

  out->face = faceAt[0] == 't' || faceAt[0] == 'T' || faceAt[0] == '1';
  int blinks = blinksAt ? atoi(blinksAt) : 0;
  if (blinks < 0) blinks = 0;
  if (blinks > 4) blinks = 4;
  out->blinks = blinks;
  const char* shutAt = lastValue(body, "eyes_closed", false);
  out->eyesClosed = shutAt && (shutAt[0] == 't' || shutAt[0] == 'T' || shutAt[0] == '1');
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
  const char* start = body;
  size_t n = 0;
  while (*start && n + 1 < cap) {
    char c = *start++;
    if (c < 32) c = ' ';
    out[n++] = c;
  }
  out[n] = 0;
}
