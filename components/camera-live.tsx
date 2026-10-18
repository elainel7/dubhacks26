"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";
import { AwardToast } from "@/components/award-toast";
import { FootageToggle } from "@/components/footage-toggle";
import { getFootageServerSnapshot, getFootageSnapshot, subscribeFootage } from "@/components/footage-session";
import { rememberDevice, useRememberedDevice } from "@/components/site-nav";
import { usePoints } from "@/components/use-points";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeDeviceId } from "@/lib/device-id";
import { formatMultiplier } from "@/lib/points";

export function CameraLive() {
  const params = useSearchParams();
  const remembered = useRememberedDevice();
  const footage = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot);
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const fromQuery = normalizeDeviceId(params.get("device") ?? "");
  const deviceId = footage.deviceId ?? picked ?? fromQuery ?? remembered;
  const { status, points, error, toast, dismissToast } = usePoints(deviceId);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = normalizeDeviceId(draft);
    if (!id) {
      setFormError("Use letters, numbers, hyphens, or underscores. Up to 80 characters.");
      return;
    }
    rememberDevice(id);
    setPicked(id);
    setFormError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="max-w-xl">
        <h1 className="text-3xl text-foreground sm:text-4xl">Camera</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Start camera sends frames to the board. Blinks are counted here. This page does not show the picture.
        </p>
      </div>

      {deviceId ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Device id</p>
              <p className="font-heading text-3xl break-all text-foreground">{deviceId}</p>
            </div>
            <FootageToggle />
          </div>

          <section className="grid gap-3 sm:grid-cols-3" aria-label="Live points">
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Points today</h2>
              <p className="mt-2 font-heading text-4xl tabular-nums text-foreground">
                {status === "ready" && points ? points.points_today : "—"}
              </p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Flow</h2>
              <p className="mt-2 font-heading text-4xl tabular-nums text-foreground">
                {status === "ready" && points
                  ? `${points.flow_streak_minutes} ×${formatMultiplier(points.flow_multiplier)}`
                  : "—"}
              </p>
            </article>
            <article className="rounded-2xl bg-card px-5 py-4 ring-1 ring-foreground/10">
              <h2 className="text-sm font-semibold text-muted-foreground">Level</h2>
              <p className="mt-2 font-heading text-3xl text-foreground">
                {status === "ready" && points ? points.level.title : "—"}
              </p>
            </article>
          </section>

          {status === "loading" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading points…
            </p>
          ) : null}
          {status === "error" ? (
            <p role="alert" className="text-sm font-medium text-bad">
              {error}
            </p>
          ) : null}
          {status === "ready" && points && points.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upright minutes in the last 7 days yet. Sit up and the next saved score can start a streak.
            </p>
          ) : null}
        </>
      ) : (
        <form onSubmit={onSubmit} className="max-w-md rounded-2xl bg-card px-5 py-5 ring-1 ring-foreground/10" noValidate>
          <label className="text-sm font-semibold" htmlFor="camera-device">
            Device id
          </label>
          <Input
            id="camera-device"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            placeholder="user_1"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "camera-device-error" : undefined}
            className="mt-2 h-11 bg-background px-3 text-base"
            onChange={(event) => {
              setDraft(event.target.value);
              setFormError(null);
            }}
          />
          {formError ? (
            <p id="camera-device-error" role="alert" className="mt-2 text-sm font-medium text-bad">
              {formError}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">The id printed on the lamp.</p>
          )}
          <Button type="submit" className="mt-4 h-11 px-4 text-base">
            Watch this device
          </Button>
        </form>
      )}

      <AwardToast message={toast} onDismiss={dismissToast} />
    </div>
  );
}
