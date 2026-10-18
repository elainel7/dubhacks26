// Older Uno buzzer. The live firmware is esp32/perch_esp32/perch_esp32.ino.
// That ESP32 receives the camera, scores, buzzes, and writes Tiger Data.
// This sketch only plays B, P, or R if something still sends those letters.
//
// Wiring:
//   Passive piezo +  -> digital pin 8
//   Passive piezo -  -> GND
//   LED anode        -> 220 ohm resistor -> digital pin 7
//   LED cathode      -> GND
// The LED is optional. The piezo is the product.
//
// Flash this sketch, then in Chrome click "Connect Uno" and pick the port.

const int BUZZER = 8;
const int LED = 7;

void setup() {
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  digitalWrite(LED, HIGH);
  delay(120);
  digitalWrite(LED, LOW);
  Serial.println("perch");
}

void beep(int hz, int ms) {
  tone(BUZZER, hz, ms);
  delay(ms);
  noTone(BUZZER);
}

void loop() {
  if (!Serial.available()) return;
  char command = Serial.read();

  if (command == 'B') {
    digitalWrite(LED, HIGH);
    beep(1800, 80);
    delay(70);
    beep(1800, 80);
    digitalWrite(LED, LOW);
  } else if (command == 'P') {
    digitalWrite(LED, HIGH);
    beep(440, 120);
    delay(80);
    beep(440, 120);
    delay(80);
    beep(440, 120);
    digitalWrite(LED, LOW);
  } else if (command == 'R') {
    digitalWrite(LED, HIGH);
    for (int i = 0; i < 10; i++) {
      beep(880, 180);
      delay(1800);
    }
    digitalWrite(LED, LOW);
  }
}
