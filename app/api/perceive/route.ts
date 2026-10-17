import {
  buildPerceptronRequest,
  parseDeskContent,
  type DeskScore,
} from "@/vision/desk";

const PERCEPTRON_URL = "https://api.perceptron.inc/v1/chat/completions";
const MAX_FRAMES = 12;
const MAX_FRAME_CHARS = 250_000;

type IncomingFrame = { jpeg_base64?: unknown; timestamp_ms?: unknown };

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

function readFrames(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const frames = (value as { frames?: unknown }).frames;
  if (!Array.isArray(frames) || frames.length < 2 || frames.length > MAX_FRAMES) return null;

  const parsed: { jpegBase64: string; timestampMs: number }[] = [];
  let last = -1;
  for (const frame of frames as IncomingFrame[]) {
    if (typeof frame.jpeg_base64 !== "string" || typeof frame.timestamp_ms !== "number") {
      return null;
    }
    if (!Number.isFinite(frame.timestamp_ms) || frame.timestamp_ms < last) return null;
    if (frame.jpeg_base64.length === 0 || frame.jpeg_base64.length > MAX_FRAME_CHARS) return null;
    last = frame.timestamp_ms;
    parsed.push({ jpegBase64: frame.jpeg_base64, timestampMs: Math.round(frame.timestamp_ms) });
  }
  return parsed;
}

async function callPerceptron(
  apiKey: string,
  model: string,
  frames: { jpegBase64: string; timestampMs: number }[],
  withReasoningEffort: boolean,
) {
  const response = await fetch(PERCEPTRON_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildPerceptronRequest(model, frames, withReasoningEffort)),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { response, payload };
}

type PerceptronPayload = {
  error?: { message?: string; code?: string };
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function messageFrom(payload: unknown): PerceptronPayload {
  if (!payload || typeof payload !== "object") return {};
  return payload as PerceptronPayload;
}

export async function POST(request: Request) {
  const apiKey = process.env.PERCEPTRON_API_KEY;
  if (!apiKey) {
    return error(
      503,
      "missing_key",
      "Add PERCEPTRON_API_KEY to .env.local and restart the dev server.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(400, "bad_request", "The frame payload was not JSON.");
  }

  const frames = readFrames(body);
  if (!frames) {
    return error(400, "bad_request", "Send between 2 and 12 JPEG frames with timestamps.");
  }

  const model = process.env.PERCEPTRON_MODEL || "perceptron-mk1.5";
  const started = Date.now();

  try {
    let attempt = await callPerceptron(apiKey, model, frames, true);
    if (attempt.response.status === 400) {
      attempt = await callPerceptron(apiKey, model, frames, false);
    }

    const parsed = messageFrom(attempt.payload);
    if (!attempt.response.ok) {
      const code = parsed.error?.code ?? "perceptron_error";
      const message = parsed.error?.message ?? `Perceptron returned ${attempt.response.status}.`;
      return error(attempt.response.status, code, message.slice(0, 300));
    }

    const choice = parsed.choices?.[0];
    if (!choice || choice.finish_reason !== "stop" || !choice.message?.content) {
      return error(502, "incomplete", "Mk1.5 did not finish a score. This window was discarded.");
    }

    const score: DeskScore | null = parseDeskContent(choice.message.content);
    if (!score) {
      return error(502, "unreadable", "Mk1.5 returned a score that did not match the schema.");
    }

    return Response.json({
      ...score,
      model,
      latency_ms: Date.now() - started,
      usage: {
        prompt_tokens: parsed.usage?.prompt_tokens ?? 0,
        completion_tokens: parsed.usage?.completion_tokens ?? 0,
      },
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    if (timedOut) {
      return error(504, "timeout", "Mk1.5 took longer than 20 seconds. This window was discarded.");
    }
    return error(502, "network", "Could not reach Perceptron.");
  }
}
