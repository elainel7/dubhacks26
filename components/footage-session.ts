"use client";

import { rememberDevice } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";
import { serialAvailable } from "@/lib/serial";
import { connectEsp32, FRAME_H, FRAME_W, type EspLink } from "@/vision/esp32-link";

export type LiveScore = {
  face: boolean;
  posture: number;
  head: string;
  saved: boolean;
  seq: number;
};

export type FootageState = {
  collecting: boolean;
  starting: boolean;
  error: string | null;
  boardLine: string | null;
  deviceId: string | null;
  liveScore: LiveScore | null;
};

const serverSnapshot: FootageState = {
  collecting: false,
  starting: false,
  error: null,
  boardLine: null,
  deviceId: null,
  liveScore: null,
};

let state: FootageState = serverSnapshot;
const listeners = new Set<() => void>();
let link: EspLink | null = null;
let stream: MediaStream | null = null;
let stopRequested = false;

function emit(next: FootageState) {
  state = next;
  listeners.forEach((listener) => listener());
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
  context.drawImage(video, 0, 0, FRAME_W, FRAME_H);
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
  return text;
}

type SerialPort = Awaited<ReturnType<Navigator["serial"]["requestPort"]>>;

let rememberedPort: SerialPort | null = null;

/** requestPort has to run in the click, before any await, or Chrome hides the picker. */
function askForPortAndCamera() {
  const mediaPromise = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
  });
  const portPromise = rememberedPort ? Promise.resolve(rememberedPort) : navigator.serial.requestPort();
  return { mediaPromise, portPromise };
}

async function pump() {
  const { video, canvas } = hiddenElements();
  while (!stopRequested && link) {
    const gray = grab(video, canvas);
    if (!gray) {
      await sleep(40);
      continue;
    }
    const started = performance.now();
    try {
      await link.sendFrame(Date.now(), gray);
    } catch {
      if (stopRequested) return;
      emit({ ...state, collecting: false, error: "The ESP32 stopped answering. Turn footage on again." });
      await stopFootage();
      return;
    }
    const rest = 70 - (performance.now() - started);
    if (rest > 0) await sleep(rest);
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
      } else if ((line.kind === "note" || line.kind === "other") && line.text) {
        emit({ ...state, boardLine: line.text });
      } else if (line.kind === "score") {
        emit({
          ...state,
          liveScore: {
            face: line.face,
            posture: line.posture,
            head: line.head,
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

export async function stopFootage() {
  stopRequested = true;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  const current = link;
  link = null;
  const video = document.getElementById("perch-footage");
  if (video instanceof HTMLVideoElement) video.srcObject = null;
  await current?.close();
  emit({ ...state, collecting: false, starting: false });
}
