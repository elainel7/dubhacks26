import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import { CameraView } from "@/vision/camera-view";

export const metadata: Metadata = {
  title: "Camera",
  description: "The laptop camera sends frames to an ESP32. The board scores, buzzes, and saves. Frames are not stored.",
};

export default function CameraPage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav current="camera" />
      <CameraView />
    </main>
  );
}
