# perch — ESP32-S3 breadboard wiring

This is how Brinda's breadboard is wired. `esp32/perch_esp32/perch_esp32.ino` uses these pins.

## Buzzer (active buzzer)
| Buzzer leg | Connects to |
|---|---|
| + (long leg) | `GPIO4` |
| − | GND |

It's an **active** buzzer: drive the pin HIGH to beep and LOW to stop (`digitalWrite`). Don't use `tone()`.

## LEDs
Each LED is wired as: GPIO → 220 Ω resistor → LED long leg (anode). The short leg (cathode) goes to GND.

| LED | GPIO |
|---|---|
| Green | `GPIO5` |
| Yellow | `GPIO6` |
| Red | `GPIO7` |

HIGH turns an LED on.

## Button
| Button leg | Connects to |
|---|---|
| One leg | `GPIO15` |
| Other leg | GND |

Use `pinMode(15, INPUT_PULLUP)`. The pin reads **LOW when pressed**. Debounce it in software (about 30 ms).

## LCD1602 (parallel, 4-bit mode, no I2C adapter)
| LCD pin | Connects to |
|---|---|
| VSS | GND |
| VDD | 5V |
| V0 | 10k potentiometer middle pin (wiper); the pot's outer pins go to 5V and GND. This sets the contrast. |
| RS | `GPIO8` |
| RW | GND (write-only) |
| E | `GPIO9` |
| D0–D3 | not connected |
| D4 | `GPIO10` |
| D5 | `GPIO11` |
| D6 | `GPIO12` |
| D7 | `GPIO13` |
| A (backlight +) | 5V through a 220 Ω resistor |
| K (backlight −) | GND |

In code (built-in `LiquidCrystal` library):
```cpp
#include <LiquidCrystal.h>
LiquidCrystal lcd(8, 9, 10, 11, 12, 13);  // RS, E, D4, D5, D6, D7
void setup() { lcd.begin(16, 2); }
```

## Power and general notes
- All grounds are shared: the ESP32-S3's GND goes to the breadboard GND rail.
- The 5V rail comes from the S3's 5V/VBUS pin, which is powered over USB.
- Leave `GPIO3` and `GPIO46` unconnected (they're strapping pins).
- The board connects to the laptop over the S3's native USB port. Arduino IDE setting: **USB CDC On Boot: Enabled**. Native USB ignores baud. The website opens the port at 921600.

## Quick pin summary
| GPIO | Part |
|---|---|
| 4 | Active buzzer |
| 5 | Green LED |
| 6 | Yellow LED |
| 7 | Red LED |
| 8 | LCD RS |
| 9 | LCD E |
| 10–13 | LCD D4–D7 |
| 15 | Button (to GND, INPUT_PULLUP) |
