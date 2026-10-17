import { forwardPostureEvent, parseStoredEvent } from "@/vision/events";

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "bad_request", "The event payload was not JSON.");
  }

  const parsed = parseStoredEvent(body);
  if ("message" in parsed) {
    return error(400, "bad_request", parsed.message);
  }

  return forwardPostureEvent(parsed.event);
}
