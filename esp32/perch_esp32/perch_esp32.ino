// Perch on an ESP32.
//
// The laptop is only a camera. Chrome sends 96x72 grayscale frames over USB.
// This board stores eight of them, builds one contact sheet, asks Perceptron
// Mk1.5, buzzes, and posts the posture number to Tiger Data for PERCH_DEVICE_ID.
//
// Open this file in Arduino IDE 2: esp32/perch_esp32/perch_esp32.ino
// Copy secrets.example.h to secrets.h and fill it in. secrets.h stays off git.
//
// Board: ESP32S3 Dev Module, USB CDC On Boot Enabled, PSRAM Enabled.
// Wi-Fi is 2.4 GHz only: a normal password, or an empty password for an open
// network. Not 5 GHz, and not a network that asks for a username (eduroam).
// Native USB ignores baud. The website opens the port at 921600.
// Close the Serial Monitor before the website connects. One program holds the port.
//
// Breadboard pins:
//   GPIO4  active buzzer +   (HIGH beeps, LOW is quiet). Buzzer - to GND.
//   GPIO5  green LED, GPIO6 yellow LED, GPIO7 red LED.
//          Each LED is GPIO -> 220 ohm -> long leg. Short leg to GND.
//   GPIO15 button to GND. Internal pull-up. LOW means pressed.
//   LCD1602 in 4-bit mode, no I2C: RS 8, E 9, D4 10, D5 11, D6 12, D7 13.
//          RW to GND. VSS GND, VDD 5V, backlight A to 5V through 220 ohm.
// Leave GPIO3 and GPIO46 unconnected.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LiquidCrystal.h>
#include <esp_heap_caps.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <esp_log.h>

#include "jpeg_gray.h"
#include "perch_alerts.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and fill in Wi-Fi, the device id, and the Perceptron key."
#endif

#if defined(CONFIG_IDF_TARGET_ESP32)
#error "Pick Tools > Board > ESP32S3 Dev Module. On an ESP32-WROVER, GPIO6-11 are the flash bus. This sketch drives those pins for the LEDs and LCD, and that stops Wi-Fi."
#endif

constexpr int kFrameW = 96;
constexpr int kFrameH = 72;
constexpr int kPixels = kFrameW * kFrameH;
constexpr int kPanels = 8;
constexpr int kSheetW = 584;
constexpr int kSheetH = 144;
constexpr int kPostureX = 392;
constexpr size_t kPayloadLen = 4 + kPixels;
constexpr size_t kJpegCap = 48 * 1024;
constexpr int kBuzzerPin = 4;
constexpr int kGreenPin = 5;
constexpr int kYellowPin = 6;
constexpr int kRedPin = 7;
constexpr int kButtonPin = 15;
constexpr uint32_t kButtonDebounceMs = 30;

LiquidCrystal lcd(8, 9, 10, 11, 12, 13);

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
static size_t bodyCap = 0;
static uint8_t* payload = nullptr;
static bool ready = false;
static bool wifiUp = false;
static bool wifiNoted = false;
static int wifiAttempt = 0;
static wl_status_t wifiBeginStatus = WL_IDLE_STATUS;
static uint32_t wifiDownSince = 0;
static PerchState alerts;
static uint32_t lastApplyMs = 0;
static uint32_t lastHelloMs = 0;
static uint32_t lastWifiTryMs = 0;

static bool buzzOn[20];
static int buzzMs[20];
static int buzzLen = 0;
static int buzzIndex = 0;
static uint32_t buzzUntil = 0;
static bool buzzing = false;
static bool buttonReading = false;
static bool buttonStable = false;
static uint32_t buttonChangeAt = 0;
static char lcdCache[2][17] = {"", ""};

enum RxState { kWait0, kWait1, kHeader, kPayload, kCrc };
static RxState rxState = kWait0;
static uint8_t header[6];
static size_t rxGot = 0;
static uint16_t rxCrc = 0xFFFF;
static uint8_t crcBytes[2];
static uint32_t rxMarkMs = 0;

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

void sayNote(const char* text) {
  if (!text || !text[0]) return;
  Serial.println(text);
}

void sayError(const char* text) {
  Serial.print("error ");
  Serial.println(text);
}

void releaseHost() {
  frameCount = 0;
  Serial.println("idle");
}

void hello() {
  Serial.print("device ");
  Serial.println(PERCH_DEVICE_ID);
  Serial.println("ready");
  lastHelloMs = millis();
}

void addBuzz(bool on, int ms) {
  if (buzzLen >= 20) return;
  buzzOn[buzzLen] = on;
  buzzMs[buzzLen] = ms;
  buzzLen++;
}

void startBuzz(PerchBuzz buzz) {
  buzzLen = 0;
  if (buzz == kBuzzBlink) {
    addBuzz(true, 80);
    addBuzz(false, 70);
    addBuzz(true, 80);
  } else if (buzz == kBuzzPosture) {
    for (int i = 0; i < 3; i++) {
      addBuzz(true, 120);
      if (i < 2) addBuzz(false, 80);
    }
  } else if (buzz == kBuzzBreak) {
    for (int i = 0; i < 10; i++) {
      addBuzz(true, 180);
      if (i < 9) addBuzz(false, 1800);
    }
  } else {
    return;
  }
  buzzIndex = 0;
  buzzUntil = 0;
  buzzing = true;
}

void silenceBuzz() {
  digitalWrite(kBuzzerPin, LOW);
  buzzing = false;
  buzzIndex = 0;
  buzzLen = 0;
  buzzUntil = 0;
}

void serviceBuzz() {
  if (!buzzing) {
    digitalWrite(kBuzzerPin, LOW);
    return;
  }
  uint32_t now = millis();
  if (buzzUntil != 0 && (int32_t)(now - buzzUntil) < 0) return;
  if (buzzIndex >= buzzLen) {
    digitalWrite(kBuzzerPin, LOW);
    buzzing = false;
    return;
  }
  bool on = buzzOn[buzzIndex];
  int ms = buzzMs[buzzIndex];
  buzzIndex++;
  digitalWrite(kBuzzerPin, on ? HIGH : LOW);
  buzzUntil = now + (uint32_t)ms;
}

void setLeds(bool green, bool yellow, bool red) {
  digitalWrite(kGreenPin, green ? HIGH : LOW);
  digitalWrite(kYellowPin, yellow ? HIGH : LOW);
  digitalWrite(kRedPin, red ? HIGH : LOW);
}

void paintLcd(const char* line0, const char* line1) {
  char rows[2][17];
  const char* lines[2] = {line0, line1};
  for (int row = 0; row < 2; row++) {
    memset(rows[row], ' ', 16);
    rows[row][16] = 0;
    for (int i = 0; i < 16 && lines[row][i]; i++) rows[row][i] = lines[row][i];
    if (strcmp(rows[row], lcdCache[row]) == 0) continue;
    memcpy(lcdCache[row], rows[row], 17);
    lcd.setCursor(0, row);
    lcd.print(rows[row]);
  }
}

void showStatus() {
  bool red = false;
  bool yellow = false;
  bool green = false;
  if (!ready) {
    setLeds(false, false, true);
    paintLcd("Need RAM", "Set OPI PSRAM");
    return;
  }
  if (buzzing && alerts.phase != kPhaseBreak) red = true;
  else if (alerts.phase == kPhaseBreak || !wifiUp || alerts.phase == kPhaseNoFace || alerts.postureScore < 0) yellow = true;
  else if (alerts.postureScore <= kPostureBadAt) red = true;
  else green = true;
  setLeds(green, yellow, red);

  if (alerts.phase == kPhaseBreak) {
    uint32_t left = alerts.breakUntil > millis() ? (alerts.breakUntil - millis()) / 1000u : 0;
    char line[20];
    snprintf(line, sizeof(line), "Break %lus", static_cast<unsigned long>(left));
    paintLcd(line, "Look away");
    return;
  }
  if (!wifiUp) {
    paintLcd("Wi-Fi down", PERCH_WIFI_SSID);
    return;
  }
  if (alerts.phase == kPhaseNoFace) {
    paintLcd("No face", "Step into frame");
    return;
  }
  if (alerts.postureScore < 0) {
    paintLcd("Waiting", PERCH_DEVICE_ID);
    return;
  }
  char line0[20];
  char line1[20];
  uint32_t gapMs = millis() - alerts.lastBlinkAt;
  snprintf(line0, sizeof(line0), "Posture %d", alerts.postureScore);
  snprintf(line1, sizeof(line1), "Blink %lu.%lus", static_cast<unsigned long>(gapMs / 1000u),
           static_cast<unsigned long>((gapMs / 100u) % 10u));
  paintLcd(line0, line1);
}

void beginBreak(uint32_t now) {
  if (alerts.phase == kPhaseBreak) return;
  alerts.phase = kPhaseBreak;
  alerts.breakUntil = now + kBreakDurationMs;
  alerts.badPostureStreak = 0;
  lastApplyMs = now;
  startBuzz(kBuzzBreak);
  sayNote("time for a break! look away for 20 seconds.");
}

void serviceButton() {
  bool pressed = digitalRead(kButtonPin) == LOW;
  uint32_t now = millis();
  if (pressed != buttonReading) {
    buttonReading = pressed;
    buttonChangeAt = now;
    return;
  }
  if (now - buttonChangeAt < kButtonDebounceMs) return;
  if (pressed && !buttonStable) {
    buttonStable = true;
    beginBreak(now);
  } else if (!pressed) {
    buttonStable = false;
  }
}

void applyBuzz(PerchStep step) {
  alerts = step.state;
  lastApplyMs = millis();
  if (step.buzz != kBuzzNone) startBuzz(step.buzz);
  sayNote(step.note);
}

uint8_t* allocBuf(size_t bytes) {
  uint8_t* buffer = nullptr;
  if (psramFound()) buffer = (uint8_t*)heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buffer) buffer = (uint8_t*)heap_caps_malloc(bytes, MALLOC_CAP_8BIT);
  return buffer;
}

void freeScratch() {
  free(sheet);
  free(jpeg);
  free(body);
  sheet = nullptr;
  jpeg = nullptr;
  body = nullptr;
  bodyCap = 0;
}

bool allocBoard() {
  for (int i = 0; i < kPanels; i++) {
    frames[i] = allocBuf(kPixels);
    if (!frames[i]) return false;
  }
  payload = allocBuf(kPayloadLen);
  return payload != nullptr;
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
  if (*used + n >= bodyCap) return false;
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

void ensureClock() {
  uint32_t start = millis();
  while (!clockReady() && millis() - start < 5000) delay(100);
  if (clockReady()) return;
  timeval tv;
  tv.tv_sec = 1792281600;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);
  Serial.println("clock was not set. using a fallback time so Perceptron can connect.");
}

void apiBase(char* out, size_t cap) {
  strncpy(out, PERCH_API_BASE, cap - 1);
  out[cap - 1] = 0;
  size_t n = strlen(out);
  if (n > 0 && out[n - 1] == '/') out[n - 1] = 0;
}

int postJson(const char* url, const uint8_t* data, size_t length, bool bearer, String* response, int timeoutMs) {
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(15);
  client.setHandshakeTimeout(15000);
  client.setBufferSizes(4096, 1024);
  HTTPClient http;
  if (!http.begin(client, url)) return -1;
  http.setTimeout(timeoutMs);
  http.setConnectTimeout(12000);
  http.setReuse(false);
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
  if (!face) {
    Serial.println("not saved to Tiger Data. face is hidden.");
    return;
  }
  if (!wifiUp) {
    sayError("wifi");
    Serial.println("not saved to Tiger Data. the ESP32 is not on Wi-Fi.");
    Serial.println("unsaved");
    return;
  }
  if (!clockReady()) {
    sayError("clock");
    Serial.println("not saved to Tiger Data. the clock is not set yet.");
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
  Serial.print("posting to Tiger Data. ");
  Serial.println(json);
  int code = postJson(url, (const uint8_t*)json, strlen(json), false, nullptr, 8000);
  if (code == 200 || code == 201) {
    Serial.println("saved to Tiger Data.");
    Serial.println("saved");
  } else {
    char message[64];
    snprintf(message, sizeof(message), "not saved to Tiger Data. the API returned %d.", code);
    Serial.println(message);
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
  silenceBuzz();
  Serial.println("scoring a contact sheet.");
  if (WiFi.status() != WL_CONNECTED) {
    wifiUp = false;
    sayError("wifi");
    Serial.println("not saved to Tiger Data. the ESP32 is not on Wi-Fi.");
    releaseHost();
    return;
  }
  sheet = allocBuf((size_t)kSheetW * kSheetH);
  jpeg = allocBuf(kJpegCap);
  if (!sheet || !jpeg) {
    freeScratch();
    sayError("ram");
    releaseHost();
    return;
  }
  composeSheet();
  size_t jpegSize = jpeg_gray_encode(sheet, kSheetW, kSheetH, 60, jpeg, kJpegCap);
  free(sheet);
  sheet = nullptr;
  if (jpegSize == 0) {
    freeScratch();
    sayError("jpeg");
    releaseHost();
    return;
  }

  bodyCap = strlen(kPrefix) + (4 * ((jpegSize + 2) / 3)) + strlen(kPrompt) + 80;
  body = allocBuf(bodyCap);
  if (!body) {
    freeScratch();
    sayError("ram");
    releaseHost();
    return;
  }
  size_t used = 0;
  if (!appendText(&used, kPrefix)) {
    freeScratch();
    sayError("jpeg");
    releaseHost();
    return;
  }
  size_t encoded = base64Into(jpeg, jpegSize, body + used, bodyCap - used);
  free(jpeg);
  jpeg = nullptr;
  if (encoded == 0) {
    freeScratch();
    sayError("jpeg");
    releaseHost();
    return;
  }
  used += encoded;
  if (!appendText(&used, "\"}},{\"type\":\"text\",\"text\":\"") || !appendText(&used, kPrompt) ||
      !appendText(&used, "\"}]}]}")) {
    freeScratch();
    sayError("jpeg");
    releaseHost();
    return;
  }

  silenceBuzz();
  if (WiFi.status() != WL_CONNECTED) {
    freeScratch();
    wifiUp = false;
    sayError("wifi");
    Serial.println("not saved to Tiger Data. the ESP32 is not on Wi-Fi.");
    releaseHost();
    return;
  }
  ensureClock();

  String response;
  int code = postJson("https://api.perceptron.inc/v1/chat/completions", body, used, true, &response, 12000);
  freeScratch();
  if (code != 200) {
    char message[96];
    snprintf(message, sizeof(message), "not saved to Tiger Data. Perceptron connection failed (%d), free heap %u.", code,
             ESP.getFreeHeap());
    Serial.println(message);
    if (code < 0) sayError("could not reach Perceptron");
    else {
      snprintf(message, sizeof(message), "perceptron %d", code);
      sayError(message);
    }
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
    Serial.println("not saved to Tiger Data. the score could not be read.");
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
  postEvent(face, posture, head);
  sayNote(step.note);
  releaseHost();
}

void acceptFrame() {
  uint32_t stamp = readLe32(payload);
  memcpy(frames[frameCount], payload + 4, kPixels);
  stamps[frameCount] = stamp;
  frameCount++;
  Serial.println("ok");
  if (frameCount < kPanels) return;
  scoreSheet();
}

void feed(uint8_t byte) {
  rxMarkMs = millis();
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

const char* wifiFailHint(wl_status_t status) {
  if (PERCH_WIFI_SSID[0] == '\0' || status == WL_NO_SSID_AVAIL) {
    return "That network name is not on 2.4 GHz. This board cannot join 5 GHz. Check secrets.h, or use a phone hotspot.";
  }
  if (status == WL_CONNECT_FAILED || wifiBeginStatus == WL_CONNECT_FAILED) {
    return "The password was rejected, or the network wants a username (eduroam, campus, hotel). Use a phone hotspot.";
  }
  return "The join timed out. Stay near the router, confirm the password in secrets.h, or use a phone hotspot.";
}

void noteWifiFailure(wl_status_t status) {
  if (wifiNoted) return;
  wifiNoted = true;
  sayError("wifi");
  Serial.print("Wi-Fi failed for \"");
  Serial.print(PERCH_WIFI_SSID);
  Serial.println("\".");
  Serial.println(wifiFailHint(status));
}

// WL_DISCONNECTED is the normal status while the radio is scanning. Core 3.x
// uses WL_IDLE_STATUS only after the AP accepts the board, while DHCP runs.
bool wifiStillJoining(wl_status_t status, uint32_t now) {
  if (wifiBeginStatus == WL_CONNECT_FAILED) return false;
  if (now - lastWifiTryMs >= 30000) return false;
  return status == WL_IDLE_STATUS || status == WL_DISCONNECTED || status == WL_NO_SHIELD;
}

void beginWifi() {
  lastWifiTryMs = millis();
  wifiNoted = false;
  wifiAttempt++;
  if (PERCH_WIFI_SSID[0] == '\0' || strlen(PERCH_WIFI_SSID) > 32 || strlen(PERCH_WIFI_PASSWORD) > 64) {
    wifiBeginStatus = WL_CONNECT_FAILED;
    Serial.println("secrets.h needs a Wi-Fi name of 1 to 32 characters and a password of 0 to 64.");
    return;
  }
  // Driver logs share this USB serial port with the frame protocol.
  esp_log_level_set("wifi", ESP_LOG_NONE);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
  WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
  if (PERCH_WIFI_PASSWORD[0] == '\0') {
    WiFi.setMinSecurity(WIFI_AUTH_OPEN);
    wifiBeginStatus = WiFi.begin(PERCH_WIFI_SSID);
  } else {
    WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);
    wifiBeginStatus = WiFi.begin(PERCH_WIFI_SSID, PERCH_WIFI_PASSWORD);
  }
  Serial.print("Joining Wi-Fi \"");
  Serial.print(PERCH_WIFI_SSID);
  Serial.print("\" attempt ");
  Serial.print(wifiAttempt);
  Serial.println(PERCH_WIFI_PASSWORD[0] == '\0' ? " (open network)." : " (password set).");
  if (wifiBeginStatus == WL_CONNECT_FAILED) {
    Serial.println("WiFi.begin failed immediately, so this attempt never started.");
  }
}

void connectWifi() {
  // Do not call WiFi.disconnect() before WiFi.begin(). On Arduino-ESP32 2.x,
  // begin() treats a failed esp_wifi_disconnect() as fatal and returns
  // without calling esp_wifi_connect(). A disconnect that is still in
  // progress also cancels the new join on 3.x.
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.mode(WIFI_STA);
  wifiUp = false;
  wifiDownSince = millis();
  beginWifi();
}

void restartWifi() {
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_OFF);
  delay(200);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.mode(WIFI_STA);
  beginWifi();
  wifiDownSince = millis();
}

void hardwareHello() {
  lcd.begin(16, 2);
  lcd.clear();
  memset(lcdCache, 0, sizeof(lcdCache));
  paintLcd("Perch", PERCH_DEVICE_ID);
  const int pins[] = {kGreenPin, kYellowPin, kRedPin};
  for (int pin : pins) {
    digitalWrite(pin, HIGH);
    delay(150);
    digitalWrite(pin, LOW);
  }
  digitalWrite(kBuzzerPin, HIGH);
  delay(80);
  digitalWrite(kBuzzerPin, LOW);
}

void setup() {
  pinMode(kBuzzerPin, OUTPUT);
  pinMode(kGreenPin, OUTPUT);
  pinMode(kYellowPin, OUTPUT);
  pinMode(kRedPin, OUTPUT);
  pinMode(kButtonPin, INPUT_PULLUP);
  digitalWrite(kBuzzerPin, LOW);
  setLeds(false, false, false);
  hardwareHello();
  Serial.setRxBufferSize(16384);
  Serial.begin(921600);
  Serial.setTxTimeoutMs(100);
  delay(200);
  if (!allocBoard()) {
    sayError("ram");
    Serial.println("note Tools > PSRAM > OPI PSRAM, then upload again. If that fails, choose QSPI PSRAM.");
    showStatus();
    return;
  }
  Serial.print("psram ");
  Serial.println(ESP.getPsramSize());
  if (!psramFound()) {
    Serial.println("note PSRAM is off. Set Tools > PSRAM to OPI PSRAM and upload again.");
  }
  ready = true;
  alerts = perch_initial(millis());
  hello();
  connectWifi();
  showStatus();
}

void loop() {
  serviceBuzz();
  serviceButton();
  showStatus();
  if (!ready) return;

  while (Serial.available() > 0) feed((uint8_t)Serial.read());

  uint32_t now = millis();
  if (rxState != kWait0 && now - rxMarkMs > 3000) {
    rxState = kWait0;
    rxGot = 0;
    Serial.println("error partial");
    Serial.println("ok");
  }
  wl_status_t wifiStatus = WiFi.status();
  if (wifiStatus == WL_CONNECTED) {
    wifiDownSince = 0;
    if (!wifiUp) {
      wifiUp = true;
      wifiNoted = false;
      wifiBeginStatus = WL_CONNECTED;
      configTime(0, 0, "pool.ntp.org");
      Serial.print("Wi-Fi connected. IP ");
      Serial.print(WiFi.localIP());
      Serial.print(" rssi ");
      Serial.println(WiFi.RSSI());
    }
  } else {
    wifiUp = false;
    if (wifiDownSince == 0) wifiDownSince = now;
    bool joining = wifiStillJoining(wifiStatus, now);
    uint32_t downFor = now - wifiDownSince;
    if (!joining && !wifiNoted && downFor > 3000) noteWifiFailure(wifiStatus);
    bool secretsOk = PERCH_WIFI_SSID[0] != '\0' && strlen(PERCH_WIFI_SSID) <= 32 && strlen(PERCH_WIFI_PASSWORD) <= 64;
    if (!joining && secretsOk && downFor > 15000 && rxState == kWait0 && frameCount == 0 && Serial.available() == 0) {
      restartWifi();
    }
  }

  delay(1);

  if (frameCount == 0 && rxState == kWait0 && now - lastHelloMs > 2000) hello();

  if (now - lastApplyMs > 200) {
    PerchStep step = perch_tick(alerts, now);
    if (step.buzz != kBuzzNone || (step.note && step.note[0])) applyBuzz(step);
    else alerts = step.state;
  }
}
