import { normalizeDeviceId } from "@/lib/device-id";

const API = (process.env.POSTURE_API_BASE || "https://posture-api-x1my.onrender.com").replace(/\/$/, "");

type RouteContext = { params: Promise<{ deviceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { deviceId: raw } = await context.params;
  const deviceId = normalizeDeviceId(decodeURIComponent(raw));
  if (!deviceId) {
    return Response.json({ error: "bad_id", message: "That device id is not valid." }, { status: 400 });
  }

  const encodedDeviceId = encodeURIComponent(deviceId);
  try {
    const upstream = await fetch(`${API}/users/${encodedDeviceId}/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!upstream.ok) {
      return Response.json(
        { error: "upstream", message: "The posture API did not return this device." },
        { status: 502 },
      );
    }
    const live = (await upstream.json()) as unknown;
    return Response.json(live);
  } catch {
    return Response.json({ error: "upstream", message: "Could not reach the posture API." }, { status: 502 });
  }
}
