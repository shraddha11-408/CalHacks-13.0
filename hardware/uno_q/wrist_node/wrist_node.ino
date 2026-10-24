#include "Arduino_LED_Matrix.h"

ArduinoLEDMatrix matrix;

#define BUTTON_PIN 2
#define DEBOUNCE_MS 40

const uint32_t pattern[] = {
  0xFFFFFFFF,
  0xFFFFFFFF,
  0xFFFFFFFF
};

bool stableButton = LOW;
bool lastReading = LOW;

unsigned long lastChange = 0;
unsigned long ledUntil = 0;
unsigned long lastBlink = 0;

bool blinking = false;
bool ledState = false;
String command = "";

void showLED(bool on) {
  if (on) {
    matrix.loadFrame(pattern);
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

      if (command == "ACK") {
        blinking = false;
        showLED(true);
        ledState = true;
        ledUntil = millis() + 200;
      }

      else if (command == "BUZZ") {
        blinking = true;
        ledUntil = millis() + 1000;
        lastBlink = millis();
        ledState = true;
        showLED(true);
      }

      command = "";
    }
    else if (command.length() < 32) {
      command += c;
    }
  }

  // LED feedback
  now = millis();

  if (blinking && now - lastBlink >= 150) {
    lastBlink = now;
    ledState = !ledState;
    showLED(ledState);
  }

  if (ledUntil != 0 &&
      (long)(now - ledUntil) >= 0) {
    blinking = false;
    ledUntil = 0;
    ledState = false;
    showLED(false);
  }
}
