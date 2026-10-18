"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  getFootageServerSnapshot,
  getFootageSnapshot,
  startFootage,
  stopFootage,
  subscribeFootage,
} from "@/components/footage-session";

export function FootageToggle() {
  const footage = useSyncExternalStore(subscribeFootage, getFootageSnapshot, getFootageServerSnapshot);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!footage.deviceId || pathname === "/camera") return;
    const target = `/device/${encodeURIComponent(footage.deviceId)}`;
    if (pathname !== target) router.replace(target);
  }, [footage.deviceId, pathname, router]);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant={footage.collecting ? "default" : "outline"}
        aria-pressed={footage.collecting}
        disabled={footage.starting}
        className="h-11 px-4"
        onClick={() => void (footage.collecting ? stopFootage() : startFootage())}
      >
        {footage.collecting ? "Collecting footage" : "Not collecting footage"}
      </Button>
      {footage.boardLine ? (
        <p className="max-w-sm text-sm text-muted-foreground">{footage.boardLine}</p>
      ) : null}
      {footage.error ? (
        <p role="alert" className="max-w-sm text-sm font-medium text-bad">
          {footage.error}
        </p>
      ) : null}
    </div>
  );
}
