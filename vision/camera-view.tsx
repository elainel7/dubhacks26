"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyReading,
  initialAlertState,
  tick,
  type AlertState,
  type Buzz,
  type Reading,
  type StepResult,
} from "@/vision/alerts";
import { renderContactSheet, SHEET_MIN_SPAN_MS, SHEET_PANELS, SHEET_WINDOW_MS } from "@/vision/contact-sheet";
import { SPEND_CAP_USD, tokenCost } from "@/vision/desk";
import { selectWindow } from "@/vision/frames";
import { serialAvailable, connectUno, type UnoLink } from "@/lib/serial";
import { playBuzz } from "@/lib/sound";

type Capture = { jpeg: string; t: number };

const FRAME_W = 384;
const FRAME_H = 288;

function formatSeconds(value: number | null) {
  if (value === null) return "—";
  return value.toFixed(1);
}

export function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<Capture[]>([]);
  const lastSentRef = useRef(0);
  const inFlightRef = useRef(false);
  const stateRef = useRef<AlertState>(initialAlertState(0));
  const watchingRef = useRef(false);
  const spendRef = useRef(0);
  const holdUntilRef = useRef(0);
  const serialRef = useRef<UnoLink | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const buzzLockRef = useRef(Promise.resolve());

  const [watching, setWatching] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState("Allow the camera. Each sheet is one second of video, about 30 frames.");
  const [metrics, setMetrics] = useState<AlertState>(stateRef.current);
  const [spend, setSpend] = useState(0);
  const [serialLabel, setSerialLabel] = useState(
    serialAvailable() ? "Uno not connected" : "Web Serial needs Chrome or Edge",
  );
  const [unoReady, setUnoReady] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [breakLeft, setBreakLeft] = useState<number | null>(null);

  useEffect(() => {
    watchingRef.current = watching;
  }, [watching]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void serialRef.current?.close();
      void audioRef.current?.close();
    };
  }, []);

  function commit(result: StepResult) {
    stateRef.current = result.state;
    setMetrics(result.state);
    if (result.note) setStatus(result.note);
    if (result.state.phase === "break" && result.state.breakUntil) {
      setBreakLeft(Math.max(0, Math.ceil((result.state.breakUntil - Date.now()) / 1000)));
    } else {
      setBreakLeft(null);
    }
    if (result.buzz) {
      if (!serialRef.current) setStatus(`${result.note} Beeped on this computer.`);
      void sound(result.buzz);
    }
  }

  async function sound(kind: Buzz) {
    const run = async () => {
      const link = serialRef.current;
      if (link) {
        try {
          await link.write(kind);
          return;
        } catch {
          serialRef.current = null;
          setUnoReady(false);
          setSerialLabel("Uno disconnected. Using this computer's speaker.");
        }
      }
      if (!audioRef.current) audioRef.current = new AudioContext();
      await playBuzz(audioRef.current, kind);
    };
    buzzLockRef.current = buzzLockRef.current.then(run, run);
    await buzzLockRef.current;
  }

  async function ensureCamera() {
    if (streamRef.current) return true;
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        }),
        new Promise<MediaStream>((_, reject) => {
          window.setTimeout(() => reject(new Error("timeout")), 8_000);
        }),
      ]);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setCameraError(null);
      return true;
    } catch {
      setCameraError("Camera permission was blocked. Allow the camera for this page, then try again.");
      setCameraOn(false);
      return false;
    }
  }

  function grab(): string | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, FRAME_W, FRAME_H);
    const url = canvas.toDataURL("image/jpeg", 0.65);
    const comma = url.indexOf(",");
    return comma >= 0 ? url.slice(comma + 1) : null;
  }

  async function scoreSheet(frames: Capture[]) {
    const sheet = await renderContactSheet(frames);
    if (!sheet) {
      setStatus("Could not build the contact sheet.");
      return;
    }
    const durationMs = Math.max(0, sheet.clipEndedAt - sheet.startedAt);

    const response = await fetch("/api/perceive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: sheet.jpegBase64,
        panel_count: frames.length,
        duration_ms: durationMs,
      }),
    });
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      face_visible?: boolean;
      blink_count?: number;
      posture_score?: number;
      head?: Reading["head"];
      shoulders?: Reading["shoulders"];
      latency_ms?: number;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    if (!response.ok) {
      if (body.error === "quota") holdUntilRef.current = Date.now() + 60_000;
      setStatus(body.message ?? "Perceptron could not score that sheet.");
      return;
    }

    if (typeof body.latency_ms === "number") setLatency(body.latency_ms);
    const prompt = body.usage?.prompt_tokens ?? 0;
    const completion = body.usage?.completion_tokens ?? 0;
    spendRef.current += tokenCost(prompt, completion);
    setSpend(spendRef.current);
    if (spendRef.current >= SPEND_CAP_USD) {
      watchingRef.current = false;
      setWatching(false);
      setStatus(`Stopped at the $${SPEND_CAP_USD.toFixed(0)} Perceptron cap. Raise it in vision/desk.ts if the demo needs more.`);
      return;
    }

    if (
      typeof body.face_visible !== "boolean" ||
      typeof body.blink_count !== "number" ||
      typeof body.posture_score !== "number" ||
      !body.head ||
      !body.shoulders
    ) {
      setStatus("Mk1.5 returned an incomplete score. This window was ignored.");
      return;
    }

    const result = applyReading(
      stateRef.current,
      {
        faceVisible: body.face_visible,
        blinkCount: body.blink_count,
        postureScore: body.posture_score,
        head: body.head,
        shoulders: body.shoulders,
        degraded: false,
        clipEndedAt: sheet.clipEndedAt,
      },
      Date.now(),
    );
    commit(result);
    const blinks = body.blink_count === 1 ? "1 blink" : `${body.blink_count} blinks`;
    if (!result.note) setStatus(`Sheet scored. ${blinks}, posture ${body.posture_score}.`);
  }

  useEffect(() => {
    if (!watching) return;

    let lastVideoTime = -1;
    let frameHandle = 0;
    const pushFrame = () => {
      if (!watchingRef.current || stateRef.current.phase === "break") return;
      const video = videoRef.current;
      if (video && video.currentTime === lastVideoTime) return;
      if (video) lastVideoTime = video.currentTime;
      const jpeg = grab();
      if (!jpeg) return;
      bufferRef.current.push({ jpeg, t: Date.now() });
      const cutoff = Date.now() - 2_000;
      if (bufferRef.current.length > 45) {
        bufferRef.current = bufferRef.current.filter((frame) => frame.t >= cutoff);
      }
    };
    const onVideoFrame = () => {
      pushFrame();
      const video = videoRef.current;
      if (!watchingRef.current || !video?.requestVideoFrameCallback) return;
      frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    };
    const video = videoRef.current;
    let captureTimer = 0;
    if (video?.requestVideoFrameCallback) {
      frameHandle = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      captureTimer = window.setInterval(pushFrame, 33);
    }

    const pumpTimer = window.setInterval(() => {
      void (async () => {
        if (!watchingRef.current || inFlightRef.current) return;
        if (stateRef.current.phase === "break") return;

        if (Date.now() < holdUntilRef.current) return;

        const fresh = bufferRef.current.filter((frame) => frame.t > lastSentRef.current);
        if (fresh.length < 12) return;
        const span = fresh[fresh.length - 1].t - fresh[0].t;
        if (span < SHEET_MIN_SPAN_MS) return;
        const windowStart = fresh[fresh.length - 1].t - SHEET_WINDOW_MS;
        const recent = fresh.filter((frame) => frame.t >= windowStart);

        const selected = selectWindow(
          recent.map((frame) => ({ ...frame, timestampMs: frame.t })),
          SHEET_PANELS,
        );
        lastSentRef.current = fresh[fresh.length - 1].t;
        bufferRef.current = bufferRef.current.filter((frame) => frame.t > lastSentRef.current);
        inFlightRef.current = true;
        setStatus("Sending one contact sheet.");
        try {
          await scoreSheet(selected.frames.map((frame) => ({ jpeg: frame.jpeg, t: frame.t })));
        } catch {
          setStatus("Could not reach the scoring route.");
        } finally {
          inFlightRef.current = false;
        }
      })();
    }, 400);

    const clock = window.setInterval(() => {
      if (!watchingRef.current) return;
      const result = tick(stateRef.current, Date.now());
      if (result.buzz || result.state !== stateRef.current) commit(result);
      if (stateRef.current.phase === "break" && stateRef.current.breakUntil) {
        setBreakLeft(Math.max(0, Math.ceil((stateRef.current.breakUntil - Date.now()) / 1000)));
      }
    }, 250);

    return () => {
      window.clearInterval(captureTimer);
      videoRef.current?.cancelVideoFrameCallback?.(frameHandle);
      window.clearInterval(pumpTimer);
      window.clearInterval(clock);
    };
    // The loop reads live values through refs. Restarting it on every render would drop frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  async function toggleWatching() {
    if (watching) {
      watchingRef.current = false;
      setWatching(false);
      setStatus("Camera paused.");
      return;
    }
    setStatus("Opening the camera.");
    const ready = await ensureCamera();
    if (!ready) {
      setStatus("The camera did not open. Allow it in the browser bar.");
      return;
    }
    try {
      if (!audioRef.current) audioRef.current = new AudioContext();
      if (audioRef.current.state === "suspended") await audioRef.current.resume();
    } catch {
      // Watching still starts. A later beep can open the speaker.
    }
    const now = Date.now();
    const fresh = initialAlertState(now);
    stateRef.current = fresh;
    setMetrics(fresh);
    bufferRef.current = [];
    lastSentRef.current = now;
    watchingRef.current = true;
    setWatching(true);
    setStatus("Watching. The first sheet is about one second of frames.");
  }

  async function onConnect() {
    try {
      const link = await connectUno((line) => {
        if (line.toLowerCase().includes("perch")) {
          setUnoReady(true);
          setSerialLabel("Uno ready");
        }
      });
      await serialRef.current?.close();
      serialRef.current = link;
      setSerialLabel("Uno port open");
      setStatus("Serial port open. Flash the perch sketch if the board stays quiet.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not open a serial port.";
      if (message.includes("No port selected") || message.toLowerCase().includes("cancel")) return;
      setSerialLabel(message);
    }
  }

  const posture = metrics.postureScore === null ? "—" : String(metrics.postureScore);
  const phaseLabel =
    metrics.phase === "break"
      ? `Break ${breakLeft ?? 20}s`
      : metrics.phase === "no-face"
        ? "No face"
        : watching
          ? "Live"
          : "Idle";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Camera</h1>
          <Badge variant={watching ? "default" : "outline"}>{phaseLabel}</Badge>
          {unoReady ? <Badge variant="secondary">Uno</Badge> : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This page is only so you can see the webcam. Frames are sent to Perceptron and are not stored.
          A stare or a slouch beeps on this computer until the Arduino is plugged in.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Camera</CardTitle>
            <CardDescription>
              About 30 frames from one second go into one JPEG, so a blink covers several panels. Frames are not stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-lg bg-muted aspect-[4/3]">
              <video
                ref={videoRef}
                className="h-full w-full -scale-x-100 object-cover"
                playsInline
                muted
                autoPlay
              />
              {!cameraOn ? (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  The preview appears after you start watching and allow the camera.
                </div>
              ) : null}
            </div>
            <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} className="hidden" />
            {cameraError ? <p className="text-sm text-destructive">{cameraError}</p> : null}
            <p className="text-sm" aria-live="polite">
              {status}
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Right now</CardTitle>
              <CardDescription>
                {latency === null ? "No scored window yet." : `Last Mk1.5 call ${latency} ms.`}
                {metrics.head && metrics.phase === "live"
                  ? ` Head ${metrics.head}, shoulders ${metrics.shoulders}.`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Seconds since blink</dt>
                  <dd className="mt-1 font-mono text-3xl tabular-nums">
                    {watching ? formatSeconds(metrics.secondsSinceBlink) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Blinks / min</dt>
                  <dd className="mt-1 font-mono text-3xl tabular-nums">
                    {watching ? metrics.blinksPerMinute : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Posture 1–10</dt>
                  <dd className="mt-1 font-mono text-3xl tabular-nums">{posture}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>{serialLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void toggleWatching()}>
                  {watching ? "Stop camera" : "Allow the camera"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void onConnect()}>
                  Connect Uno
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Perceptron spend this session: ${spend.toFixed(3)} of ${SPEND_CAP_USD.toFixed(2)}.
                Beeps play here on their own. Connect Uno only when the board is plugged in.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
