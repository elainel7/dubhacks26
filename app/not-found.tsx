import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav />
      <section className="max-w-xl rounded-2xl bg-card px-6 py-8 ring-1 ring-foreground/10">
        <h1 className="text-3xl text-foreground">That device id is not valid</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Use letters, numbers, hyphens, or underscores, then open the device again.
        </p>
        <Link href="/" className={`${buttonVariants()} mt-6 h-11 px-4 text-base`}>
          Enter a device id
        </Link>
      </section>
    </main>
  );
}
