"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { DEVICE_STORAGE_KEY, normalizeDeviceId } from "@/lib/device-id";
import { cn } from "@/lib/utils";

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

export function useRememberedDevice() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!raw) return null;
  return normalizeDeviceId(raw);
}

export function rememberDevice(deviceId: string) {
  sessionStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
  window.dispatchEvent(new Event("perch-device"));
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function SiteNav({ current }: { current?: "device" | "camera" | "leaderboard" }) {
  const deviceId = useRememberedDevice();
  const deviceHref = deviceId ? `/device/${encodeURIComponent(deviceId)}` : "/";

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Link
        href="/"
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <span className="text-lg font-semibold leading-none text-foreground">no hunch club</span>
      </Link>
      <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 border border-border bg-card p-1">
        <NavLink href={deviceHref} current={current === "device"}>
          Device
        </NavLink>
        <NavLink href="/camera" current={current === "camera"}>
          Camera
        </NavLink>
        <NavLink href="/leaderboard" current={current === "leaderboard"}>
          Leaderboard
        </NavLink>
      </nav>
    </header>
  );
}
