#include "SevSeg.h"

SevSeg sevseg;

void setup() {
  bool resistorsOnSegments = true;

  byte numDigits = 1;
  byte digitPins[] = {};
  byte segmentPins[] = {0, 1, 2, 3, 4, 5, 6, 7};
  byte hardwareConfig = COMMON_CATHODE;

  sevseg.begin(hardwareConfig, numDigits, digitPins, segmentPins, resistorsOnSegments);
  sevseg.setBrightness(90);
  delay(1000);
}

void loop() {
  for (int i = 9; i >= 0; i--) {
    sevseg.setNumber(i);
    sevseg.refreshDisplay();
    delay(1000);
  }
}
