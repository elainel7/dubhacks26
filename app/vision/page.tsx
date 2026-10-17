import { SiteNav } from "@/components/site-nav";
import { CameraView } from "@/vision/camera-view";

export default function VisionPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <SiteNav />
      <CameraView />
    </main>
  );
}
