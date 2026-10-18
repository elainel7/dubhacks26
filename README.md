# no hunch club

Desk posture and blinks for one device id. The computer counts blinks. The board scores how you're sitting, and the site shows the record.

Two parts live in this repo.

- **Perch** (Next.js) opens on a device id. `/device/[deviceId]` shows only that device's posture: percent upright, good and bad posture, and the most common problem. The same screen turns footage collection on and off. There is no camera preview.
- **Posture API** stores numeric posture rows in Tiger Data. The static dashboard is `index.html` at the repo root, branded no hunch club, and published to nohunch.club. Instructions follow the Perch section.

## Layout

```
backend/     FastAPI app (api/), SQL (db/), seed script (scripts/), Python tests (tests/), requirements.txt, .env.example
web/         static no hunch club dashboard (index.html)
shared/      empty placeholder for code used by more than one app
index.html   copy of web/index.html
app/         Next.js pages: /, /device/[deviceId]
components/  Perch UI (kebab-case files, PascalCase components)
esp32/       ESP32 firmware. The board builds contact sheets, calls Perceptron, buzzes, and writes Tiger Data
lib/         device id and serial helpers
vision/      laptop camera peripheral. It sends frames. It does not score them
render.yaml  Render blueprint; posture-api runs with root directory backend
```

Porkbun Static Hosting publishes the `main` branch root to nohunch.club, so `index.html` stays at the repo root and must stay identical to `web/index.html`. The Perch Next.js app (`app/`, `components/`, `lib/`, `vision/`, `package.json`) also stays at the repo root. `vision/` sends camera frames to the ESP32. The live Perceptron key belongs in `esp32/perch_esp32/secrets.h`. `backend/.env.example` holds API placeholders and `DATABASE_URL`. Copy it to `backend/.env` for the posture API.

## Perch

The laptop is a USB camera for an ESP32. The ESP32 builds a grayscale contact sheet, asks Perceptron Mk1.5, buzzes on its own piezo, and posts the posture number to Tiger Data under the device id in its `secrets.h`. The website does not score and does not beep.

## Run the site

```bash
npm install
npm run dev
```

Open [http://localhost:43123](http://localhost:43123) in Chrome or Edge. Pull the latest `main` first if you already have a checkout.

1. The first page asks for a device id and opens the chart for that id. Use the id compiled into the ESP32.
2. Open a device id. **Not collecting footage** turns the webcam on and connects the ESP32. The button then reads **Collecting footage**. The page does not show the camera. Pick the board's USB serial port the first time. Chrome or Edge is required. The same button is on https://nohunch.club.
3. A 5-second stare buzzes on the board. Under 20 blinks in a minute buzzes again. Three posture scores of 60 or below buzz a different pattern. A 20-minute stretch starts a 20-second break buzz.

`npm test` checks the blink clock, the USB frame packet, and the posture event mapping.

## ESP32

The firmware lives at `esp32/perch_esp32/perch_esp32.ino`. On GitHub that folder is in [tiredwren/dubhacks2026](https://github.com/tiredwren/dubhacks2026).

1. Install Arduino IDE 2 and, in Boards Manager, the **esp32** package by Espressif.
2. **File → Open** and choose `esp32/perch_esp32/perch_esp32.ino`. The IDE loads `jpeg_gray` and `perch_alerts` from that same folder. Leave `esp32/tests/` alone. Those files are host checks, not part of the sketch.
3. Copy `secrets.example.h` to `secrets.h` in that folder. Fill in Wi-Fi, a device id (letters, numbers, hyphens, or underscores), and the Perceptron key. `secrets.h` is gitignored. Do not commit it.
4. Board **ESP32S3 Dev Module**, **USB CDC On Boot: Enabled**, **PSRAM: OPI PSRAM**. If the serial log says the PSRAM id could not be read, switch that menu to **QSPI PSRAM** and upload again. Native USB ignores baud. The website opens the port at 921600.
5. Wiring is fixed: active buzzer on GPIO 4 (HIGH beeps), green/yellow/red LEDs on GPIO 5/6/7, button on GPIO 15 to GND, LCD RS/E/D4–D7 on GPIO 8–13. Leave GPIO 3 and GPIO 46 empty.
6. Upload. On reset the LEDs flash green, yellow, then red, and the buzzer chirps. Serial Monitor at 921600 shows `device your-id`. Close the monitor before the website connects. The two cannot share the port.
7. Upload this sketch again after pulling. In Chrome, close Serial Monitor, open the device chart (or https://nohunch.club), and click **Not collecting footage**. Allow the camera and pick the USB port. The button changes to **Collecting footage**. The board prints `ready` before it accepts frames. A 5-second stare prints `looking at screen for too long!`. A Tiger Data write prints `posting to Tiger Data.` and then `saved to Tiger Data.` or `not saved to Tiger Data.` The chart reads saved scores every second. A new point appears when the board finishes a contact sheet and posts it.

The board prints `ok` after each frame and holds that reply while it calls Perceptron, so the laptop does not overrun the serial buffer. A missing face is not saved. A forward head is `leaning_forward`. Posture 60 or below is `slouching`. Anything else visible is `good`.

## Build plan

A lamp-clipped desk assistant. Perceptron Mk1.5 reads a short burst of webcam frames and returns a blink count and a posture score. The lamp buzzes. The site shows numeric history for the code printed on the device.

Window: Saturday 1:00pm through Sunday morning. A published weekend schedule lists submissions at 10:30am Sunday. Stop feature work at 9:30am and treat 10:00am as the deadline.

Working name is Perch. Rename it if you want. Do not spend the first hour naming it.

## Locked decisions

Call Perceptron Mk1.5, model id `perceptron-mk1.5`, at `https://api.perceptron.inc/v1`. That is the hosted vision model. Isaac 0.1 and Isaac 0.2 were removed from this API on September 25, 2026. Those ids return HTTP 404 `model_not_found`. Isaac 0.5 is the open 36-billion-parameter embodied model. It is not what you call for a live webcam tonight, and it will not fit on a hackathon laptop.

At the start, `GET /v1/models` with the API key and ask the Perceptron booth whether any Isaac id is turned on for DubHacks. If one is listed, put that id in `PERCEPTRON_MODEL`. If none is listed, stay on `perceptron-mk1.5`. Swapping the id does not change the rest of the pipeline. Mk1 is the previous hosted model (`perceptron-mk1`) if Mk1.5 errors. Docs: [Perceptron Mk1.5](https://docs.perceptron.inc/perceptron-mk1.5). Keys: [platform.perceptron.inc](https://platform.perceptron.inc).

The browser keeps a ring buffer of small JPEGs and sends about eight frames covering the last two seconds as `video_frames`. One snapshot cannot see a blink. Mk1.5 answers with JSON: face visible, blink count in that window, posture score from 1 to 10, head, shoulders. The laptop owns the clock, the cooldowns, and the buzzer. The Arduino only receives `B`, `P`, or `R`.

Frames go to Perceptron because that is how Mk1.5 sees. They are not written to Tiger Data, not sent to Gemini, and not sent to the website. Store one numeric row per completed response.

Clip a USB webcam, or the laptop, to the lamp. The lamp is the object a judge looks at.

The website asks for the device code and queries with that code as a bound parameter. Gemini invents candidate codes. Tiger Data is the list of codes already issued. Gemini also writes a two-sentence coach note from a numeric summary. The SQL itself stays in the server, written by you.

Put the app on a host that can run Next.js. Use GoDaddy for the domain and DNS. A GoDaddy Website Builder page can iframe the deployed app if you want the GoDaddy editor on screen. Builder sites cannot query Tiger Data on their own.

If Tiger Cloud is not accepting connections by 6:30pm, keep the same functions and write JSONL to disk. Swap in Postgres when the service is up. The demo does not wait on a signup email.

## What "done" is

A judge can:

1. Read a code taped to the lamp, type it into the site, and see only that device's numbers.
2. Watch a blink increment the counter once.
3. Stare, hear one blink reminder around 8 seconds, and see "seconds since blink" climb.
4. Slouch, see the 1–10 score fall, and hear a different sound after it stays low.
5. Press "Start 20-second break", look away, and hear the other reminders stay quiet for those 20 seconds.
6. On the dashboard, the network panel shows JSON numbers. Frames appear only on the monitor's call to your server, which forwards them to Perceptron.

Backup if the camera or wifi fails: a phone video of steps 2–5, plus the dashboard already loaded with seeded rows for a second code.

## Team split

Two people, in parallel. A third person owns the physical clip, the Arduino, and the pitch script, and otherwise fetches food and hardware.

One person: follow Track A through the alert sounds, then Track B's dashboard. Arduino, Gemini, and DNS are optional after the local demo works.

| Clock | Track A — vision and the lamp | Track B — data and the site |
| --- | --- | --- |
| 1:00–1:30 | Both: create the Next.js app and `npm install`. One person gets the Perceptron key, runs `GET /v1/models`, and times one `video_frames` call. Same person hits the hardware table for an Arduino, a passive piezo, a USB cable, and any webcam with a clip. | Both: Tiger Cloud account, service in the closest US West region, pooled connection string. Google AI Studio API key. GoDaddy domain only if one is already on the account. |
| 1:30–3:00 | Camera preview. A two-second, eight-frame burst returns a blink count that goes up when you blink twice. | Schema in the SQL editor. `lib/db.ts` with a JSONL fallback. Seed 2 hours of rows for code `demo-otter-42`. Dashboard draws that series. |
| 3:00–4:30 | The same response's posture score, 1–10, on screen. The loop repeats, one request at a time. | Device-code box. Unknown code and known-but-empty look different. Charts titled with units. |
| 4:30–5:30 | Alert state machine and three Web Audio patterns. "Start 20-second break" button. | `POST /api/samples` and `GET /api/series?device_id=`. Track A can post before Tiger is switched on. |
| 5:30–6:30 | Eat. Then one real row visible from a live session. If blink counts stay stuck at zero, stay on Track A. Read `usage.prompt_tokens` and estimate hourly cost before leaving the loop on. | Eat. Point `DATABASE_URL` at Tiger if `psql` or the SQL editor can `select count(*) from samples`. |
| 6:30–8:00 | Web Serial to the Arduino. Same three patterns. Tape the code to the lamp and clip the camera. | `POST /api/devices` mints a code with Gemini, inserts it only if Tiger does not already have it. Coach card from aggregate numbers. |
| 8:00–9:30 | Monitor copy: frames go to Perceptron Mk1.5, and Tiger stores numbers. Suppress alerts when the face is missing or the API errors. | Empty, loading, and error states. Confirm a second code cannot see the first code's rows. |
| 9:30–11:00 | One full pass on a single laptop. Fix the single worst bug. No new charts. | Same. |
| 11:00–12:30 | Pitch bullets and the 90-second script below. | Deploy. DNS from GoDaddy if it is quick. If the deploy fights you, stop and keep localhost as the demo. |
| 12:30–1:30 | Record the backup video while it works. Charge every battery. | Same. |
| 1:30–7:30 | Sleep. A broken deploy is a morning problem. | Sleep. |
| 7:30–9:00 | Venue wifi, camera permission, Chrome, and a fresh Perceptron call so you know the key still works. | Reload the dashboard. Re-seed if the database was the thing that failed. |
| 9:00–9:30 | One timed rehearsal out loud. | One timed rehearsal out loud. |
| 9:30–10:00 | Freeze. Tape, water, charger, backup video queued. | Freeze. |

## Repository

```
app/monitor/page.tsx          camera, scores, alerts, serial
app/dashboard/page.tsx        code box and charts
app/api/samples/route.ts      POST one numeric sample
app/api/series/route.ts       GET samples for one device_id
app/api/devices/route.ts      POST mint a code, GET check a code
app/api/coach/route.ts        POST aggregates to Gemini
app/api/seed/route.ts         dev-only seed, guarded by SEED_ENABLED=1
app/api/perceive/route.ts     frames in, Mk1.5 JSON out. Holds the API key.
lib/perceive.ts               request body, schema, token-spend cap
lib/alerts.ts                 blink clock and posture streak, from Mk1.5 numbers
lib/db.ts                     Tiger or JSONL
lib/gemini.ts                 codes and coach text
lib/beep.ts                   Web Audio patterns
lib/serial.ts                 Web Serial writer
arduino/perch_buzzer/perch_buzzer.ino
.env.local                    not committed
```

Create the app with the Next.js prompt (TypeScript, Tailwind, App Router, no `src` directory). Then:

```bash
npm install pg recharts
```

The Python SDK (`pip install "perceptron>=0.4.0"`) is the documented client. This plan uses `fetch` from the Next route so there is one server and the key stays off the browser. Switch to the SDK only if the HTTP shape fights you.

`.env.local`:

```
DATABASE_URL=postgres://USER:PASS@HOST:6432/tsdb?sslmode=require
PERCEPTRON_API_KEY=
PERCEPTRON_MODEL=perceptron-mk1.5
GEMINI_API_KEY=
GEMINI_MODEL=
SEED_ENABLED=1
```

Use the pooled Tiger connection string (the pooler port, often 6432). Copy `GEMINI_MODEL` from the model id AI Studio shows for Flash. Leave the Gemini key unset until the coach route exists. The monitor page must not import `lib/gemini.ts`, `lib/db.ts`, or the Perceptron key.

## Vision

Chrome. `getUserMedia`, draw into a canvas, and export JPEGs at a fixed size (384 by 288 is a good start). Every frame in one request must share dimensions. Keep the last few seconds in a ring buffer at 4 frames per second. Do not call the API on every camera frame.

`POST /api/perceive` accepts `{ "frames": [{ "jpeg_base64": "...", "timestamp_ms": 0 }, ...] }` with 8 frames and timestamps `0, 250, 500, ... 1750`. The route calls Perceptron and returns the parsed JSON plus `usage.prompt_tokens`. The browser never sees the API key.

One request in flight. When it returns, send the next non-overlapping window. If the round trip took so long that the buffer holds more than about 4 seconds, downsample to 8 frames spread across that gap and treat the sample as degraded: update the score, and do not fire a blink alert for a gap that wide. Dropping frames on the floor is better than a queue that falls behind.

First call of the night, before the loop exists: time it. If `reasoning_effort: "none"` returns 400, omit the field. If the round trip is over about 4 seconds, send 6 frames instead of 8 and keep the window at 2 seconds. Log `usage.prompt_tokens`. Input is $0.15 per million tokens and output is $1.50 per million on the Mk1.5 card. Extrapolate from that first call. The route should stop the loop and show the spend when the session crosses about $3, with a button to raise the cap. Turn Watching off while you eat.

Request shape:

```json
{
  "model": "perceptron-mk1.5",
  "reasoning_effort": "none",
  "max_completion_tokens": 200,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "desk_state",
      "strict": true,
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "face_visible": { "type": "boolean" },
          "blink_count": { "type": "integer" },
          "posture_score": { "type": "integer" },
          "head": { "type": "string", "enum": ["upright", "forward", "unknown"] },
          "shoulders": { "type": "string", "enum": ["level", "tilted", "unknown"] }
        },
        "required": ["face_visible", "blink_count", "posture_score", "head", "shoulders"]
      }
    }
  },
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "video_frames",
        "video_frames": {
          "frames": [
            { "image_url": { "url": "data:image/jpeg;base64,..." }, "timestamp_ms": 0 }
          ]
        }
      },
      { "type": "text", "text": "PROMPT BELOW" }
    ]
  }]
}
```

Prompt:

```
These frames are one webcam clip of a person at a laptop, in timestamp order, about 250ms apart.
blink_count is how many times the eyelids fully close and open again. Looking down is not a blink.
posture_score is an integer from 1 to 10 for the last frame. 10 is upright, head over the shoulders. 1 is a deep slouch or the head pushed at the screen.
If no face is visible, face_visible is false, blink_count is 0, posture_score is 5, head and shoulders are unknown.
Do not identify the person.
```

Clamp in the route: `blink_count` to 0–6, `posture_score` to 1–10. Require `finish_reason === "stop"` before using the JSON. A `length` finish is an incomplete answer. Discard it.

Send inline data URLs. Skip the Files API so you are not leaving uploads on Perceptron's storage.

The clock stays local, using the time the clip ended, not the time the response arrived. Otherwise model latency looks like a stare.

```ts
if (!faceVisible) {
  // freeze secondsSinceBlink, show "Step into frame", no buzz
} else if (blinkCount > 0) {
  lastBlinkAt = clipEndedAt;
}
secondsSinceBlink = (clipEndedAt - lastBlinkAt) / 1000;
blinksPerMinute = sum of blink_count over clips that ended in the last 60s;
```

Three posture scores in a row at 4 or below is the slouch streak. A missing face or a failed request resets nothing and fires nothing. Aim the camera so a passerby is not the person in frame. The prompt does not ask the model to choose among faces. If the booth is crowded, crop the canvas to the chair before you encode.

Store `head` and `shoulders` as text next to the integer score. The score is Mk1.5's number. There is no local weight vector to tune tonight.

## Alerts

Constants:

| Name | Value | Why |
| --- | --- | --- |
| Blink gap | 8 seconds by clip-end time | Long enough that a normal pause is quiet. Short enough to demo. |
| Bad posture | score ≤ 4 | Obvious slouch, not a fidget. |
| Posture hold | 3 scores in a row | About two or three windows. Ignores a reach for a cup. |
| Cooldown per alert | 45 seconds | Separate timers for blink and posture. |
| Break interval | 20 minutes | The 20-20-20 rule. |
| Break length | 20 seconds | Look away. Alerts suppressed the whole time. Do not call Mk1.5 during the break. |
| Sample period | one row per Mk1.5 response | A few hundred rows an hour. Fine for a hypertable. |

Patterns:

| Code | Meaning | Sound |
| --- | --- | --- |
| `B` | Blink | Two short high beeps |
| `P` | Posture | Three short low beeps |
| `R` | Break | Slow pulse for 20 seconds, LED on |

State is `LIVE` or `BREAK`. Break wins. Enter break from the 20-minute timer or from the demo button. On entry, send `R` once. While `now < breakUntil`, ignore blink and posture. When the break ends, set `lastBreakStarted = now` and return to `LIVE`.

The demo button is required. Judges will not wait 20 minutes.

Web Audio when serial is not connected: oscillator, same rhythm, so unplugging the board changes nothing about detection.

## Arduino

The live buzzer is the ESP32 sketch in `esp32/perch_esp32/`. The Uno file `arduino/perch_buzzer/perch_buzzer.ino` is the older letter-only buzzer (pin 8, 9600 baud). The chart button does not use it.

Passive piezo on pin 8, LED and a 220Ω resistor on pin 7, USB serial at 9600. `delay()` blocking the 20-second pattern is fine. The page sends `R` once and does not send `B` or `P` during the break.

```cpp
const int BUZZER = 8;
const int LED = 7;

void setup() {
  pinMode(BUZZER, OUTPUT);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void beep(int hz, int ms) {
  tone(BUZZER, hz, ms);
  delay(ms);
  noTone(BUZZER);
}

void loop() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == 'B') {
    beep(1800, 80);
    delay(70);
    beep(1800, 80);
  } else if (c == 'P') {
    beep(440, 120);
    delay(80);
    beep(440, 120);
    delay(80);
    beep(440, 120);
  } else if (c == 'R') {
    digitalWrite(LED, HIGH);
    for (int i = 0; i < 10; i++) {
      beep(880, 180);
      delay(1800);
    }
    digitalWrite(LED, LOW);
  }
}
```

Browser, after a click on "Connect buzzer":

```ts
const port = await navigator.serial.requestPort();
await port.open({ baudRate: 9600 });
const writer = port.writable.getWriter();
await writer.write(new TextEncoder().encode("B"));
```

Web Serial requires Chromium and a user gesture. The Connect button is that gesture.

Physical build: binder-clip or gooseneck the webcam to the lamp head, Arduino taped to the stem, piezo facing the person. The code is written on tape on the clip. If there is no webcam, the laptop webcam still proves the software, and the lamp with a buzzer is the prop beside it. Say that plainly if a judge asks.

## Tiger Data

In the Tiger Cloud SQL editor:

```sql
CREATE TABLE devices (
  device_id  TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE samples (
  time                 TIMESTAMPTZ NOT NULL,
  device_id            TEXT NOT NULL REFERENCES devices (device_id),
  seconds_since_blink  REAL NOT NULL,
  blinks_per_minute    REAL NOT NULL,
  posture_score        SMALLINT NOT NULL CHECK (posture_score BETWEEN 1 AND 10),
  head_state           TEXT,
  shoulder_state       TEXT,
  alert                TEXT
);

SELECT create_hypertable('samples', 'time', if_not_exists => TRUE);

CREATE INDEX samples_device_time ON samples (device_id, time DESC);
```

`head_state` and `shoulder_state` are the words Mk1.5 returned (`upright` / `forward` / `unknown`, and `level` / `tilted` / `unknown`). They explain a score when a judge asks. They are still not images.

Inserts and reads take `device_id` as `$1`. There is no route that lists devices.

```sql
INSERT INTO samples (
  time, device_id, seconds_since_blink, blinks_per_minute,
  posture_score, head_state, shoulder_state, alert
) VALUES (now(), $1, $2, $3, $4, $5, $6, $7);

SELECT time, seconds_since_blink, blinks_per_minute, posture_score, alert
FROM samples
WHERE device_id = $1
  AND time > now() - interval '8 hours'
ORDER BY time ASC;

SELECT
  round(avg(posture_score)::numeric, 1) AS avg_posture,
  round(avg(blinks_per_minute)::numeric, 1) AS avg_blink_rate,
  round(max(seconds_since_blink)::numeric, 1) AS longest_stare_sec,
  count(*) FILTER (WHERE alert = 'blink')   AS blink_alerts,
  count(*) FILTER (WHERE alert = 'posture') AS posture_alerts,
  count(*) FILTER (WHERE alert = 'break')   AS breaks
FROM samples
WHERE device_id = $1
  AND time > now() - interval '8 hours';
```

JSONL fallback, same fields, one JSON object per line in `data/samples.jsonl`. `claimDevice` appends to `data/devices.txt`. Guard the file with a simple lock or a single-threaded dev server (`next dev` is enough). Do not commit `data/`.

Sample body the browser sends:

```json
{
  "device_id": "brisk-otter-17",
  "seconds_since_blink": 6.2,
  "blinks_per_minute": 11,
  "posture_score": 8,
  "head_state": "upright",
  "shoulder_state": "level",
  "alert": null
}
```

`alert` is `null`, `"blink"`, `"posture"`, or `"break"`. Reject anything else. Reject scores outside 1–10. Reject a device id that is not in `devices`.

## Device codes

Format: `adjective-animal-NN`, lowercase, for example `brisk-otter-17`. Validate with `/^[a-z]{3,12}-[a-z]{3,12}-\d{2}$/`.

`POST /api/devices` with an empty body:

1. Ask Gemini for 8 codes, JSON only: `{"codes":["brisk-otter-17"]}`. Prompt text: two normal English words, an adjective and an animal, then two digits. No people, no medical words, no words about eyes, backs, or bodies.
2. Keep codes that match the regex.
3. `INSERT INTO devices (device_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING device_id`.
4. Return the first row that inserted.

If Gemini errors, time out after 4 seconds and draw from two arrays in `lib/words.ts` plus `crypto.randomInt(10, 100)`. Uniqueness is still the insert. Gemini is the naming step. Tiger Data is the record of which codes exist.

The monitor page has a "New device code" button that calls this once and displays the code in large type so you can write it on tape. It stores the code in `localStorage` under `perch-device-id`. The dashboard never shares that storage. The user types the code. That is the hard-coded-per-device input: one code issued per lamp, typed in, not a shared account.

`GET /api/devices?device_id=brisk-otter-17` returns `{ "exists": true }` or `{ "exists": false }`. The dashboard uses this to choose "That code has not been issued" versus an empty chart for a real code.

Seed code `demo-otter-42` is inserted by the seed route so the projector can show history with the camera covered.

## Coach note

`POST /api/coach` with `{ "device_id": "brisk-otter-17" }` runs the aggregate SQL above and sends only that JSON to Gemini.

Prompt:

```
You write a two-sentence desk coach note from numbers.
Return JSON {"headline":"","detail":""}.
Headline is under 12 words. Detail is under 40 words.
Use only the numbers given. Do not mention video, photos, or cameras.
If a value is null, say there is not enough data yet.
```

Temperature 0.4. If the key is missing or the call fails, the dashboard still shows avg posture, avg blink rate, longest stare, and alert counts. The sentence is an extra.

Gemini never sees SQL text, connection strings, or frames. Do not ask the model to write the query.

## Dashboard

One page.

- Text field, label "Device code", button "Show this desk".
- Loading line while the request is in flight.
- Unknown code, empty history, and server error are three different sentences.
- Line chart: posture score (1–10) against time, last 8 hours.
- Line chart: blinks per minute against time.
- Line chart: seconds since last blink against time.
- Three counts: blink reminders, posture reminders, breaks.

Poll every 5 seconds while a code is on screen so the live demo moves. Y axes labeled with the unit. A point with `alert === "break"` can be a second series or left as a count. Do not block the chart on the coach request.

Monitor page copy, short:

- Title: Perch
- Line under it: Perceptron Mk1.5 scores blinks and posture. This site and the database store numbers. Frames are not kept.
- Big numbers: seconds since a blink, blinks this minute, posture out of 10.
- Buttons: Watching, Connect buzzer, Start 20-second break, New device code.

## GoDaddy and deploy

Deploy the Next.js app to whatever host you can finish (Vercel is the short path). In GoDaddy DNS, add the CNAME the host shows you for `www`. Propagation may not finish before judging. Localhost on the demo laptop is the primary path. The domain is the second path.

If you want a GoDaddy-hosted page in the pitch: a single page in Website Builder with an embed/iframe of the deployed URL, and the device-code field living in the app inside the frame. Spend this only after the localhost demo has survived a full rehearsal.

Add `data/` and `.env.local` to `.gitignore` before the first real commit of the app.

## 90-second demo

1. Lamp in frame, code visible on tape. "This clips to a lamp. Perceptron Mk1.5 reads a two-second burst and returns numbers. The lamp buzzes. The site only stores those numbers."
2. Dashboard already open on `demo-otter-42` so charts exist if live data hiccups. Then type the lamp's code.
3. Blink twice. Counter moves by two.
4. Stare. One double beep near 8 seconds. Point at seconds-since-blink.
5. Slouch and hold. Score drops. Three low beeps. Sit up, score recovers.
6. Start the 20-second break. Turn away from the camera. The other beep stays silent. Come back.
7. Type `demo-otter-42` or a garbage code. Different person, different numbers, or "not issued". Your rows did not follow you.

Then one sentence: Gemini proposes the code, Tiger Data accepts it once, and neither of them receives a frame.

## Pitch, six lines

1. At a screen, blink rate falls and posture folds. People notice when the headache is already there.
2. Perch is a clip for the lamp already on the desk.
3. Live demo.
4. Perceptron Mk1.5, the hosted model in the Mk line, returns a blink count and a 1–10 posture score from each two-second burst. Isaac 0.1 and 0.2 are retired on that API. We checked `/v1/models`.
5. Each response becomes one Tiger Data row for that device code. The site will not draw a chart without the code.
6. The buzzer is the product. The website is the record.

## Morning checks

- Cover the camera: "Step into frame", no beep.
- One blink, one count.
- Stare: a single blink reminder, then silence for the cooldown.
- Slouch through three bad scores: the other sound.
- Break button: countdown, no other sounds, LED on if the board is connected.
- Second code does not show the first code's rows.
- `POST /api/samples` is the JSON above, with no image field. `POST /api/perceive` is the only request that contains frames.
- Unplug the Arduino: the laptop still beeps.
- Perceptron errors or a covered camera: "Step into frame" or "Perceptron unreachable", and no beep.

## Time sinks

- Vision on the Arduino or an ESP32-CAM. The board is a buzzer. Mk1.5 runs in Perceptron's cloud.
- Self-hosting Isaac 0.5, or calling `isaac-0.1` / `isaac-0.2-1b` / `isaac-0.2-2b-preview` and debugging the 404. Check `/v1/models` once, then use the id that is actually listed.
- Sending one JPEG every second and expecting blinks. A blink is shorter than the gap between snapshots. Send a two-second `video_frames` burst.
- Asking Gemini to generate SQL on every page view. You will debug invented queries instead of demoing.
- Building the charts inside GoDaddy Website Builder. DNS or an iframe only.
- Leaving the watch loop on while you eat. Read `usage.prompt_tokens` from the first call, extrapolate, and keep the on-screen spend cap.
- A new alert idea after 11pm. Write it in the README and leave the code alone.
- Skipping sleep to chase the deploy. The local demo is the grade.

## Database

Posture labels from the camera feed are stored in Tiger Data (TimescaleDB on Postgres). The pages call each id a device id. The API and the database still name that field `user_id`. Seeded device ids are `user_1` and `user_2`. Schema, the one-minute continuous aggregate, and a seed script live in `backend/`.

Copy `backend/.env.example` to `backend/.env` and set `DATABASE_URL`. `.env` is gitignored — do not commit credentials. From the repo root:

```bash
cd backend
pip install -r requirements.txt
set -a && source .env && set +a
```

Apply the schema and the continuous aggregate as two separate `psql` runs, still inside `backend/`:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/aggregates.sql
```

Seed fake posture events (default 6 hours; pass a number of hours as the first argument) and refresh `posture_per_minute`:

```bash
python scripts/seed.py
# python scripts/seed.py 12
```

`scripts/seed.py` reads `DATABASE_URL` from the environment.

## API

A small FastAPI app reads `posture_per_minute` and accepts camera events. From `backend/`, with `DATABASE_URL` set:

```bash
uvicorn api.main:app --port 8000
```

Run the API tests from `backend/`. They do not open a database connection:

```bash
python -m unittest tests.test_api -v
```

Interactive docs are at `http://127.0.0.1:8000/docs`.

- `GET /users/{user_id}/live` — raw scores from `posture_events` for the last 10 minutes, up to 600 rows. Each row adds `posture` (confidence × 100, clamped 0–100). The chart calls this every second.
- `GET /users/{user_id}/timeline?hours=6` — per-minute `good_samples` and `bad_samples` from `posture_per_minute`. `hours` is optional (default 6, max 168).
- `GET /users/{user_id}/summary?hours=6` — percent good posture from that aggregate, and the most common bad label from `posture_events` in the same window.
- `POST /events` — insert one event. JSON body: `time`, `user_id`, `label`, `confidence` (0–1). Example labels: `good`, `slouching`, `leaning_forward`, `head_tilt`.

```bash
curl -s "http://127.0.0.1:8000/users/user_1/summary?hours=6"
curl -s -X POST "http://127.0.0.1:8000/events" \
  -H "content-type: application/json" \
  -d '{"time":"2026-10-17T20:00:00Z","user_id":"user_1","label":"good","confidence":0.95}'
```

## Points

Points are computed when you ask for them. They are not stored, and there is no new table. One read of `posture_per_minute` is enough. The rules live as named constants in `backend/api/points.py`.

- An upright minute has at least 3 samples and at least 70% `good` samples. It is worth 10 base points. Every other minute is worth 0.
- A flow streak is consecutive upright minutes. A non-upright minute breaks it, and so does a gap of more than 2 minutes with no considered minute. Minutes 1–4 pay ×1, minute 5 pays ×1.5, minute 15 pays ×2, and minute 30 pays ×3.
- A quick fix is +15 once when an upright minute follows a non-upright minute within 3 minutes.
- 60 upright minutes in one local day pays +100 once. Pass `tz` (default `America/Los_Angeles`) to choose the calendar.
- A day streak is consecutive local days with at least 30 upright minutes. Day n of that streak adds n × 5% of that day's base points (10 per upright minute), capped at +50%. Today does not break the streak until the day is over.
- After the multiplier and the quick fix, a minute is capped at 60 points. The daily goal and the day-streak percent sit outside that cap.
- XP is the points in the requested window. Finishing level n takes `100 * n * (n + 1) / 2` cumulative points. Level 1 starts at 0. The titles run from Slouch Survivor through Perch Legend.
- Badges (first upright minute, 10- and 30-minute flow, hour of power, comeback kid, three- and seven-day streaks, night owl, early bird) are derived from the same rows.

```bash
curl -s "http://127.0.0.1:8000/users/user_1/points?hours=168&tz=America/Los_Angeles"
curl -s "http://127.0.0.1:8000/leaderboard?hours=168&limit=10"
```

`hours` defaults to 168 and cannot exceed 2160. The leaderboard returns rank, `display_name` (or the device id when `users.display_name` is missing), and points. The device page and the static dashboard still show points. Those numbers come from the minute rollup, so they lag about a minute. The posture graph itself does not: it reads `/live` every second.

CORS is open so a static site on another origin can call the API. There is no auth. A device id is a plain string such as `user_1` or `user_2`, sent on the wire as `user_id`. Do not rename the live paths `/users/{user_id}/timeline`, `/users/{user_id}/summary`, or `POST /events`, or the database columns.

A new event lands in `posture_events` immediately. It shows up in `posture_per_minute` after the refresh policy runs (about a minute), or when `backend/scripts/seed.py` refreshes the aggregate.

## Dashboard

`web/index.html` is a single static Perch page: the same brand and tagline as the Next.js app ("No more hunching."), a device id selector (`user_1`, `user_2`), a posture score chart for the last 10 minutes, percent upright, and the most common problem. The page reloads `/live` every second. There is no 1-hour, 6-hour, or 24-hour picker on that chart. Chart.js is loaded from a CDN, so there is no build step. The root `index.html` is a byte-identical copy.

`API_BASE` at the top of `web/index.html` is the live API, with no trailing slash:

```javascript
const API_BASE = "https://posture-api-x1my.onrender.com";
```

For a local API, point that constant at `http://127.0.0.1:8000` instead.

Locally, from the repo root, serve the page (opening the file directly can block requests from the page):

```bash
python -m http.server 8080 --directory web
```

Then open `http://127.0.0.1:8080`.

## Deploy

The API is live at https://posture-api-x1my.onrender.com. `API_BASE` is that URL with no trailing slash. Porkbun Static Hosting publishes the repo root to nohunch.club on each push to main, so the root `index.html` is the page that gets published. Keep it identical to `web/index.html`. CORS allows any origin, so https://nohunch.club can call the API.

`render.yaml` stays at the repo root, where Render looks for a blueprint. The `posture-api` service sets `rootDir: backend`, so the build command `pip install -r requirements.txt` and the start command `uvicorn api.main:app --host 0.0.0.0 --port $PORT` run inside `backend/`. `DATABASE_URL` is `sync: false`: set it in the Render dashboard. It is not stored in the repo. If an existing service does not pick up `rootDir` from the blueprint, set Root Directory to `backend` on the Render service.
