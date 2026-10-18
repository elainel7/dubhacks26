"use client";

import { rememberDevice } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";
import { serialAvailable } from "@/lib/serial";
import {
  blinkGapSeconds,
  blinksInLastMinute,
  initialBlinkWatch,
  postureHonkDue,
  stareChirpDue,
  takeBoardGap,
  watchBlink,
  type BlinkWatch,
} from "@/vision/blink-track";
import { loadFaceBlink, type FaceBlink } from "@/vision/face-blink";
import { cameraCrop, connectEsp32, FRAME_H, FRAME_W, pickSheetFrames, type EspLink } from "@/vision/esp32-link";

export type LiveScore = {
  face: boolean;
  posture: number;
  head: string;
  gap: number;
  rate: number;
  saved: boolean;
  seq: number;
};

export type BlinkSnapshot = {
  gap: number;
  rate: number;
  holding: boolean;
  marks: number[];
};

export type FootageState = {
  collecting: boolean;
  starting: boolean;
  error: string | null;
  deviceId: string | null;
  liveScore: LiveScore | null;
  blink: BlinkSnapshot | null;
};

const serverSnapshot: FootageState = {
  collecting: false,
  starting: false,
  error: null,
  deviceId: null,
  liveScore: null,
  blink: null,
};

let state: FootageState = serverSnapshot;
const listeners = new Set<() => void>();
let link: EspLink | null = null;
let stream: MediaStream | null = null;
let stopRequested = false;
let blinkWatch: BlinkWatch = initialBlinkWatch();
let previousBoardGap: number | null = null;
let stareChirpIndex = 0;
let postureBadSince: number | null = null;
let lastHonkAskAt = 0;
let faceBlink: FaceBlink | null = null;
let faceBlinkLoad: Promise<FaceBlink> | null = null;
let blinkTimer = 0;
let clockTimer = 0;

function emit(next: FootageState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function blinkSnapshot(now: number): BlinkSnapshot | null {
  const gap = blinkGapSeconds(blinkWatch, now);
  if (gap == null) return state.blink;
  return {
    gap,
    rate: blinksInLastMinute(blinkWatch.marks, now),
    holding: blinkWatch.holding,
    marks: blinkWatch.marks,
  };
}

function maybeChirp(now = Date.now()) {
  const due = stareChirpDue(stareChirpIndex, blinkGapSeconds(blinkWatch, now), blinkWatch.holding);
  if (due.fire && !link) return;
  const previous = stareChirpIndex;
  stareChirpIndex = due.index;
  if (!due.fire) return;
  void link?.noteChirp().catch(() => {
    if (stareChirpIndex === due.index) stareChirpIndex = previous;
  });
}

function postureIsBad() {
  const score = state.liveScore;
  if (!score) return false;
  return score.posture <= 60 || score.head === "forward";
}

function maybeHonk(now = Date.now()) {
  const due = postureHonkDue(postureBadSince, now, postureIsBad(), lastHonkAskAt);
  postureBadSince = due.badSince;
  if (!due.ask || !link) return;
  lastHonkAskAt = now;
  void link.noteHonk().catch(() => {
    lastHonkAskAt = 0;
  });
}

function publishBlink(now = Date.now()) {
  maybeChirp(now);
  maybeHonk(now);
  const blink = blinkSnapshot(now);
  if (!blink) return;
  if (
    state.blink &&
    state.blink.gap === blink.gap &&
    state.blink.rate === blink.rate &&
    state.blink.holding === blink.holding &&
    state.blink.marks === blink.marks
  ) {
    return;
  }
  emit({ ...state, blink });
}

export function subscribeFootage(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFootageSnapshot() {
  return state;
}

export function getFootageServerSnapshot() {
  return serverSnapshot;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function hiddenElements() {
  const existingVideo = document.getElementById("perch-footage");
  const video = existingVideo instanceof HTMLVideoElement ? existingVideo : document.createElement("video");
  if (video.parentElement === null) {
    video.id = "perch-footage";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
  }
  const existingCanvas = document.getElementById("perch-footage-canvas");
  const canvas = existingCanvas instanceof HTMLCanvasElement ? existingCanvas : document.createElement("canvas");
  if (canvas.parentElement === null) {
    canvas.id = "perch-footage-canvas";
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    canvas.hidden = true;
    document.body.appendChild(canvas);
  }
  return { video, canvas };
}

function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (video.readyState < 2) return null;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const crop = cameraCrop(video.videoWidth, video.videoHeight);
  if (!crop) return null;
  context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, FRAME_W, FRAME_H);
  const pixels = context.getImageData(0, 0, FRAME_W, FRAME_H).data;
  const gray = new Uint8Array(FRAME_W * FRAME_H);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const value = 0.3 * pixels[i] + 0.6 * pixels[i + 1] + 0.1 * pixels[i + 2];
    gray[p] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
  }
  return gray;
}

function boardErrorText(text: string) {
  if (text === "wifi") {
    return "The ESP32 is not on Wi-Fi. Check the network name in secrets.h. An open network needs an empty password, and the network has to be 2.4 GHz.";
  }
  if (text === "wifi has no internet") {
    return "The ESP32 joined Wi-Fi, but that network has no internet. Perceptron cannot be reached. Use a 2.4 GHz network that opens normal websites, with no login page.";
  }
  if (text === "could not reach Perceptron" || text.startsWith("perceptron -")) {
    return "The ESP32 could not open a connection to Perceptron, so nothing was saved. Upload the latest sketch. Use a 2.4 GHz network with internet and no login page.";
  }
  if (text === "parse") {
    return "Perceptron answered, but the score was not readable. Upload the latest sketch, then try again.";
  }
  if (text.startsWith("parse ")) {
    return "Perceptron answered, but the score was cut off or was not the score JSON. Reply: " + text.slice("parse ".length);
  }
  return text;
}

type SerialPort = Awaited<ReturnType<Navigator["serial"]["requestPort"]>>;

let rememberedPort: SerialPort | null = null;

/** requestPort has to run in the click, before any await, or Chrome hides the picker. */
function askForPortAndCamera() {
  const mediaPromise = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const portPromise = rememberedPort ? Promise.resolve(rememberedPort) : navigator.serial.requestPort();
  return { mediaPromise, portPromise };
}

async function pump() {
  const { video, canvas } = hiddenElements();
  const ring: { t: number; gray: Uint8Array }[] = [];
  let lastSample = 0;

  function sample() {
    const now = performance.now();
    if (now - lastSample < 120) return;
    lastSample = now;
    const gray = grab(video, canvas);
    if (!gray) return;
    ring.push({ t: Date.now(), gray });
    if (ring.length > 48) ring.shift();
  }

  while (!stopRequested && link) {
    sample();
    const span = ring.length >= 2 ? ring[ring.length - 1].t - ring[0].t : 0;
    if (ring.length < 2 || span < 400) {
      await sleep(40);
      continue;
    }
    const chosen = pickSheetFrames(ring);
    ring.length = 0;
    try {
      for (const frame of chosen) {
        await link.sendFrame(frame.t, frame.gray, sample);
      }
    } catch (cause) {
      if (stopRequested) return;
      const message = cause instanceof Error ? cause.message : "The ESP32 did not answer.";
      emit({ ...state, collecting: false, error: message });
      await stopFootage();
      return;
    }
  }
}

export async function startFootage() {
  if (state.collecting || state.starting) return;
  if (!serialAvailable()) {
    emit({ ...state, starting: false, error: "Chrome or Edge is required." });
    return;
  }
  const { mediaPromise, portPromise } = askForPortAndCamera();
  emit({ ...state, starting: true, error: null });
  stopRequested = false;
  try {
    const media = await mediaPromise;
    stream = media;
    const { video } = hiddenElements();
    video.srcObject = media;
    await video.play();
    startBlinkWatch(video);
    link = await connectEsp32(async () => {
      const port = await portPromise;
      rememberedPort = port;
      return port;
    }, (line) => {
      if (line.kind === "device") {
        const id = normalizeDeviceId(line.id);
        if (!id) return;
        rememberDevice(id);
        emit({ ...state, deviceId: id });
      } else if (line.kind === "score") {
        const taken = takeBoardGap(blinkWatch, line.gap, Date.now(), previousBoardGap);
        blinkWatch = taken.watch;
        previousBoardGap = taken.previousBoardGap;
        const now = Date.now();
        const blink = blinkSnapshot(now);
        emit({
          ...state,
          blink,
          liveScore: {
            face: line.face,
            posture: line.posture,
            head: line.head,
            gap: blink?.gap ?? line.gap,
            rate: blink ? Math.max(line.rate, blink.rate) : line.rate,
            saved: false,
            seq: (state.liveScore?.seq ?? 0) + 1,
          },
        });
      } else if (line.kind === "saved" && state.liveScore) {
        emit({
          ...state,
          liveScore: { ...state.liveScore, saved: true, seq: state.liveScore.seq + 1 },
        });
      } else if (line.kind === "error") {
        emit({ ...state, error: boardErrorText(line.text) });
      }
    });
    emit({ ...state, collecting: true, starting: false, error: null });
    void pump();
  } catch (cause) {
    rememberedPort = null;
    await stopFootage();
    const message = cause instanceof Error ? cause.message : "Could not start footage.";
    const cancelled =
      (cause instanceof DOMException && cause.name === "NotFoundError") ||
      message.toLowerCase().includes("cancel") ||
      message.includes("No port selected");
    emit({ ...state, collecting: false, starting: false, error: cancelled ? null : message });
  }
}

function stopBlinkWatch() {
  window.clearInterval(blinkTimer);
  window.clearInterval(clockTimer);
  blinkTimer = 0;
  clockTimer = 0;
}

function ensureFaceBlink() {
  if (faceBlink || faceBlinkLoad) return faceBlinkLoad;
  faceBlinkLoad = loadFaceBlink()
    .then((detector) => {
      faceBlink = detector;
      return detector;
    })
    .catch((cause: unknown) => {
      faceBlinkLoad = null;
      throw cause;
    });
  return faceBlinkLoad;
}

function startBlinkWatch(video: HTMLVideoElement) {
  stopBlinkWatch();
  blinkWatch = initialBlinkWatch();
  previousBoardGap = null;
  stareChirpIndex = 0;
  postureBadSince = null;
  lastHonkAskAt = 0;
  void ensureFaceBlink()?.catch(() => {
    /* The next camera start tries the landmarker again. Frames still go to the board. */
  });
  let faceBlinkFailedAt = 0;
  blinkTimer = window.setInterval(() => {
    if (stopRequested) return;
    if (!faceBlink) {
      if (!faceBlinkLoad && Date.now() - faceBlinkFailedAt > 3000) {
        void ensureFaceBlink()?.catch(() => {
          faceBlinkFailedAt = Date.now();
        });
      }
      return;
    }
    if (video.readyState < 2) return;
    let sample;
    try {
      sample = faceBlink.sample(video, performance.now());
    } catch {
      return;
    }
    const now = Date.now();
    const step = watchBlink(blinkWatch, sample.score, sample.faceVisible, now);
    blinkWatch = step.watch;
    if (step.committed) {
      publishBlink(now);
      void link?.noteBlink().catch(() => {
        /* The board catches up on the next open. The page clock already reset. */
      });
    } else if (step.watch.holding !== (state.blink?.holding ?? false)) {
      publishBlink(now);
    }
  }, 50);
  clockTimer = window.setInterval(() => publishBlink(), 250);
}

export async function stopFootage() {
  stopRequested = true;
  stopBlinkWatch();
  blinkWatch = initialBlinkWatch();
  previousBoardGap = null;
  stareChirpIndex = 0;
  postureBadSince = null;
  lastHonkAskAt = 0;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const current = link;
  link = null;
  const video = document.getElementById("perch-footage");
  if (video instanceof HTMLVideoElement) video.srcObject = null;
  await current?.close();
  emit({ ...state, collecting: false, starting: false, blink: null });
}
