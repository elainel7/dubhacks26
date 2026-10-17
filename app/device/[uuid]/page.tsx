import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeviceChart } from "@/components/device-chart";
import { SiteNav } from "@/components/site-nav";
import { normalizeDeviceId } from "@/lib/device-id";

async function DeviceBody({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid: raw } = await params;
  const uuid = normalizeDeviceId(decodeURIComponent(raw));
  if (!uuid) notFound();

  return (
    <>
      <SiteNav />
      <DeviceChart uuid={uuid} />
    </>
  );
}

export default function DevicePage({ params }: { params: Promise<{ uuid: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading this device…</p>}>
        <DeviceBody params={params} />
      </Suspense>
    </main>
  );
}
