"use client";

import { useEffect, useState } from "react";
import type { LeaderboardSnapshot } from "@/lib/points";

const POLL_MS = 30_000;

export function Leaderboard({ heading = "page" }: { heading?: "page" | "section" }) {
  const Title = heading === "section" ? "h2" : "h1";
  const titleClass = heading === "section" ? "text-2xl text-foreground" : "text-3xl text-foreground sm:text-4xl";
  const [board, setBoard] = useState<LeaderboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    async function load(initial: boolean) {
      try {
        const response = await fetch("/api/leaderboard?hours=168&limit=10", { signal: controller.signal });
        let body: LeaderboardSnapshot & { message?: string };
        try {
          body = (await response.json()) as LeaderboardSnapshot & { message?: string };
        } catch {
          throw new Error("Could not load the leaderboard.");
        }
        if (!response.ok) throw new Error(body.message ?? "Could not load the leaderboard.");
        if (!live) return;
        setBoard(body);
        setError(null);
      } catch (cause) {
        if (!live || (cause instanceof DOMException && cause.name === "AbortError")) return;
        if (initial) {
          setBoard(null);
          setError(cause instanceof Error ? cause.message : "Could not load the leaderboard.");
        }
      } finally {
        if (live && initial) setLoading(false);
      }
    }

    void load(true);
    const timer = window.setInterval(() => void load(false), POLL_MS);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="board-title">
      <div className="max-w-xl">
        <Title id="board-title" className={titleClass}>
          Leaderboard
        </Title>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Top desks by points over the last 7 days. A name is the display name on file, or the device id when there
          isn&apos;t one.
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <div className="h-16 animate-pulse rounded-2xl bg-muted" />
          <p className="text-sm text-muted-foreground">Loading the leaderboard…</p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-bad/30 bg-card px-5 py-4">
          <h2 className="text-xl text-foreground">Could not load the leaderboard</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {!loading && !error && board && board.leaders.length === 0 ? (
        <div className="rounded-2xl bg-card px-5 py-8 ring-1 ring-foreground/10">
          <h2 className="text-2xl text-foreground">No points yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Upright minutes in the last 7 days will show up here. There is nothing to rank in this window.
          </p>
        </div>
      ) : null}

      {!loading && !error && board && board.leaders.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {board.leaders.map((leader) => (
            <li
              key={`${leader.rank}-${leader.display_name}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10"
            >
              <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {leader.rank}
              </span>
              <span className="truncate font-semibold text-foreground">{leader.display_name}</span>
              <span className="font-heading text-2xl tabular-nums text-foreground">{leader.points}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
