import { DeviceGate } from "@/components/device-gate";
import { SiteNav } from "@/components/site-nav";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-8">
      <SiteNav />
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Which buzzer is this?</h1>
        <p className="text-sm text-muted-foreground">
          Type the id on the device. The next page shows only that buzzer&apos;s numbers.
        </p>
      </div>
      <DeviceGate />
    </main>
  );
}
