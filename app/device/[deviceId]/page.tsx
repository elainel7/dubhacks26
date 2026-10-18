import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeviceChart } from "@/components/device-chart";
import { SiteNav } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";

type DevicePageProps = { params: Promise<{ deviceId: string }> };

export async function generateMetadata({ params }: DevicePageProps): Promise<Metadata> {
  const { deviceId: raw } = await params;
  const deviceId = normalizeDeviceId(decodeURIComponent(raw));
  return {
    title: deviceId ? `Device ${deviceId}` : "Device",
    description: deviceId
      ? `Percent upright, good and bad posture, and the most common problem for device id ${deviceId}.`
      : "Posture for one device id.",
  };
}

function DeviceLoading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <div className="h-16 w-48 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      </div>
      <p className="text-sm text-muted-foreground">Loading posture for this device id…</p>
    </div>
  );
}

async function DeviceBody({ params }: DevicePageProps) {
  const { deviceId: raw } = await params;
  const deviceId = normalizeDeviceId(decodeURIComponent(raw));
  if (!deviceId) notFound();

  return (
    <DeviceChart deviceId={deviceId} />
  );
}

export default function DevicePage({ params }: DevicePageProps) {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav current="device" />
      <Suspense fallback={<DeviceLoading />}>
        <DeviceBody params={params} />
      </Suspense>
    </main>
  );
}
