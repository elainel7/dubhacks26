"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { rememberDevice } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";

export function DeviceIdForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const deviceId = normalizeDeviceId(value);
    if (!deviceId) {
      setError("Use letters, numbers, hyphens, or underscores. Up to 80 characters.");
      return;
    }
    rememberDevice(deviceId);
    router.push(`/device/${encodeURIComponent(deviceId)}`);
  }

  return (
    <Card className="bg-card/95 shadow-[0_16px_40px_rgb(28_36_32_/_0.06)]">
      <CardHeader>
        <CardTitle className="font-heading text-2xl text-foreground">Open a device</CardTitle>
        <CardDescription className="text-base leading-relaxed">
          Type the device id printed on the lamp. This page shows only that device&apos;s posture.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold" htmlFor="device-id">
              Device id
            </label>
            <Input
              id="device-id"
              name="device-id"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              placeholder="user_1"
              value={value}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "device-id-error" : "device-id-hint"}
              className="h-11 bg-background px-3 text-base md:text-base"
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id="device-id-error" role="alert" className="text-sm font-medium text-bad">
                {error}
              </p>
            ) : (
              <p id="device-id-hint" className="text-sm text-muted-foreground">
                Letters, numbers, hyphens, or underscores.
              </p>
            )}
          </div>
          <Button type="submit" className="h-11 px-4 text-base">
            Show this device
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
