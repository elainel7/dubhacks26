import { DeviceIdForm } from "@/components/device-id-form";
import { SiteNav } from "@/components/site-nav";

const highlights = [
  {
    title: "Start camera",
    body: "Use Chrome or Edge. Allow the webcam, then pick the board's USB port. The page does not show the video.",
  },
  {
    title: "Charts",
    body: "Posture is 1 to 100 from the board over the last 10 minutes. 60 or below is poor posture. The blink chart is seconds since your eyes last opened.",
  },
  {
    title: "Beeps",
    body: "The board chirps every 5 seconds you go without a blink. A longer tone plays if poor posture keeps going.",
  },
];

export default function HomePage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav />
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-xl text-3xl text-foreground sm:text-4xl">Posture and blinks</h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            Enter the device id shown on the board. The next page has that device&apos;s scores, and Start camera connects this computer to the board.
          </p>
        </div>
        <DeviceIdForm />
      </section>
      <ul className="grid gap-3 sm:grid-cols-3">
        {highlights.map((item) => (
          <li key={item.title} className="border border-border bg-card px-4 py-4">
            <p className="font-heading text-xl text-foreground">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
