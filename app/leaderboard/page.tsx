import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard-list";
import { SiteNav } from "@/components/site-nav";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Top device ids by posture points over the last 7 days.",
};

export default function LeaderboardPage() {
  return (
    <main
      id="content"
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 md:px-6 md:py-10"
    >
      <SiteNav current="leaderboard" />
      <Leaderboard />
    </main>
  );
}
