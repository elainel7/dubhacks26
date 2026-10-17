"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { DEVICE_STORAGE_KEY } from "@/lib/device-id";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("perch-device", onStoreChange);
  return () => window.removeEventListener("perch-device", onStoreChange);
}

function snapshot() {
  return sessionStorage.getItem(DEVICE_STORAGE_KEY);
}

function serverSnapshot() {
  return null;
}

export function rememberDevice(id: string) {
  sessionStorage.setItem(DEVICE_STORAGE_KEY, id);
  window.dispatchEvent(new Event("perch-device"));
}

export function SiteNav() {
  const uuid = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const numbers = uuid ? `/device/${encodeURIComponent(uuid)}` : "/";

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Perch
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href={numbers} className="text-muted-foreground hover:text-foreground">
          Numbers
        </Link>
        <Link href="/vision" className="text-muted-foreground hover:text-foreground">
          Camera
        </Link>
      </nav>
    </header>
  );
}
