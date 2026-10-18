"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeDeviceId } from "@/lib/device-id";
import { serialAvailable } from "@/lib/serial";
import { rememberDevice } from "@/components/site-nav";
import {
  connectEsp32,
  FRAME_H,
  FRAME_W,
  type EspLink,
  type EspLine,
  type EspScore,
} from "@/vision/esp32-link";

type Phase = "idle" | "live" | "break" | "no-face";

function formatSeconds(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return Math.max(0, value).toFixed(1);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const linkRef = useRef<EspLink | null>(null);
  const sendingRef = useRef(false);
  const deviceRef = useRef<string | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("Allow the camera, then connect the ESP32.");
  const [boardError, setBoardError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [score, setScore] = useState<EspScore | null>(null);
  const [scoreAt, setScoreAt] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [breakUntil, setBreakUntil] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const serialReady = useSyncExternalStore(
    () => () => {},
    () => serialAvailable(),
    () => false,
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      sendingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void linkRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!sending) return;
    let cancelled = false;

    const grab = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return null;
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
    };

    const pump = async () => {
      while (!cancelled && sendingRef.current) {
        const link = linkRef.current;
        const gray = grab();
        if (!link || !gray) {
          await sleep(40);
          continue;
        }
        const started = performance.now();
        try {
          await link.sendFrame(Date.now(), gray);
        } catch {
          if (cancelled || !sendingRef.current) return;
          setBoardError("The ESP32 stopped answering.");
          setStatus("Unplug the board, plug it back in, and connect again.");
          setConnected(false);
          setSending(false);
          sendingRef.current = false;
          const dropped = linkRef.current;
          linkRef.current = null;
          await dropped?.close();
          return;
        }
        const rest = 70 - (performance.now() - started);
        if (rest > 0) await sleep(rest);
      }
    };

    void pump();
    return () => {
      cancelled = true;
    };
  }, [sending]);

  function onBoardLine(line: EspLine) {
    if (line.kind === "device") {
      const id = normalizeDeviceId(line.id);
      if (!id || deviceRef.current === id) return;
      deviceRef.current = id;
      rememberDevice(id);
      setDeviceId(id);
      return;
    }
    if (line.kind === "score") {
      setScore(line);
      setScoreAt(Date.now());
      setBoardError(null);
      setPhase((current) => {
        if (current === "break") return current;
        return line.face ? "live" : "no-face";
      });
      setStatus(line.face ? "The ESP32 scored this sheet." : "Step into frame.");
      return;
    }
    if (line.kind === "note") {
      setStatus(line.text);
      if (line.text.startsWith("Look away")) {
        setPhase("break");
        setBreakUntil(Date.now() + 20_000);
      } else if (line.text === "Break over.") {
        setPhase("live");
        setBreakUntil(null);
      } else if (line.text === "Step into frame.") {
        setPhase("no-face");
      }
      return;
    }
    if (line.kind === "saved") {
      setSaveNote("Saved to Tiger Data.");
      return;
    }
    if (line.kind === "unsaved") {
      setSaveNote("The ESP32 could not save this score.");
      return;
    }
    if (line.kind === "error") {
      setBoardError(line.text);
    }
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
      setCameraError("Camera permission was blocked. Allow the camera for this page, then try again.");
      setCameraOn(false);
      return false;
    }
  }

  async function toggleCamera() {
    if (cameraOn) {
      sendingRef.current = false;
      setSending(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
      setPhase("idle");
      setStatus("Camera paused. The ESP32 keeps its last score.");
      return;
    }
    setStatus("Opening the camera.");
    const ready = await ensureCamera();
    if (!ready) {
      setStatus("The camera did not open. Allow it in the browser bar.");
      return;
    }
    if (linkRef.current) {
      sendingRef.current = true;
      setSending(true);
      setPhase("live");
      setStatus("Sending frames to the ESP32.");
      return;
    }
    setStatus("Camera is on. Connect the ESP32 to start sending frames.");
  }

  async function onConnect() {
    if (!serialReady) {
      setBoardError("Web Serial needs Chrome or Edge.");
      return;
    }
    try {
      const link = await connectEsp32(() => navigator.serial.requestPort(), onBoardLine);
      await linkRef.current?.close();
      linkRef.current = link;
      setConnected(true);
      setBoardError(null);
      setStatus("ESP32 connected. It scores, buzzes, and saves under its own device id.");
      if (streamRef.current) {
        sendingRef.current = true;
        setSending(true);
        setPhase("live");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not open a serial port.";
      if (message.toLowerCase().includes("cancel") || message.includes("No port selected")) return;
      setBoardError(message);
    }
  }

  const gap =
    score && Number.isFinite(score.gap)
      ? score.gap + (scoreAt !== null && now > 0 ? Math.max(0, now - scoreAt) / 1000 : 0)
      : null;
  const breakLeft =
    phase === "break" && breakUntil && now > 0 ? Math.max(0, Math.ceil((breakUntil - now) / 1000)) : phase === "break" ? 20 : null;
  const posture =
    score && score.face && Number.isFinite(score.posture) && score.posture >= 1 ? String(score.posture) : "—";
  const postureTone =
    !score || !score.face || !Number.isFinite(score.posture) || score.posture < 1
      ? "text-foreground"
      : score.posture <= 60
        ? "text-bad"
        : "text-good";
  const phaseLabel =
    phase === "break" ? `Break ${breakLeft ?? 20}s` : phase === "no-face" ? "No face" : sending ? "Live" : "Idle";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex max-w-2xl flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-4xl text-foreground sm:text-5xl">Camera</h1>
          <Badge variant={sending ? "default" : "outline"}>{phaseLabel}</Badge>
          {connected ? <Badge variant="secondary">ESP32</Badge> : null}
        </div>
        <p className="text-base leading-relaxed text-muted-foreground">
          This computer is the camera. Frames go over USB to the ESP32, which builds each contact sheet,
          asks Perceptron, buzzes, and writes the score to Tiger Data for its own device id.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.85fr)]">
        <Card className="bg-card/95">
          <CardHeader>
            <CardTitle>Camera</CardTitle>
            <CardDescription>
              The preview stays here. Eight small grayscale frames become one sheet on the ESP32. Frames are
              not stored on this computer.
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
                    Plug the ESP32 in with a data USB cable, then connect it. The board does the rest.
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
            {boardError ? (
              <p role="alert" className="text-sm font-medium text-bad">
                ESP32: {boardError}
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
              <CardTitle className="font-heading text-2xl">From the ESP32</CardTitle>
              <CardDescription className="leading-relaxed">
                {score
                  ? `Head ${score.head}, shoulders ${score.shoulders}. A stare of 5 seconds buzzes on the board. Under 20 blinks in a minute buzzes again.`
                  : "Numbers show up after the board finishes a contact sheet."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-muted px-2 py-3 sm:px-3">
                  <dt className="text-xs font-semibold text-muted-foreground">Seconds since blink</dt>
                  <dd className="mt-1 font-heading text-3xl tabular-nums">{sending ? formatSeconds(gap) : "—"}</dd>
                </div>
                <div className="rounded-xl bg-muted px-2 py-3 sm:px-3">
                  <dt className="text-xs font-semibold text-muted-foreground">Blinks / min</dt>
                  <dd className="mt-1 font-heading text-3xl tabular-nums">
                    {score && Number.isFinite(score.rate) ? score.rate : "—"}
                  </dd>
                </div>
                <div className="rounded-xl bg-muted px-2 py-3 sm:px-3">
                  <dt className="text-xs font-semibold text-muted-foreground">Posture 1–100</dt>
                  <dd className={`mt-1 font-heading text-3xl tabular-nums ${postureTone}`}>{posture}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="bg-card/95">
            <CardHeader>
              <CardTitle className="font-heading text-2xl">Controls</CardTitle>
              <CardDescription>
                {serialReady
                  ? connected
                    ? "USB port open."
                    : "ESP32 not connected."
                  : "Web Serial needs Chrome or Edge."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="h-11 px-4" onClick={() => void toggleCamera()}>
                  {cameraOn ? "Stop camera" : "Allow the camera"}
                </Button>
                <Button type="button" variant="outline" className="h-11 px-4" onClick={() => void onConnect()}>
                  Connect ESP32
                </Button>
              </div>
              {deviceId ? (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Device id {deviceId}.{" "}
                  <Link
                    href={`/device/${encodeURIComponent(deviceId)}`}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Open its chart
                  </Link>
                  . The firmware is <span className="font-mono text-xs">esp32/perch_esp32/perch_esp32.ino</span>.
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  The board announces its device id after you connect. That id is the one to open on the home
                  page. Firmware: <span className="font-mono text-xs">esp32/perch_esp32/perch_esp32.ino</span>.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
