import { postureApiBase } from "@/vision/events";

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hoursRaw = url.searchParams.get("hours") ?? "168";
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 2160) {
    return error(400, "bad_hours", "Choose a window up to 90 days.");
  }
  const limitRaw = url.searchParams.get("limit") ?? "10";
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return error(400, "bad_limit", "Choose a leaderboard of 1 to 50 people.");
  }
  const tz = url.searchParams.get("tz") ?? "America/Los_Angeles";
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) {
    return error(400, "bad_tz", "That timezone is not valid.");
  }

  try {
    const upstream = await fetch(
      `${postureApiBase()}/leaderboard?hours=${encodeURIComponent(String(hours))}&limit=${limit}&tz=${encodeURIComponent(tz)}`,
      { cache: "no-store", signal: AbortSignal.timeout(12_000) },
    );
    if (!upstream.ok) {
      return error(502, "upstream", "The posture API did not return the leaderboard.");
    }
    return Response.json(await upstream.json());
  } catch {
    return error(502, "upstream", "Could not reach the posture API.");
  }
}
