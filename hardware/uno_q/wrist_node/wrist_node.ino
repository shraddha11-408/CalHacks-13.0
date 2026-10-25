#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

#define BUTTON_PIN 2
#define DEBOUNCE_MS 40

// The Uno Q matrix is 13 columns x 8 rows (the Uno R4 is 12x8, do not copy its frames).
// loadFrame takes uint32_t[4]: 104 pixels row-major, first pixel = MSB of word 0.
// Regenerate with: python3 hardware/uno_q/matrix_frames.py

//   #############
//   #############
//   #############
//   #############
//   #############
//   #############
//   #############
//   #############
const uint32_t ALL_ON[] = { 0xffffffff, 0xffffffff, 0xffffffff, 0xff000000 };

// Two 5x7 letters fit per frame, so "CALL" alternates CA and LL.
//   ..###...###..
//   .#...#.#...#.
//   .#.....#...#.
//   .#.....#####.
//   .#.....#...#.
//   .#...#.#...#.
//   ..###..#...#.
//   .............
const uint32_t CALL_CA[] = { 0x38e22890, 0x4483e411, 0x2288e440, 0x00000000 };
//   .#.....#.....
//   .#.....#.....
//   .#.....#.....
//   .#.....#.....
//   .#.....#.....
//   .#.....#.....
//   .#####.#####.
//   .............
const uint32_t CALL_LL[] = { 0x41020810, 0x40820410, 0x2081f7c0, 0x00000000 };

// Border frame to check alignment on the real matrix (serial command TEST).
//   #############
//   #...........#
//   #...........#
//   #...........#
//   #...........#
//   #...........#
//   #...........#
//   #############
const uint32_t TEST_BORDER[] = { 0xfffc0060, 0x03001800, 0xc006003f, 0xff000000 };
// "Note sent" (serial command NOTE): the laptop has told the supervisor after a short touch.
//   .............
//   ..........#..
//   .........##..
//   ..#.....##...
//   ..##...##....
//   ...##.##.....
//   ....###......
//   .....#.......
const uint32_t NOTE_CHECK[] = { 0x00000100, 0x18418318, 0x0d803800, 0x80000000 };
#define NOTE_MS 1500
#define CALL_MS 2000
#define CALL_FLIP_MS 400

bool stableButton = LOW;
bool lastReading = LOW;

unsigned long lastChange = 0;
unsigned long ledUntil = 0;
unsigned long lastBlink = 0;

bool calling = false;
bool callLL = false;
String command = "";

void showLED(bool on) {
  if (on) {
    matrix.loadFrame(ALL_ON);
  } else {
    matrix.clear();
  }
}

void setup() {
  Serial.begin(115200);

  // External 10k pull-down required
  pinMode(BUTTON_PIN, INPUT);

  matrix.begin();
  matrix.clear();
}

void loop() {
  unsigned long now = millis();

  // Button debounce
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastReading) {
    lastChange = now;
  }

  if (now - lastChange >= DEBOUNCE_MS) {
    if (reading != stableButton) {
      stableButton = reading;

      if (stableButton == HIGH) {
        Serial.println("DOWN");
      } else {
        Serial.println("UP");
      }
    }
  }

  lastReading = reading;

  // Receive commands from laptop
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n') {
      command.trim();

      // While CALL is on screen, every command from the laptop is dropped (not queued),
      // so a late ACK, TEST or second BUZZ cannot cut the animation short.
      if (calling) {
        command = "";
        continue;
      }

      if (command == "ACK") {
        showLED(true);
        ledUntil = millis() + 200;
      }

      else if (command == "NOTE") {
        matrix.loadFrame(NOTE_CHECK);
        ledUntil = millis() + NOTE_MS;
      }

      else if (command == "TEST") {
        matrix.loadFrame(TEST_BORDER);
        ledUntil = millis() + 3000;
      }

      else if (command == "BUZZ") {
        calling = true;
        callLL = false;
        matrix.loadFrame(CALL_CA);
        lastBlink = millis();
        ledUntil = millis() + CALL_MS;
      }

      command = "";
    }
    else if (command.length() < 32) {
      command += c;
    }
  }

  // LED feedback
  now = millis();

  if (calling && now - lastBlink >= CALL_FLIP_MS) {
    lastBlink = now;
    callLL = !callLL;
    matrix.loadFrame(callLL ? CALL_LL : CALL_CA);
  }

  if (ledUntil != 0 &&
      (long)(now - ledUntil) >= 0) {
    calling = false;
    ledUntil = 0;
    showLED(false);
  }
}
