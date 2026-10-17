"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rememberDevice } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";

export function DeviceGate() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = normalizeDeviceId(value);
    if (!id) {
      setError("Use letters, numbers, hyphens, or underscores. Up to 80 characters.");
      return;
    }
    rememberDevice(id);
    router.push(`/device/${encodeURIComponent(id)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm" htmlFor="device-id">
        Buzzer device id
        <Input
          id="device-id"
          name="device"
          autoComplete="off"
          autoFocus
          placeholder="Paste the id printed on the buzzer"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-fit">
        Show this device
      </Button>
    </form>
  );
}
