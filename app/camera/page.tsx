import type { Metadata } from "next";
import { Suspense } from "react";
import { CameraLive } from "@/components/camera-live";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Camera",
  description: "Start the camera, send frames to the board, and count blinks in the browser.",
};

function CameraLoading() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <div className="h-16 w-64 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <p className="text-sm text-muted-foreground">Loading the camera page…</p>
    </div>
  );
}

export default function CameraPage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav current="camera" />
      <Suspense fallback={<CameraLoading />}>
        <CameraLive />
      </Suspense>
    </main>
  );
}
