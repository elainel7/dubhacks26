"use client";

import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { DEVICE_STORAGE_KEY } from "@/lib/device-id";

export function rememberDevice(deviceId: string) {
  sessionStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
  window.dispatchEvent(new Event("perch-device"));
}

export function SiteNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <Link
        href="/"
        className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <BrandMark />
        <span className="font-heading text-2xl leading-none text-foreground">Perch</span>
      </Link>
    </header>
  );
}
