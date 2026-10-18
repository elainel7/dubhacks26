// Perch on an ESP32.
//
// The laptop is only a camera. Chrome sends 96x72 grayscale frames over USB.
// This board stores eight of them, builds one contact sheet, asks Perceptron
// Mk1.5, buzzes, and posts the posture number to Tiger Data for PERCH_DEVICE_ID.
//
// Open this file in Arduino IDE 2: esp32/perch_esp32/perch_esp32.ino
// Copy secrets.example.h to secrets.h and fill it in. secrets.h stays off git.
//
// Board (ESP32-S3): ESP32S3 Dev Module, USB CDC On Boot Enabled, PSRAM Enabled.
// Board (WROVER): ESP32 Wrover Module, PSRAM Enabled. Same 921600 baud.
// Piezo + to GPIO 4, piezo - to GND. Optional LED on GPIO 2.
// Close the Serial Monitor before the website connects. One program holds the port.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_heap_caps.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "jpeg_gray.h"
#include "perch_alerts.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and fill in Wi-Fi, the device id, and the Perceptron key."
#endif

constexpr int kFrameW = 96;
constexpr int kFrameH = 72;
constexpr int kPixels = kFrameW * kFrameH;
constexpr int kPanels = 8;
constexpr int kSheetW = 584;
constexpr int kSheetH = 144;
constexpr int kPostureX = 392;
constexpr size_t kPayloadLen = 4 + kPixels;
constexpr size_t kJpegCap = 96 * 1024;
constexpr size_t kBodyCap = 180 * 1024;
constexpr int kBuzzerPin = 4;
constexpr int kLedPin = 2;

constexpr uint8_t kMagic0 = 0xA5;
constexpr uint8_t kMagic1 = 0x5A;

static const char kPrompt[] =
    "This grayscale image is one contact sheet of a person at a laptop. "
    "Eight small panels run left to right, then top to bottom, and cover about half a second. "
    "blink_count is how many times the eyelids close in the small panels. "
    "If the pupils disappear behind the lids in any small panel, blink_count is at least 1. "
    "A closure at the end of the sheet still counts. Do not return 0 because the eyes have not opened again yet. "
    "Several shut panels in a row are one blink, not one blink per panel. "
    "The person may wear glasses. A bright reflection is not an open eye. "
    "Looking down with the pupils still visible is not a blink. Lids covering the pupils is a blink even if the chin drops. "
    "The small panels are only for blinks. "
    "The large panel with a white border is POSTURE. Score only that panel. "
    "posture_score is an integer from 1 to 100. 1 is the worst posture and 100 is the best. Use the whole range. "
    "90 to 100 means the ear is over the shoulder, the chin is back, and the chest is open. "
    "70 to 85 is upright with a small forward drift of the head. "
    "50 to 65 means the head is in front of the shoulders or the upper back is rounded. "
    "25 to 45 is a real slouch, with the face much closer to the camera than the chest. "
    "1 to 20 is collapsed toward the desk. "
    "A slouch and sitting up must differ by at least 25 points. "
    "If no face is visible, face_visible is false, blink_count is 0, posture_score is 50, and head and shoulders are unknown. "
    "head is upright, forward, or unknown. shoulders is level, tilted, or unknown. "
    "Do not identify the person.";

static const char kPrefix[] =
    "{\"model\":\"perceptron-mk1.5\",\"max_completion_tokens\":200,"
    "\"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"desk_state\",\"strict\":true,\"schema\":{"
    "\"type\":\"object\",\"additionalProperties\":false,\"properties\":{"
    "\"face_visible\":{\"type\":\"boolean\"},"
    "\"blink_count\":{\"type\":\"integer\"},"
    "\"posture_score\":{\"type\":\"integer\"},"
    "\"head\":{\"type\":\"string\",\"enum\":[\"upright\",\"forward\",\"unknown\"]},"
    "\"shoulders\":{\"type\":\"string\",\"enum\":[\"level\",\"tilted\",\"unknown\"]}"
    "},\"required\":[\"face_visible\",\"blink_count\",\"posture_score\",\"head\",\"shoulders\"]}}},"
    "\"messages\":[{\"role\":\"user\",\"content\":["
    "{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/jpeg;base64,";

static uint8_t* frames[kPanels];
static uint32_t stamps[kPanels];
static int frameCount = 0;
static uint8_t* sheet = nullptr;
static uint8_t* jpeg = nullptr;
static uint8_t* body = nullptr;
static uint8_t* payload = nullptr;
static bool ready = false;
static bool wifiUp = false;
static PerchState alerts;
static uint32_t lastApplyMs = 0;
static uint32_t lastHelloMs = 0;
static uint32_t lastWifiTryMs = 0;

static int buzzHz[20];
static int buzzMs[20];
static int buzzLen = 0;
static int buzzIndex = 0;
static uint32_t buzzUntil = 0;
static bool buzzing = false;

enum RxState { kWait0, kWait1, kHeader, kPayload, kCrc };
static RxState rxState = kWait0;
static uint8_t header[6];
static size_t rxGot = 0;
static uint16_t rxCrc = 0xFFFF;
static uint8_t crcBytes[2];

uint16_t crc16_add(uint16_t crc, uint8_t byte) {
  crc ^= (uint16_t)byte << 8;
  for (int bit = 0; bit < 8; bit++) {
    if (crc & 0x8000) crc = (uint16_t)((crc << 1) ^ 0x1021);
    else crc = (uint16_t)(crc << 1);
  }
  return crc;
}

uint32_t readLe32(const uint8_t* bytes) {
  return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) |
         ((uint32_t)bytes[3] << 24);
}

void say(const char* text) { Serial.println(text); }

void sayError(const char* text) {
  Serial.print("error ");
  Serial.println(text);
}

void releaseHost() {
  Serial.println("idle");
  Serial.println("ok");
  frameCount = 0;
}

void hello() {
  Serial.print("device ");
  Serial.println(PERCH_DEVICE_ID);
  Serial.println("idle");
  lastHelloMs = millis();
}

void startBuzz(PerchBuzz buzz) {
  buzzLen = 0;
  if (buzz == kBuzzBlink) {
    buzzHz[0] = 1800;
    buzzMs[0] = 80;
    buzzHz[1] = 0;
    buzzMs[1] = 70;
    buzzHz[2] = 1800;
    buzzMs[2] = 80;
    buzzLen = 3;
  } else if (buzz == kBuzzPosture) {
    for (int i = 0; i < 3; i++) {
      buzzHz[buzzLen] = 440;
      buzzMs[buzzLen] = 120;
      buzzLen++;
      if (i < 2) {
        buzzHz[buzzLen] = 0;
        buzzMs[buzzLen] = 80;
        buzzLen++;
      }
    }
  } else if (buzz == kBuzzBreak) {
    for (int i = 0; i < 10; i++) {
      buzzHz[buzzLen] = 880;
      buzzMs[buzzLen] = 180;
      buzzLen++;
      if (i < 9) {
        buzzHz[buzzLen] = 0;
        buzzMs[buzzLen] = 1800;
        buzzLen++;
      }
    }
  } else {
    return;
  }
  buzzIndex = 0;
  buzzUntil = 0;
  buzzing = true;
  digitalWrite(kLedPin, HIGH);
}

void serviceBuzz() {
  if (!buzzing) return;
  uint32_t now = millis();
  if (buzzUntil != 0 && (int32_t)(now - buzzUntil) < 0) return;
  if (buzzIndex >= buzzLen) {
    noTone(kBuzzerPin);
    digitalWrite(kLedPin, LOW);
    buzzing = false;
    return;
  }
  int hz = buzzHz[buzzIndex];
  int ms = buzzMs[buzzIndex];
  buzzIndex++;
  if (hz > 0) tone(kBuzzerPin, hz, ms);
  else noTone(kBuzzerPin);
  buzzUntil = now + (uint32_t)ms;
}

void applyBuzz(PerchStep step) {
  alerts = step.state;
  lastApplyMs = millis();
  if (step.buzz != kBuzzNone) startBuzz(step.buzz);
  if (step.note && step.note[0]) {
    Serial.print("note ");
    Serial.println(step.note);
  }
}

bool allocBoard() {
  for (int i = 0; i < kPanels; i++) {
    frames[i] = (uint8_t*)heap_caps_malloc(kPixels, MALLOC_CAP_SPIRAM);
    if (!frames[i]) return false;
  }
  sheet = (uint8_t*)heap_caps_malloc((size_t)kSheetW * kSheetH, MALLOC_CAP_SPIRAM);
  jpeg = (uint8_t*)heap_caps_malloc(kJpegCap, MALLOC_CAP_SPIRAM);
  body = (uint8_t*)heap_caps_malloc(kBodyCap, MALLOC_CAP_SPIRAM);
  payload = (uint8_t*)heap_caps_malloc(kPayloadLen, MALLOC_CAP_SPIRAM);
  return sheet && jpeg && body && payload;
}

void blit(const uint8_t* src, int sw, int sh, int dx, int dy) {
  for (int y = 0; y < sh; y++) {
    memcpy(sheet + (size_t)(dy + y) * kSheetW + dx, src + (size_t)y * sw, sw);
  }
}

void blit2x(const uint8_t* src) {
  for (int y = 0; y < kFrameH; y++) {
    for (int x = 0; x < kFrameW; x++) {
      uint8_t pixel = src[y * kFrameW + x];
      int ox = kPostureX + x * 2;
      int oy = y * 2;
      sheet[(size_t)oy * kSheetW + ox] = pixel;
      sheet[(size_t)oy * kSheetW + ox + 1] = pixel;
      sheet[(size_t)(oy + 1) * kSheetW + ox] = pixel;
      sheet[(size_t)(oy + 1) * kSheetW + ox + 1] = pixel;
    }
  }
  for (int y = 0; y < kFrameH * 2; y++) {
    for (int x = 0; x < kFrameW * 2; x++) {
      if (x < 3 || y < 3 || x >= kFrameW * 2 - 3 || y >= kFrameH * 2 - 3) {
        sheet[(size_t)y * kSheetW + kPostureX + x] = 255;
      }
    }
  }
}

void composeSheet() {
  memset(sheet, 255, (size_t)kSheetW * kSheetH);
  for (int i = 0; i < kPanels; i++) {
    blit(frames[i], kFrameW, kFrameH, (i % 4) * kFrameW, (i / 4) * kFrameH);
  }
  blit2x(frames[kPanels - 1]);
}

size_t base64Into(const uint8_t* input, size_t length, uint8_t* output, size_t cap) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t need = 4 * ((length + 2) / 3);
  if (need > cap) return 0;
  size_t out = 0;
  for (size_t i = 0; i < length; i += 3) {
    uint32_t value = (uint32_t)input[i] << 16;
    if (i + 1 < length) value |= (uint32_t)input[i + 1] << 8;
    if (i + 2 < length) value |= input[i + 2];
    output[out++] = alphabet[(value >> 18) & 63];
    output[out++] = alphabet[(value >> 12) & 63];
    output[out++] = (i + 1 < length) ? alphabet[(value >> 6) & 63] : '=';
    output[out++] = (i + 2 < length) ? alphabet[value & 63] : '=';
  }
  return out;
}

bool appendText(size_t* used, const char* text) {
  size_t n = strlen(text);
  if (*used + n >= kBodyCap) return false;
  memcpy(body + *used, text, n);
  *used += n;
  return true;
}

const char* afterKey(const char* json, const char* key) {
  char pattern[40];
  snprintf(pattern, sizeof(pattern), "\"%s\"", key);
  const char* found = strstr(json, pattern);
  if (!found) return nullptr;
  found += strlen(pattern);
  while (*found == ' ' || *found == '\\' || *found == '"' || *found == ':' || *found == '\n' ||
         *found == '\r' || *found == '\t') {
    found++;
  }
  return found;
}

void readToken(const char* from, char* out, size_t cap) {
  size_t n = 0;
  while (from[n] && from[n] != '"' && from[n] != '\\' && from[n] != ',' && from[n] != '}' &&
         n + 1 < cap) {
    out[n] = from[n];
    n++;
  }
  out[n] = 0;
}

bool knownHead(const char* value) {
  return strcmp(value, "upright") == 0 || strcmp(value, "forward") == 0 || strcmp(value, "unknown") == 0;
}

bool knownShoulders(const char* value) {
  return strcmp(value, "level") == 0 || strcmp(value, "tilted") == 0 || strcmp(value, "unknown") == 0;
}

int postureOutOf100(int raw) {
  int score = raw >= 1 && raw <= 10 ? raw * 10 : raw;
  if (score < 1) score = 1;
  if (score > 100) score = 100;
  return score;
}

bool clockReady() {
  time_t now = time(nullptr);
  return now > 1700000000;
}

void apiBase(char* out, size_t cap) {
  strncpy(out, PERCH_API_BASE, cap - 1);
  out[cap - 1] = 0;
  size_t n = strlen(out);
  if (n > 0 && out[n - 1] == '/') out[n - 1] = 0;
}

int postJson(const char* url, const uint8_t* data, size_t length, bool bearer, String* response) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, url)) return -1;
  http.setTimeout(20000);
  http.setConnectTimeout(8000);
  http.useHTTP10(true);
  http.addHeader("Content-Type", "application/json");
  if (bearer) {
    char auth[400];
    snprintf(auth, sizeof(auth), "Bearer %s", PERCH_PERCEPTRON_KEY);
    http.addHeader("Authorization", auth);
  }
  int code = http.POST(const_cast<uint8_t*>(data), length);
  if (response) *response = http.getString();
  http.end();
  return code;
}

void postEvent(bool face, int posture, const char* head) {
  if (!face) return;
  if (!wifiUp) {
    sayError("wifi");
    Serial.println("unsaved");
    return;
  }
  if (!clockReady()) {
    sayError("clock");
    Serial.println("unsaved");
    return;
  }
  const char* label = "good";
  if (strcmp(head, "forward") == 0) label = "leaning_forward";
  else if (posture <= 60) label = "slouching";
  int hundredths = posture;
  if (hundredths < 0) hundredths = 0;
  if (hundredths > 100) hundredths = 100;

  time_t now = time(nullptr);
  struct tm parts;
  gmtime_r(&now, &parts);
  char stamp[32];
  strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &parts);

  char json[240];
  snprintf(json, sizeof(json),
           "{\"time\":\"%s\",\"user_id\":\"%s\",\"label\":\"%s\",\"confidence\":%d.%02d}", stamp,
           PERCH_DEVICE_ID, label, hundredths / 100, hundredths % 100);
  char base[120];
  apiBase(base, sizeof(base));
  char url[160];
  snprintf(url, sizeof(url), "%s/events", base);
  int code = postJson(url, (const uint8_t*)json, strlen(json), false, nullptr);
  if (code == 200 || code == 201) Serial.println("saved");
  else {
    char message[32];
    snprintf(message, sizeof(message), "save %d", code);
    sayError(message);
    Serial.println("unsaved");
  }
}

void printScore(bool face, int blinks, int posture, const char* head, const char* shoulders) {
  uint32_t gapMs = millis() - alerts.lastBlinkAt;
  unsigned tenths = gapMs / 100;
  char line[180];
  snprintf(line, sizeof(line),
           "score face=%d blinks=%d posture=%d gap=%u.%u rate=%d head=%s shoulders=%s", face ? 1 : 0,
           blinks, posture, tenths / 10, tenths % 10, alerts.blinksPerMinute, head, shoulders);
  Serial.println(line);
}

void scoreSheet() {
  if (!wifiUp) {
    sayError("wifi");
    releaseHost();
    return;
  }
  composeSheet();
  size_t jpegSize = jpeg_gray_encode(sheet, kSheetW, kSheetH, 60, jpeg, kJpegCap);
  if (jpegSize == 0) {
    sayError("jpeg");
    releaseHost();
    return;
  }

  size_t used = 0;
  if (!appendText(&used, kPrefix)) {
    sayError("jpeg");
    releaseHost();
    return;
  }
  size_t encoded = base64Into(jpeg, jpegSize, body + used, kBodyCap - used);
  if (encoded == 0) {
    sayError("jpeg");
    releaseHost();
    return;
  }
  used += encoded;
  if (!appendText(&used, "\"}},{\"type\":\"text\",\"text\":\"") || !appendText(&used, kPrompt) ||
      !appendText(&used, "\"}]}]}")) {
    sayError("jpeg");
    releaseHost();
    return;
  }

  String response;
  int code = postJson("https://api.perceptron.inc/v1/chat/completions", body, used, true, &response);
  if (code != 200) {
    char message[24];
    snprintf(message, sizeof(message), "perceptron %d", code);
    sayError(message);
    releaseHost();
    return;
  }

  const char* json = response.c_str();
  const char* faceAt = afterKey(json, "face_visible");
  const char* blinksAt = afterKey(json, "blink_count");
  const char* postureAt = afterKey(json, "posture_score");
  const char* headAt = afterKey(json, "head");
  const char* shouldersAt = afterKey(json, "shoulders");
  if (!faceAt || !blinksAt || !postureAt || !headAt || !shouldersAt) {
    sayError("parse");
    releaseHost();
    return;
  }

  bool face = faceAt[0] == 't';
  int blinks = atoi(blinksAt);
  if (blinks < 0) blinks = 0;
  if (blinks > 4) blinks = 4;
  int posture = postureOutOf100(atoi(postureAt));
  char head[16];
  char shoulders[16];
  readToken(headAt, head, sizeof(head));
  readToken(shouldersAt, shoulders, sizeof(shoulders));
  if (!knownHead(head)) strncpy(head, "unknown", sizeof(head));
  if (!knownShoulders(shoulders)) strncpy(shoulders, "unknown", sizeof(shoulders));

  uint32_t span = stamps[kPanels - 1] - stamps[0];
  PerchReading reading{face, blinks, posture, span > 4000u};
  PerchStep step = perch_apply(alerts, reading, millis());
  alerts = step.state;
  lastApplyMs = millis();
  printScore(face, blinks, posture, head, shoulders);
  if (step.buzz != kBuzzNone) startBuzz(step.buzz);
  if (step.note && step.note[0]) {
    Serial.print("note ");
    Serial.println(step.note);
  }
  postEvent(face, posture, head);
  releaseHost();
}

void acceptFrame() {
  uint32_t stamp = readLe32(payload);
  memcpy(frames[frameCount], payload + 4, kPixels);
  stamps[frameCount] = stamp;
  frameCount++;
  if (frameCount < kPanels) {
    Serial.println("ok");
    return;
  }
  scoreSheet();
}

void feed(uint8_t byte) {
  if (rxState == kWait0) {
    if (byte == kMagic0) rxState = kWait1;
    return;
  }
  if (rxState == kWait1) {
    if (byte == kMagic1) {
      rxState = kHeader;
      rxGot = 0;
      rxCrc = 0xFFFF;
    } else {
      rxState = byte == kMagic0 ? kWait1 : kWait0;
    }
    return;
  }
  if (rxState == kHeader) {
    header[rxGot++] = byte;
    rxCrc = crc16_add(rxCrc, byte);
    if (rxGot < 6) return;
    uint32_t length = readLe32(header + 2);
    if (header[0] != 1 || length != kPayloadLen) {
      sayError("bad frame");
      Serial.println("ok");
      rxState = kWait0;
      return;
    }
    rxState = kPayload;
    rxGot = 0;
    return;
  }
  if (rxState == kPayload) {
    payload[rxGot++] = byte;
    rxCrc = crc16_add(rxCrc, byte);
    if (rxGot >= kPayloadLen) {
      rxState = kCrc;
      rxGot = 0;
    }
    return;
  }
  crcBytes[rxGot++] = byte;
  if (rxGot < 2) return;
  uint16_t expected = (uint16_t)crcBytes[0] | ((uint16_t)crcBytes[1] << 8);
  rxState = kWait0;
  if (expected != rxCrc) {
    sayError("bad frame");
    Serial.println("ok");
    return;
  }
  acceptFrame();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(PERCH_WIFI_SSID, PERCH_WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 12000) delay(200);
  wifiUp = WiFi.status() == WL_CONNECTED;
  if (wifiUp) configTime(0, 0, "pool.ntp.org");
  else sayError("wifi");
  lastWifiTryMs = millis();
}

void setup() {
  pinMode(kBuzzerPin, OUTPUT);
  pinMode(kLedPin, OUTPUT);
  Serial.setRxBufferSize(16384);
  Serial.begin(921600);
  delay(200);
  if (!allocBoard()) {
    sayError("psram required");
    return;
  }
  ready = true;
  connectWifi();
  alerts = perch_initial(millis());
  hello();
}

void loop() {
  serviceBuzz();
  if (!ready) return;

  while (Serial.available() > 0) feed((uint8_t)Serial.read());

  uint32_t now = millis();
  if (!wifiUp && rxState == kWait0 && now - lastWifiTryMs > 15000) {
    WiFi.reconnect();
    lastWifiTryMs = now;
    wifiUp = WiFi.status() == WL_CONNECTED;
    if (wifiUp && !clockReady()) configTime(0, 0, "pool.ntp.org");
  } else if (WiFi.status() == WL_CONNECTED) {
    wifiUp = true;
  } else {
    wifiUp = false;
  }

  if (frameCount == 0 && rxState == kWait0 && now - lastHelloMs > 2000) hello();

  if (now - lastApplyMs > 200) {
    PerchStep step = perch_tick(alerts, now);
    if (step.buzz != kBuzzNone || (step.note && step.note[0])) applyBuzz(step);
    else alerts = step.state;
  }
}
