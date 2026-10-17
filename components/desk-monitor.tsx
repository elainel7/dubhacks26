"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  applyReading,
  initialAlertState,
  startBreak,
  tick,
  type AlertState,
  type Buzz,
  type Reading,
  type StepResult,
} from "@/lib/alerts";
import { SPEND_CAP_USD, tokenCost } from "@/lib/desk";
import { selectWindow } from "@/lib/frames";
import { serialAvailable, connectUno, type UnoLink } from "@/lib/serial";
import { playBuzz } from "@/lib/sound";

type Scene = "blinking" | "staring" | "slouching";
type Capture = { jpeg: string; t: number };

const FRAME_W = 384;
const FRAME_H = 288;

function formatSeconds(value: number | null) {
  if (value === null) return "—";
  return value.toFixed(1);
}

function fakeReading(scene: Scene, now: number): Reading {
  if (scene === "slouching") {
    return {
      faceVisible: true,
      blinkCount: 0,
      postureScore: 2,
      head: "forward",
      shoulders: "tilted",
      degraded: false,
      clipEndedAt: now,
    };
  }
  if (scene === "staring") {
    return {
      faceVisible: true,
      blinkCount: 0,
      postureScore: 8,
      head: "upright",
      shoulders: "level",
      degraded: false,
      clipEndedAt: now,
    };
  }
  return {
    faceVisible: true,
    blinkCount: 1,
    postureScore: 8,
    head: "upright",
    shoulders: "level",
    degraded: false,
    clipEndedAt: now,
  };
}

export function DeskMonitor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<Capture[]>([]);
  const lastSentRef = useRef(0);
  const inFlightRef = useRef(false);
  const stateRef = useRef<AlertState>(initialAlertState(0));
  const watchingRef = useRef(false);
  const simulateRef = useRef(false);
  const sceneRef = useRef<Scene>("blinking");
  const lastSimRef = useRef(0);
  const spendRef = useRef(0);
  const serialRef = useRef<UnoLink | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const buzzLockRef = useRef(Promise.resolve());

  const [watching, setWatching] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [scene, setScene] = useState<Scene>("blinking");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [status, setStatus] = useState("Camera off. The Uno is silent until you start watching.");
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
    simulateRef.current = simulate;
  }, [simulate]);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

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
    if (result.buzz) void sound(result.buzz);
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
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
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
      setCameraError("Camera permission was blocked. Allow the camera for this page, or turn on Simulate Mk1.5.");
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

  async function scoreWindow(frames: Capture[], degraded: boolean) {
    const startedAt = frames[0].t;
    const clipEndedAt = frames[frames.length - 1].t;
    const payload = frames.map((frame) => ({
      jpeg_base64: frame.jpeg,
      timestamp_ms: Math.max(0, Math.round(frame.t - startedAt)),
    }));

    const response = await fetch("/api/perceive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames: payload }),
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
      setStatus(body.message ?? "Perceptron could not score that window.");
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
      setStatus(`Stopped at the $${SPEND_CAP_USD.toFixed(0)} Perceptron cap. Raise it in lib/desk.ts if the demo needs more.`);
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
        degraded,
        clipEndedAt,
      },
      Date.now(),
    );
    commit(result);
    if (!result.note) setStatus("Window scored. No reminder.");
  }

  useEffect(() => {
    if (!watching) return;

    const captureTimer = window.setInterval(() => {
      if (!watchingRef.current || simulateRef.current) return;
      if (stateRef.current.phase === "break") return;
      const jpeg = grab();
      if (!jpeg) return;
      bufferRef.current.push({ jpeg, t: Date.now() });
      const cutoff = Date.now() - 15_000;
      if (bufferRef.current.length > 80) {
        bufferRef.current = bufferRef.current.filter((frame) => frame.t >= cutoff);
      }
    }, 250);

    const pumpTimer = window.setInterval(() => {
      void (async () => {
        if (!watchingRef.current || inFlightRef.current) return;
        if (stateRef.current.phase === "break") return;

        if (simulateRef.current) {
          const now = Date.now();
          if (now - lastSimRef.current < 2_000) return;
          lastSimRef.current = now;
          const result = applyReading(stateRef.current, fakeReading(sceneRef.current, now), now);
          commit(result);
          if (!result.note) setStatus("Simulated window. No reminder.");
          return;
        }

        const fresh = bufferRef.current.filter((frame) => frame.t > lastSentRef.current);
        if (fresh.length < 2) return;
        const span = fresh[fresh.length - 1].t - fresh[0].t;
        if (span < 1_500) return;

        const selected = selectWindow(
          fresh.map((frame) => ({ ...frame, timestampMs: frame.t })),
          8,
        );
        lastSentRef.current = fresh[fresh.length - 1].t;
        bufferRef.current = bufferRef.current.filter((frame) => frame.t > lastSentRef.current);
        inFlightRef.current = true;
        setStatus("Mk1.5 is scoring the last two seconds.");
        try {
          await scoreWindow(
            selected.frames.map((frame) => ({ jpeg: frame.jpeg, t: frame.t })),
            selected.degraded,
          );
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
      window.clearInterval(pumpTimer);
      window.clearInterval(clock);
    };
    // The loop reads live values through refs. Restarting it on every render would drop frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  function rememberSimulation(on: boolean, nextScene: Scene = sceneRef.current) {
    simulateRef.current = on;
    sceneRef.current = nextScene;
    setSimulate(on);
    setScene(nextScene);
  }

  async function toggleWatching() {
    if (watching) {
      watchingRef.current = false;
      setWatching(false);
      setStatus("Watching paused. The Uno will stay quiet.");
      return;
    }
    if (!simulateRef.current) {
      setStatus("Opening the camera.");
      const ready = await ensureCamera();
      if (!ready) {
        setStatus("The camera did not open. Allow it in the browser bar, or turn on Simulate Mk1.5.");
        return;
      }
    }
    try {
      if (!audioRef.current) audioRef.current = new AudioContext();
      if (audioRef.current.state === "suspended") await audioRef.current.resume();
    } catch {
      // Watching still starts. The Uno, or a later click, can make the sound.
    }
    const now = Date.now();
    const fresh = initialAlertState(now);
    stateRef.current = fresh;
    setMetrics(fresh);
    bufferRef.current = [];
    lastSentRef.current = now;
    lastSimRef.current = 0;
    watchingRef.current = true;
    setWatching(true);
    setStatus(
      simulateRef.current
        ? "Simulated scores are running. The Uno still buzzes from those numbers."
        : "Collecting a two-second window for Mk1.5.",
    );
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

  function onBreak() {
    if (!watchingRef.current) {
      setStatus("Start watching before the break timer.");
      return;
    }
    commit(startBreak(stateRef.current, Date.now()));
  }

  const posture = metrics.postureScore === null ? "—" : String(metrics.postureScore);
  const phaseLabel =
    metrics.phase === "break"
      ? `Break ${breakLeft ?? 20}s`
      : metrics.phase === "no-face"
        ? "No face"
        : watching
          ? simulate
            ? "Simulated"
            : "Live"
          : "Idle";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Perch</h1>
          <Badge variant={watching ? "default" : "outline"}>{phaseLabel}</Badge>
          {unoReady ? <Badge variant="secondary">Uno</Badge> : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          This computer&apos;s camera is the eye. Perceptron Mk1.5 scores blinks and posture.
          The Arduino Uno only buzzes.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Camera</CardTitle>
            <CardDescription>
              Frames leave this page only as a two-second burst to Mk1.5. They are not stored.
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
                  {watching ? "Stop watching" : "Start watching"}
                </Button>
                <Button type="button" variant="outline" onClick={() => void onConnect()}>
                  Connect Uno
                </Button>
                <Button type="button" variant="secondary" onClick={onBreak} disabled={!watching}>
                  20-second break
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => void sound("B")}>
                  Test blink buzz
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void sound("P")}>
                  Test posture buzz
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Perceptron spend this session: ${spend.toFixed(3)} of ${SPEND_CAP_USD.toFixed(2)}.
                Speaker beeps are the stand-in until the Uno is connected.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Without an API key</CardTitle>
          <CardDescription>
            Simulated scores exercise the same buzzer rules. They do not call Perceptron.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={simulate}
              onChange={(event) => rememberSimulation(event.target.checked)}
            />
            Simulate Mk1.5
          </label>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["blinking", "Blinking normally"],
                ["staring", "Staring"],
                ["slouching", "Slouching"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={simulate && scene === value ? "default" : "outline"}
                onClick={() => rememberSimulation(true, value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uno wiring</CardTitle>
          <CardDescription>Flash arduino/perch_buzzer/perch_buzzer.ino, then connect from Chrome.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            <li>Piezo + to pin 8, piezo − to GND</li>
            <li>LED anode through 220Ω to pin 7, cathode to GND</li>
            <li>B is two high beeps: blink</li>
            <li>P is three low beeps: posture</li>
            <li>R is a 20-second pulse: look away</li>
            <li>USB serial at 9600. The sketch prints perch when it boots.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
