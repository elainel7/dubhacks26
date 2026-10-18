// Perch on an ESP32.
//
// The laptop is only a camera. Chrome sends 96x72 grayscale frames over USB.
// This board stores four of them, builds one contact sheet, asks Perceptron
// Mk1.5, buzzes, and posts the posture number to Tiger Data for PERCH_DEVICE_ID.
//
// Open this file in Arduino IDE 2: esp32/perch_esp32/perch_esp32.ino
// Copy secrets.example.h to secrets.h and fill it in. secrets.h stays off git.
//
// Board: ESP32S3 Dev Module, USB CDC On Boot Enabled, PSRAM Enabled.
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
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

#include "jpeg_gray.h"
#include "perch_alerts.h"
#include "score_json.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Copy secrets.example.h to secrets.h and fill in Wi-Fi, the device id, and the Perceptron key."
#endif

constexpr int kFrameW = 96;
constexpr int kFrameH = 72;
constexpr int kPixels = kFrameW * kFrameH;
constexpr int kPanels = 2;
constexpr int kSheetW = 296;
constexpr int kSheetH = 72;
constexpr int kPostureX = 200;
constexpr size_t kPayloadLen = 4 + kPixels;
constexpr size_t kJpegCap = 32 * 1024;
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
    "Front-facing laptop camera. Dark contact sheet. Two left panels are blinks, left to right, a couple of seconds apart. "
    "A blink is lids covering the pupils. One shut panel counts, even if the eyes never open again in this sheet. "
    "eyes_closed is true when the second left panel is shut. If both are shut, blink_count is 0 and eyes_closed is true. "
    "The right panel with the white border is POSTURE. posture_score is 1 to 100: 100 upright, 60 or below is a slouch. "
    "head is upright, forward, or unknown. "
    "If no face, face_visible is false, blink_count is 0, eyes_closed is false, posture_score is 50, head is unknown.";

static const char kPrefix[] =
    "{\"model\":\"perceptron-mk1.5\",\"max_completion_tokens\":160,"
    "\"reasoning_effort\":\"none\",\"vision_config\":{\"enable_thinking\":false},"
    "\"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"desk_state\",\"strict\":true,\"schema\":{"
    "\"type\":\"object\",\"additionalProperties\":false,\"properties\":{"
    "\"face_visible\":{\"type\":\"boolean\"},"
    "\"blink_count\":{\"type\":\"integer\"},"
    "\"eyes_closed\":{\"type\":\"boolean\"},"
    "\"posture_score\":{\"type\":\"integer\"},"
    "\"head\":{\"type\":\"string\",\"enum\":[\"upright\",\"forward\",\"unknown\"]}"
    "},\"required\":[\"face_visible\",\"blink_count\",\"eyes_closed\",\"posture_score\",\"head\"]}}},"
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
static char cmd[8];
static uint8_t cmdLen = 0;
static volatile bool scoringNow = false;
static SemaphoreHandle_t serialMux = nullptr;
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
    for (int i = 0; i < 8; i++) {
      addBuzz(true, 40);
      addBuzz(false, 40);
    }
  } else if (buzz == kBuzzPosture) {
    addBuzz(true, 340);
    addBuzz(false, 160);
    addBuzz(true, 340);
    addBuzz(false, 160);
    addBuzz(true, 340);
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

void playBuzzNow(PerchBuzz buzz) {
  startBuzz(buzz);
  while (buzzing) {
    serviceBuzz();
    delay(5);
  }
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
  else if (alerts.postureScore <= kPostureBadAt || alerts.headForward) red = true;
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
    if (frameCount > 0) paintLcd("Watching", "Camera");
    else paintLcd("Ready", PERCH_DEVICE_ID);
    return;
  }
  char line0[20];
  snprintf(line0, sizeof(line0), "Posture %d", alerts.postureScore);
  paintLcd(line0, alerts.postureScore <= kPostureBadAt || alerts.headForward ? "Sit up" : "Upright");
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

void composeSheet() {
  memset(sheet, 18, (size_t)kSheetW * kSheetH);
  for (int i = 0; i < kPanels; i++) {
    blit(frames[i], kFrameW, kFrameH, i * kFrameW, 0);
  }
  blit(frames[kPanels - 1], kFrameW, kFrameH, kPostureX, 0);
  for (int y = 0; y < kFrameH; y++) {
    for (int x = 0; x < kFrameW; x++) {
      if (x < 4 || y < 4 || x >= kFrameW - 4 || y >= kFrameH - 4) {
        sheet[(size_t)y * kSheetW + kPostureX + x] = 255;
      }
    }
  }
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
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR < 3
  client.setBufferSizes(4096, 1024);
#endif
  HTTPClient http;
  if (!http.begin(client, url)) return -1;
  http.setTimeout(timeoutMs);
  http.setConnectTimeout(12000);
  http.setReuse(false);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept-Encoding", "identity");
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

/* getString() reserves the whole Content-Length in internal RAM and returns
   empty when that block is not free. The score is small; keep it in PSRAM. */
struct ReplyWriter : public Stream {
  uint8_t* data = nullptr;
  size_t cap = 0;
  size_t len = 0;

  bool begin() {
    cap = 20 * 1024;
    if (psramFound()) data = (uint8_t*)heap_caps_malloc(cap, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!data) data = (uint8_t*)heap_caps_malloc(cap, MALLOC_CAP_8BIT);
    if (!data) cap = 0;
    return data != nullptr;
  }

  size_t write(uint8_t byte) override {
    if (!data || len + 1 >= cap) return 1;
    data[len++] = byte;
    return 1;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};

int postPerceptron(const uint8_t* data, size_t length, char** reply, size_t* replyLen, int* announced) {
  if (reply) *reply = nullptr;
  if (replyLen) *replyLen = 0;
  if (announced) *announced = -1;
  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(20);
  client.setHandshakeTimeout(20000);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR < 3
  client.setBufferSizes(4096, 1024);
#endif
  HTTPClient http;
  if (!http.begin(client, "https://api.perceptron.inc/v1/chat/completions")) {
    freeScratch();
    return -1;
  }
  http.setTimeout(20000);
  http.setConnectTimeout(12000);
  http.setReuse(false);
  http.addHeader("Content-Type", "application/json");
  char auth[400];
  snprintf(auth, sizeof(auth), "Bearer %s", PERCH_PERCEPTRON_KEY);
  http.addHeader("Authorization", auth);
  int code = http.POST(const_cast<uint8_t*>(data), length);
  freeScratch();
  if (announced) *announced = http.getSize();
  if (code > 0 && reply && replyLen) {
    ReplyWriter sink;
    if (sink.begin()) {
      http.writeToStream(&sink);
      if (sink.len == 0) {
        WiFiClient* stream = http.getStreamPtr();
        uint32_t start = millis();
        while (stream && sink.len + 1 < sink.cap && millis() - start < 3000) {
          if (stream->available()) {
            int byte = stream->read();
            if (byte < 0) break;
            sink.data[sink.len++] = (uint8_t)byte;
          } else if (!stream->connected()) {
            break;
          } else {
            delay(10);
          }
        }
      }
      sink.data[sink.len] = 0;
      *reply = (char*)sink.data;
      *replyLen = sink.len;
    }
  }
  http.end();
  return code;
}

struct ScoringGate {
  ScoringGate() { scoringNow = true; }
  ~ScoringGate() {
    scoringNow = false;
    if (serialMux) {
      xSemaphoreTake(serialMux, portMAX_DELAY);
      xSemaphoreGive(serialMux);
    }
  }
};

void postEvent(bool face, int posture, const char* head, unsigned gapTenths, int blinksPerMinute) {
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

  if (gapTenths > 6000) gapTenths = 6000;
  if (blinksPerMinute < 0) blinksPerMinute = 0;
  if (blinksPerMinute > 300) blinksPerMinute = 300;
  char json[320];
  snprintf(json, sizeof(json),
           "{\"time\":\"%s\",\"user_id\":\"%s\",\"label\":\"%s\",\"confidence\":%d.%02d,\"blink_gap\":%u.%u,\"blinks_per_minute\":%d}",
           stamp, PERCH_DEVICE_ID, label, hundredths / 100, hundredths % 100, gapTenths / 10,
           gapTenths % 10, blinksPerMinute);
  char base[120];
  apiBase(base, sizeof(base));
  char url[160];
  snprintf(url, sizeof(url), "%s/events", base);
  Serial.print("posting to Tiger Data. ");
  Serial.println(json);
  int code;
  {
    ScoringGate scoring;
    (void)scoring;
    code = postJson(url, (const uint8_t*)json, strlen(json), false, nullptr, 8000);
  }
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

uint32_t blinkGapMs() {
  if (alerts.eyesShut) return alerts.heldGapMs;
  return millis() - alerts.lastBlinkAt;
}

void printScore(bool face, int blinks, int posture, const char* head, const char* shoulders) {
  uint32_t gapMs = blinkGapMs();
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
  size_t jpegSize = jpeg_gray_encode(sheet, kSheetW, kSheetH, 40, jpeg, kJpegCap);
  if (jpegSize == 0) jpegSize = jpeg_gray_encode(sheet, kSheetW, kSheetH, 25, jpeg, kJpegCap);
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
  paintLcd("Reading", "Scoring");

  char* reply = nullptr;
  size_t replyLen = 0;
  int announced = -1;
  int code;
  {
    ScoringGate scoring;
    (void)scoring;
    code = postPerceptron(body, used, &reply, &replyLen, &announced);
  }
  if (code != 200) {
    free(reply);
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
  if (!reply) {
    sayError("ram");
    releaseHost();
    return;
  }

  char excerpt[401];
  const char* atContent = strstr(reply, "\"content\"");
  deskScoreExcerpt(atContent ? atContent : reply, excerpt, sizeof(excerpt));
  if (!excerpt[0]) strncpy(excerpt, "(empty reply)", sizeof(excerpt));
  DeskScoreRead score;
  bool parsed = readDeskScore(reply, &score);
  if (!parsed) {
    Serial.print("note perceptron said ");
    Serial.print(replyLen);
    Serial.print(" bytes, announced ");
    Serial.print(announced);
    Serial.print(": ");
    Serial.println(excerpt);
    Serial.println("not saved to Tiger Data. the score could not be read.");
    Serial.print("error parse ");
    Serial.print(replyLen);
    Serial.print(" bytes: ");
    Serial.println(excerpt);
    free(reply);
    releaseHost();
    return;
  }
  free(reply);

  bool face = score.face;
  int blinks = score.blinks;
  int posture = score.posture;
  const char* head = score.head;
  const char* shoulders = score.shoulders;

  uint32_t span = stamps[kPanels - 1] - stamps[0];
  PerchReading reading{face, blinks, posture, span > 4000u, score.eyesClosed, strcmp(head, "forward") == 0};
  PerchStep step = perch_apply(alerts, reading, millis());
  alerts = step.state;
  lastApplyMs = millis();
  printScore(face, blinks, posture, head, shoulders);
  paintLcd("Saving", "Scores");
  uint32_t gapMs = blinkGapMs();
  unsigned gapTenths = gapMs / 100;
  postEvent(face, posture, head, gapTenths, alerts.blinksPerMinute);
  if (step.buzz != kBuzzNone) playBuzzNow(step.buzz);
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

void takeLaptopBlink() {
  uint32_t now = millis();
  PerchStep step = perch_note_blink(alerts, now);
  alerts = step.state;
  lastApplyMs = now;
}

void takeLaptopChirp() {
  uint32_t now = millis();
  if (alerts.blinkAlertSet && now - alerts.lastBlinkAlertAt < 2000) return;
  alerts.blinkAlertSet = true;
  alerts.lastBlinkAlertAt = now;
  playBuzzNow(kBuzzBlink);
}

void takeLaptopHonk() {
  uint32_t now = millis();
  if (alerts.lastPostureAlertAt != 0 && now - alerts.lastPostureAlertAt < static_cast<uint32_t>(kPostureRepeatMs)) return;
  alerts.postureAlertSet = true;
  alerts.lastPostureAlertAt = now;
  playBuzzNow(kBuzzPosture);
}

void feed(uint8_t byte);

/* Text commands only. A frame byte stays in the buffer for the main loop. */
void drainLaptopCmds() {
  if (rxState != kWait0) return;
  while (Serial.available() > 0) {
    int next = Serial.peek();
    if (next < 0 || next == (int)kMagic0) return;
    feed((uint8_t)Serial.read());
  }
}

void laptopCmdTask(void*) {
  for (;;) {
    if (scoringNow && serialMux && xSemaphoreTake(serialMux, pdMS_TO_TICKS(10)) == pdTRUE) {
      if (scoringNow) drainLaptopCmds();
      xSemaphoreGive(serialMux);
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void feed(uint8_t byte) {
  rxMarkMs = millis();
  if (rxState == kWait0) {
    if (byte == kMagic0) {
      rxState = kWait1;
      cmdLen = 0;
      return;
    }
    if (byte == '\n' || byte == '\r') {
      if (cmdLen == 5 && cmd[0] == 'b' && cmd[1] == 'l' && cmd[2] == 'i' && cmd[3] == 'n' && cmd[4] == 'k') {
        takeLaptopBlink();
      } else if (cmdLen == 5 && cmd[0] == 'c' && cmd[1] == 'h' && cmd[2] == 'i' && cmd[3] == 'r' && cmd[4] == 'p') {
        takeLaptopChirp();
      } else if (cmdLen == 4 && cmd[0] == 'h' && cmd[1] == 'o' && cmd[2] == 'n' && cmd[3] == 'k') {
        takeLaptopHonk();
      }
      cmdLen = 0;
      return;
    }
    if (byte >= 32 && byte < 127 && cmdLen < 7) cmd[cmdLen++] = (char)byte;
    else cmdLen = 0;
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

void beginWifi() {
  if (PERCH_WIFI_PASSWORD[0] == '\0') WiFi.begin(PERCH_WIFI_SSID);
  else WiFi.begin(PERCH_WIFI_SSID, PERCH_WIFI_PASSWORD);
}

void connectWifi() {
  esp_log_level_set("wifi", ESP_LOG_NONE);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);
  delay(100);
  beginWifi();
  lastWifiTryMs = millis();
  wifiUp = false;
  wifiNoted = false;
}

void hardwareHello() {
  lcd.begin(16, 2);
  lcd.clear();
  memset(lcdCache, 0, sizeof(lcdCache));
  paintLcd("no hunch club", PERCH_DEVICE_ID);
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
  Serial.println("note perch sketch ready");
  serialMux = xSemaphoreCreateMutex();
  xTaskCreate(laptopCmdTask, "chirp", 4096, nullptr, 1, nullptr);
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
    if (!wifiUp) {
      wifiUp = true;
      configTime(0, 0, "pool.ntp.org");
      Serial.println("Wi-Fi connected.");
    }
  } else {
    wifiUp = false;
    bool stillConnecting = wifiStatus == WL_IDLE_STATUS && now - lastWifiTryMs < 20000;
    if (!wifiNoted && !stillConnecting && now - lastWifiTryMs > 12000) {
      wifiNoted = true;
      sayError("wifi");
      Serial.println("not saved to Tiger Data. the ESP32 is not on Wi-Fi.");
    }
    if (!stillConnecting && rxState == kWait0 && now - lastWifiTryMs > 20000) {
      WiFi.disconnect(false, false);
      beginWifi();
      lastWifiTryMs = now;
    }
  }

  if (frameCount == 0 && rxState == kWait0 && now - lastHelloMs > 2000) hello();

  if (now - lastApplyMs > 200) {
    PerchStep step = perch_tick(alerts, now);
    if (step.buzz != kBuzzNone || (step.note && step.note[0])) applyBuzz(step);
    else alerts = step.state;
  }
}
