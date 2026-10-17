import { normalizeDeviceId } from "@/lib/device-id";

const API = (process.env.POSTURE_API_BASE || "https://posture-api-x1my.onrender.com").replace(/\/$/, "");

type RouteContext = { params: Promise<{ uuid: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { uuid: raw } = await context.params;
  const uuid = normalizeDeviceId(decodeURIComponent(raw));
  if (!uuid) {
    return Response.json({ error: "bad_id", message: "That device id is not valid." }, { status: 400 });
  }

  const hoursRaw = new URL(request.url).searchParams.get("hours") ?? "6";
  const hours = Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return Response.json({ error: "bad_hours", message: "Choose a window from 1 to 168 hours." }, { status: 400 });
  }

  const user = encodeURIComponent(uuid);
  try {
    const [timelineRes, summaryRes] = await Promise.all([
      fetch(`${API}/users/${user}/timeline?hours=${hours}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
      fetch(`${API}/users/${user}/summary?hours=${hours}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) }),
    ]);
    if (!timelineRes.ok || !summaryRes.ok) {
      return Response.json(
        { error: "upstream", message: "The posture API did not return this device." },
        { status: 502 },
      );
    }
    const timeline = (await timelineRes.json()) as unknown;
    const summary = (await summaryRes.json()) as unknown;
    return Response.json({ timeline, summary });
  } catch {
    return Response.json({ error: "upstream", message: "Could not reach the posture API." }, { status: 502 });
  }
}
