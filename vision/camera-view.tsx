"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyReading,
  initialAlertState,
  noteBlink,
  tick,
  type AlertState,
  type Buzz,
  type Reading,
  type StepResult,
} from "@/vision/alerts";
import { initialBlinkTrack, trackBlink, type BlinkTrack } from "@/vision/blink-track";
import { loadFaceBlink, type FaceBlink } from "@/vision/face-blink";
import { renderContactSheet, SHEET_MIN_SPAN_MS, SHEET_PANELS, SHEET_WINDOW_MS } from "@/vision/contact-sheet";
import { SPEND_CAP_USD, tokenCost, type DeskScore } from "@/vision/desk";
import { postureEventFromScore, SAVED_NOTE, UNSAVED_NOTE } from "@/vision/events";
import { selectWindow } from "@/vision/frames";
import { readStoredDeviceId } from "@/lib/device-id";
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
  const faceBlinkRef = useRef<FaceBlink | null>(null);
  const blinkTrackRef = useRef<BlinkTrack>(initialBlinkTrack());
  const closureUiRef = useRef(0);
  const aliveRef = useRef(true);

  const [watching, setWatching] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState("Allow the camera. Each sheet is every frame from about half a second.");
  const [metrics, setMetrics] = useState<AlertState>(stateRef.current);
  const [spend, setSpend] = useState(0);
  const serialReady = useSyncExternalStore(
    () => () => {},
    () => serialAvailable(),
    () => false,
  );
  const [serialNote, setSerialLabel] = useState<string | null>(null);
  const serialLabel = serialNote ?? (serialReady ? "Uno not connected" : "Web Serial needs Chrome or Edge");
  const [unoReady, setUnoReady] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [sheets, setSheets] = useState<{ url: string; panels: number; at: number }[]>([]);
  const [breakLeft, setBreakLeft] = useState<number | null>(null);
  const [closure, setClosure] = useState<number | null>(null);
  const [blinkNote, setBlinkNote] = useState("Loading eyelid tracker.");
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => {
    watchingRef.current = watching;
  }, [watching]);

  useEffect(() => {
    let cancelled = false;
    let opened: FaceBlink | null = null;
    loadFaceBlink()
      .then((detector) => {
        if (cancelled) {
          detector.close();
          return;
        }
        opened = detector;
        faceBlinkRef.current = detector;
        setBlinkNote("Timer resets when the eyelids close.");
      })
      .catch(() => {
        if (!cancelled) setBlinkNote("Eyelid tracker did not load. The timer follows the contact sheet.");
      });
    return () => {
      cancelled = true;
      opened?.close();
      faceBlinkRef.current = null;
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void serialRef.current?.close();
      void audioRef.current?.close();
    };
  }, []);

  function commit(result: StepResult, now: number) {
    stateRef.current = result.state;
    setMetrics(result.state);
    if (result.note) setStatus(result.note);
    if (result.state.phase === "break" && result.state.breakUntil) {
      setBreakLeft(Math.max(0, Math.ceil((result.state.breakUntil - now) / 1000)));
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
            frameRate: { ideal: 60 },
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

  async function persistScore(score: DeskScore) {
    try {
      const event = postureEventFromScore(score, readStoredDeviceId(window.sessionStorage));
      if (!event) {
        if (score.face_visible && aliveRef.current) setSaveNote(UNSAVED_NOTE);
        return;
      }
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      if (!aliveRef.current) return;
      setSaveNote(response.ok ? SAVED_NOTE : UNSAVED_NOTE);
    } catch {
      if (aliveRef.current) setSaveNote(UNSAVED_NOTE);
    }
  }

  async function scoreSheet(frames: Capture[]) {
    const sheet = await renderContactSheet(frames);
    if (!sheet) {
      setStatus("Could not build the contact sheet.");
      return;
    }
    const durationMs = Math.max(0, sheet.clipEndedAt - sheet.startedAt);
    setSheets((current) =>
      [{ url: `data:image/jpeg;base64,${sheet.jpegBase64}`, panels: frames.length, at: Date.now() }, ...current].slice(0, 6),
    );

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

    const scored: DeskScore = {
      face_visible: body.face_visible,
      blink_count: body.blink_count,
      posture_score: body.posture_score,
      head: body.head,
      shoulders: body.shoulders,
    };
    const now = Date.now();
    const localBlink = faceBlinkRef.current !== null;
    const result = applyReading(
      stateRef.current,
      {
        faceVisible: scored.face_visible,
        blinkCount: localBlink ? 0 : scored.blink_count,
        postureScore: scored.posture_score,
        head: scored.head,
        shoulders: scored.shoulders,
        degraded: false,
        clipEndedAt: sheet.clipEndedAt,
      },
      now,
    );
    commit(result, now);
    const blinks = body.blink_count === 1 ? "1 blink" : `${body.blink_count} blinks`;
    const reset = body.blink_count > 0 ? " Timer reset." : "";
    const lead = result.note ? `${result.note} ` : "";
    setStatus(
      localBlink
        ? `${lead}Posture ${body.posture_score}. Blink timer follows the eyelids.`
        : `${lead}Sheet: ${blinks}, posture ${body.posture_score}.${reset}`,
    );
  }

  useEffect(() => {
    if (!watching) return;

    let lastVideoTime = -1;
    let frameHandle = 0;
    const pushFrame = () => {
      if (!watchingRef.current || stateRef.current.phase === "break") return;
      const video = videoRef.current;
      if (!video || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const detector = faceBlinkRef.current;
      if (detector) {
        try {
          const sample = detector.sample(video, performance.now());
          const now = Date.now();
          if (sample.faceVisible && now - closureUiRef.current > 200) {
            closureUiRef.current = now;
            setClosure(sample.score);
          }
          if (sample.faceVisible) {
            const stepped = trackBlink(blinkTrackRef.current, sample.score, now);
            blinkTrackRef.current = stepped.track;
            if (stepped.blinked) commit(noteBlink(stateRef.current, now), now);
          }
        } catch {
          // A bad frame stays on the sheet timer until the next one.
        }
      }
      const jpeg = grab();
      if (!jpeg) return;
      bufferRef.current.push({ jpeg, t: Date.now() });
      const cutoff = Date.now() - 1_000;
      if (bufferRef.current.length > 80) {
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
        if (fresh.length < 8) return;
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
      const now = Date.now();
      const result = tick(stateRef.current, now);
      if (result.buzz || result.state !== stateRef.current) commit(result, now);
      if (stateRef.current.phase === "break" && stateRef.current.breakUntil) {
        setBreakLeft(Math.max(0, Math.ceil((stateRef.current.breakUntil - now) / 1000)));
      }
    }, 250);

    return () => {
      window.clearInterval(captureTimer);
      video?.cancelVideoFrameCallback?.(frameHandle);
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
    blinkTrackRef.current = initialBlinkTrack();
    lastSentRef.current = now;
    watchingRef.current = true;
    setWatching(true);
    setStatus("Watching. The first sheet is every frame from about half a second.");
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

  const postureTone =
    metrics.postureScore === null ? "text-foreground" : metrics.postureScore >= 6 ? "text-good" : "text-bad";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-4xl text-foreground sm:text-5xl">Camera</h1>
          <Badge variant={watching ? "default" : "outline"}>{phaseLabel}</Badge>
          {unoReady ? <Badge variant="secondary">Uno</Badge> : null}
        </div>
        <p className="text-base leading-relaxed text-muted-foreground">
          Perch scores blinks and posture from this webcam. Frames go to Perceptron and are not stored.
          A visible face is saved for the device id you opened. A stare or a slouch beeps here until the
          Arduino is plugged in.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.85fr)]">
        <Card className="bg-card/95">
          <CardHeader>
            <CardTitle>Camera</CardTitle>
            <CardDescription>
              Every camera frame from about half a second goes into one JPEG. The laptop camera cannot make 100 different frames in one second. Frames are not stored.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10">
              <video
                ref={videoRef}
                className="h-full w-full -scale-x-100 object-cover"
                playsInline
                muted
                autoPlay
              />
              {!cameraOn ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <p className="font-heading text-2xl text-foreground">Allow the camera</p>
                  <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                    The preview stays on this page. Posture history lives with the device id.
                  </p>
                </div>
              ) : null}
            </div>
            <canvas ref={canvasRef} width={FRAME_W} height={FRAME_H} className="hidden" />
            {cameraError ? (
              <p role="alert" className="text-sm font-medium text-bad">
                {cameraError}
              </p>
            ) : null}
            <p className="rounded-xl bg-muted px-3 py-2 text-sm leading-relaxed" aria-live="polite">
              {status}
            </p>
            {saveNote ? <p className="text-sm text-muted-foreground">{saveNote}</p> : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="bg-card/95">
            <CardHeader>
              <CardTitle className="font-heading text-2xl">Right now</CardTitle>
              <CardDescription className="leading-relaxed">
                {blinkNote}
                {closure === null ? "" : ` Closure ${closure.toFixed(2)}.`}
                {latency === null ? " No scored window yet." : ` Last Mk1.5 call ${latency} ms.`}
                {metrics.head && metrics.phase === "live"
                  ? ` Head ${metrics.head}, shoulders ${metrics.shoulders}.`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-muted px-2 py-3 sm:px-3">
                  <dt className="text-xs font-semibold text-muted-foreground">Seconds since blink</dt>
                  <dd className="mt-1 font-heading text-3xl tabular-nums">
                    {watching ? formatSeconds(metrics.secondsSinceBlink) : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Blinks / min, aim 20</dt>
                  <dd className="mt-1 font-mono text-3xl tabular-nums">
                    {watching ? metrics.blinksPerMinute : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Posture 1–100</dt>
                  <dd className="mt-1 font-mono text-3xl tabular-nums">{posture}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="bg-card/95">
            <CardHeader>
              <CardTitle className="font-heading text-2xl">Controls</CardTitle>
              <CardDescription>{serialLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="h-11 px-4" onClick={() => void toggleWatching()}>
                  {watching ? "Stop camera" : "Allow the camera"}
                </Button>
                <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void onConnect()}>
                  Connect Uno
                </Button>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Perceptron spend this session: ${spend.toFixed(3)} of ${SPEND_CAP_USD.toFixed(2)}. Beeps
                play here on their own. Connect Uno only when the board is plugged in.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
