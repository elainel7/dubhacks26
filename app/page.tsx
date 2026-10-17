import { DeviceIdForm } from "@/components/device-id-form";
import { SiteNav } from "@/components/site-nav";

const highlights = [
  {
    title: "Percent upright",
    body: "How much of the window counted as good posture.",
  },
  {
    title: "Good and bad posture",
    body: "Each minute, side by side, for one device id.",
  },
  {
    title: "Most common problem",
    body: "The slip that showed up most often.",
  },
];

export default function HomePage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav current="device" />
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] lg:gap-14">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">Perch</p>
          <h1 className="max-w-xl text-4xl leading-[1.05] text-foreground sm:text-5xl md:text-6xl">
            No more hunching.
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
            Perch watches the person at the desk and keeps a simple record: how much of the time they sat
            upright, and what went wrong when they didn&apos;t.
          </p>
        </div>
        <DeviceIdForm />
      </section>
      <ul className="grid gap-3 sm:grid-cols-3">
        {highlights.map((item) => (
          <li key={item.title} className="rounded-2xl bg-card/80 px-4 py-4 ring-1 ring-foreground/10">
            <p className="font-heading text-xl text-foreground">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
