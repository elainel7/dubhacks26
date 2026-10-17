# Perch — DubHacks build plan

A lamp-clipped desk assistant that watches blinks and posture while you work, buzzes when you should blink, sit up, or look away for 20 seconds, and shows only numeric history for the code printed on the device.

Window: Saturday 1:00pm through Sunday 10:00am. Demo-ready means the checklist at the bottom of the schedule, not every integration. Stop feature work at 9:30am.

Working name is Perch. Rename it if you want. Do not spend the first hour naming it.

## Locked decisions

Run face and pose vision in Chrome on the laptop, with MediaPipe, on video that never leaves the machine. The Arduino only receives one-letter commands and drives a buzzer and an LED. Clip a USB webcam (or the laptop, if that is all you have) to the lamp. The "device" the judge sees is the lamp. The computer is allowed to be the brain.

Store one row every 5 seconds in Tiger Data (Tiger Cloud, Postgres). Columns are numbers plus a short alert name. No images, no landmarks, no frames.

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
6. Open the network panel and see JSON numbers. No image payloads.

Backup if the camera or wifi fails: a phone video of steps 2–5, plus the dashboard already loaded with seeded rows for a second code.

## Team split

Two people, in parallel. A third person owns the physical clip, the Arduino, and the pitch script, and otherwise fetches food and hardware.

One person: follow Track A through the alert sounds, then Track B's dashboard. Arduino, Gemini, and DNS are optional after the local demo works.

| Clock | Track A — vision and the lamp | Track B — data and the site |
| --- | --- | --- |
| 1:00–1:30 | Both: create the Next.js app, `npm install`, download the two `.task` model files into `public/models`. One person goes to the hardware table for an Arduino, a passive piezo, a USB cable, and any webcam with a clip. | Both: Tiger Cloud account, service in the closest US West region, pooled connection string. Google AI Studio API key. GoDaddy domain only if one is already on the account. |
| 1:30–3:00 | Camera preview and a live blink count from Face Landmarker blendshapes. | Schema in the SQL editor. `lib/db.ts` with a JSONL fallback. Seed 2 hours of rows for code `demo-otter-42`. Dashboard draws that series. |
| 3:00–4:30 | Pose Landmarker, 3-second "sit upright" calibration, posture score 1–10 on screen. | Device-code box. Unknown code and known-but-empty look different. Charts titled with units. |
| 4:30–5:30 | Alert state machine and three Web Audio patterns. "Start 20-second break" button. | `POST /api/samples` and `GET /api/series?device_id=`. Track A can post before Tiger is switched on. |
| 5:30–6:30 | Eat. Then one real row visible from a live session. If the face tracker is still at zero blinks, stay on Track A and cut pose before you cut blinks. | Eat. Point `DATABASE_URL` at Tiger if `psql` or the SQL editor can `select count(*) from samples`. |
| 6:30–8:00 | Web Serial to the Arduino. Same three patterns. Tape the code to the lamp and clip the camera. | `POST /api/devices` mints a code with Gemini, inserts it only if Tiger does not already have it. Coach card from aggregate numbers. |
| 8:00–9:30 | Copy on the monitor page: the picture stays on this computer. Suppress alerts when the face is missing. | Empty, loading, and error states. Confirm a second code cannot see the first code's rows. |
| 9:30–11:00 | One full pass on a single laptop. Fix the single worst bug. No new charts. | Same. |
| 11:00–12:30 | Pitch bullets and the 90-second script below. | Deploy. DNS from GoDaddy if it is quick. If the deploy fights you, stop and keep localhost as the demo. |
| 12:30–1:30 | Record the backup video while it works. Charge every battery. | Same. |
| 1:30–7:30 | Sleep. A broken deploy is a morning problem. | Sleep. |
| 7:30–9:00 | Venue wifi, camera permission, Chrome, model files already local so the CDN can be down. | Reload the dashboard. Re-seed if the database was the thing that failed. |
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
lib/vision.ts                 MediaPipe load + landmark reads
lib/scoring.ts                blink edges, perceptron, 1–10 score
lib/alerts.ts                 state machine
lib/db.ts                     Tiger or JSONL
lib/gemini.ts                 codes and coach text
lib/beep.ts                   Web Audio patterns
lib/serial.ts                 Web Serial writer
arduino/perch_buzzer/perch_buzzer.ino
public/models/face_landmarker.task
public/models/pose_landmarker_lite.task
.env.local                    not committed
```

Create the app with the Next.js prompt (TypeScript, Tailwind, App Router, no `src` directory). Then:

```bash
npm install @mediapipe/tasks-vision pg recharts
```

Download these into `public/models` while you still have reliable wifi. Load them from `/models/...`, not from Google's storage, at the venue.

- Face: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
- Pose: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`

WASM files come from the npm package (`@mediapipe/tasks-vision` dist wasm). Point `FilesetResolver.forVisionTasks` at a copy you also vendor under `public/wasm` if the venue blocks the CDN.

`.env.local`:

```
DATABASE_URL=postgres://USER:PASS@HOST:6432/tsdb?sslmode=require
GEMINI_API_KEY=
GEMINI_MODEL=
SEED_ENABLED=1
```

Use the pooled Tiger connection string (the pooler port, often 6432). Copy `GEMINI_MODEL` from the model id AI Studio shows for Flash. Leave the key unset until the coach route exists. The monitor page must not import `lib/gemini.ts` or `lib/db.ts`.

## Vision

Chrome only. `getUserMedia` at 640x480 is enough. Run detection on `requestAnimationFrame`, and remember the latest metrics in a ref. POST on a 5-second timer.

Face Landmarker: `outputFaceBlendshapes: true`, `runningMode: "VIDEO"`, one face. Read `eyeBlinkLeft` and `eyeBlinkRight` from `faceBlendshapes[0].categories` (`categoryName`, `score`).

A frame is a blink closure when the average of the two scores is above `0.45`. A blink event is the rising edge, with a 200ms refractory period so one blink is one count. `secondsSinceBlink` is time since that edge. `blinksPerMinute` is the count of edges in the last 60 seconds.

If blendshapes fail to load, fall back to eye aspect ratio on the eyelid landmarks. You should not need this if the `.task` file loads.

Pose Landmarker lite, one pose. Landmarks: `11` left shoulder, `12` right shoulder, `7` left ear, `8` right ear, `0` nose.

Shoulder tilt in degrees, 0 meaning level:

```ts
const tilt = Math.abs(Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x) * 180 / Math.PI);
const shoulderTiltDeg = Math.min(tilt, Math.abs(180 - tilt));
```

Calibration ("Sit upright and look at the screen", collect ~3 seconds, store medians):

- `baseTilt` = median `shoulderTiltDeg`
- `baseEarY` = median of the ear midpoint `y`
- `baseDepth` = median of `nose.z - earMidpoint.z`

Features, each clamped to 0..1:

```ts
const tiltF = clamp((shoulderTiltDeg - baseTilt) / 12, 0, 1);
const dropF = clamp((earMidY - baseEarY) / 0.08, 0, 1);     // y grows downward
const forwardF = clamp((baseDepth - (nose.z - earMidZ)) / 0.08, 0, 1);
```

The posture head is a perceptron on these three features. This is the model you train. MediaPipe is the pretrained vision front end (the model file is the "computer vision" piece). You do not download a posture dataset, and you do not train on pixels.

Initial weights, before any labels, so the score works the moment calibration finishes:

```ts
let w = [0.35, 0.40, 0.25]; // tilt, forward, drop
```

```ts
const x = [tiltF, forwardF, dropF];
const penalty = w[0] * x[0] + w[1] * x[1] + w[2] * x[2]; // 0..1
const postureScore = clamp(Math.round(10 - 9 * penalty), 1, 10);
```

Two buttons, Good and Slouch, apply the perceptron update. Label `1` means slouch, `0` means upright. Prediction is `penalty > 0.5`.

```ts
const y = label === "slouch" ? 1 : 0;
const yHat = penalty > 0.5 ? 1 : 0;
if (y !== yHat) {
  const lr = 0.15;
  for (let i = 0; i < 3; i++) w[i] = Math.max(0, w[i] + lr * (y - yHat) * x[i]);
  const sum = w[0] + w[1] + w[2] || 1;
  w = w.map((v) => v / sum);
}
```

Renormalizing keeps the 1–10 scale stable. Ship the initial weights even if nobody presses Good or Slouch. Mention that in the pitch: the geometry works immediately, and the perceptron only nudges the weights for this person's chair and camera.

No face for 1 second: show "Step into frame", freeze `secondsSinceBlink`, and do not buzz. Multiple people: Face Landmarker is already set to one face. Aim the camera so a passerby is not the largest face.

## Alerts

Constants:

| Name | Value | Why |
| --- | --- | --- |
| Blink gap | 8 seconds | Long enough that a normal pause is quiet. Short enough to demo. |
| Blink refractory | 200 ms | One physical blink, one count. |
| Bad posture | score ≤ 4 | Obvious slouch, not a fidget. |
| Posture hold | 20 seconds | Ignores reaching for a cup. |
| Cooldown per alert | 45 seconds | Separate timers for blink and posture. |
| Break interval | 20 minutes | The 20-20-20 rule. |
| Break length | 20 seconds | Look away. Alerts suppressed the whole time. |
| Sample period | 5 seconds | 720 rows an hour. Fine for a hypertable. |

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
  shoulder_tilt_deg    REAL,
  head_forward         REAL,
  head_drop            REAL,
  alert                TEXT
);

SELECT create_hypertable('samples', 'time', if_not_exists => TRUE);

CREATE INDEX samples_device_time ON samples (device_id, time DESC);
```

`head_forward` and `head_drop` are the 0..1 features, useful when a judge asks why a score moved. They are still numbers.

Inserts and reads take `device_id` as `$1`. There is no route that lists devices.

```sql
INSERT INTO samples (
  time, device_id, seconds_since_blink, blinks_per_minute,
  posture_score, shoulder_tilt_deg, head_forward, head_drop, alert
) VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8);

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
  "shoulder_tilt_deg": 3.1,
  "head_forward": 0.12,
  "head_drop": 0.05,
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
- Line under it: Blinks and posture, measured on this computer. The lamp only buzzes. Nothing pictorial is uploaded.
- Big numbers: seconds since a blink, blinks this minute, posture out of 10.
- Buttons: Calibrate upright, Connect buzzer, Start 20-second break, New device code.

## GoDaddy and deploy

Deploy the Next.js app to whatever host you can finish (Vercel is the short path). In GoDaddy DNS, add the CNAME the host shows you for `www`. Propagation may not finish before judging. Localhost on the demo laptop is the primary path. The domain is the second path.

If you want a GoDaddy-hosted page in the pitch: a single page in Website Builder with an embed/iframe of the deployed URL, and the device-code field living in the app inside the frame. Spend this only after the localhost demo has survived a full rehearsal.

Add `data/` and `.env.local` to `.gitignore` before the first real commit of the app.

## 90-second demo

1. Lamp in frame, code visible on tape. "This clips to a lamp. The laptop measures. The lamp buzzes. The site only receives numbers."
2. Dashboard already open on `demo-otter-42` so charts exist if live data hiccups. Then type the lamp's code.
3. Blink twice. Counter moves by two.
4. Stare. One double beep near 8 seconds. Point at seconds-since-blink.
5. Slouch and hold. Score drops. Three low beeps. Sit up, score recovers.
6. Start the 20-second break. Turn away from the camera. The other beep stays silent. Come back.
7. Type `demo-otter-42` or a garbage code. Different person, different numbers, or "not issued". Your rows did not follow you.

Then one sentence: codes are minted by Gemini and accepted only when Tiger Data has not issued them. The picture never goes there.

## Pitch, six lines

1. At a screen, blink rate falls and posture folds. People notice when the headache is already there.
2. Perch is a clip for the lamp already on the desk.
3. Live demo.
4. MediaPipe landmarks stay in the browser. A three-input perceptron turns them into a 1–10 posture score and can update from a couple of labeled poses at the desk.
5. Every 5 seconds Tiger Data stores the numbers for that device code. The site will not draw a chart without the code.
6. The buzzer is the product. The website is the record.

## Morning checks

- Cover the camera: "Step into frame", no beep.
- One blink, one count.
- Stare: a single blink reminder, then silence for the cooldown.
- Slouch 20 seconds: the other sound.
- Break button: countdown, no other sounds, LED on if the board is connected.
- Second code does not show the first code's rows.
- Network log on `POST /api/samples` is the JSON above, with no image field.
- Unplug the Arduino: the laptop still beeps.

## Time sinks

- Vision on the Arduino or an ESP32-CAM. There is not enough time or RAM for face landmarks. The board is a buzzer.
- Asking Gemini to generate SQL on every page view. You will debug invented queries instead of demoing.
- Building the charts inside GoDaddy Website Builder. DNS or an iframe only.
- Training a model on a downloaded image set. The perceptron on three numbers is the training story, and it matches the privacy rule.
- A new alert idea after 11pm. Write it in the README and leave the code alone.
- Skipping sleep to chase the deploy. The local demo is the grade.
