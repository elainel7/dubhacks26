import {
  buildPerceptronRequest,
  parseDeskContent,
  type DeskScore,
} from "@/vision/desk";

const PERCEPTRON_URL = "https://api.perceptron.inc/v1/chat/completions";
const MAX_IMAGE_CHARS = 2_000_000;

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

function readSheet(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as { image_base64?: unknown; panel_count?: unknown; duration_ms?: unknown };
  if (typeof record.image_base64 !== "string") return null;
  if (record.image_base64.length === 0 || record.image_base64.length > MAX_IMAGE_CHARS) return null;
  const panelCount = record.panel_count;
  const durationMs = record.duration_ms;
  if (typeof panelCount !== "number" || panelCount < 2 || panelCount > 30) return null;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return { imageBase64: record.image_base64, panelCount, durationMs: Math.round(durationMs) };
}

async function callPerceptron(
  apiKey: string,
  model: string,
  sheet: { imageBase64: string; panelCount: number; durationMs: number },
  withReasoningEffort: boolean,
) {
  const response = await fetch(PERCEPTRON_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildPerceptronRequest(model, sheet.imageBase64, sheet.panelCount, sheet.durationMs, withReasoningEffort),
    ),
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

  const sheet = readSheet(body);
  if (!sheet) {
    return error(400, "bad_request", "Send one contact-sheet JPEG.");
  }

  const model = process.env.PERCEPTRON_MODEL || "perceptron-mk1.5";
  const started = Date.now();

  try {
    let attempt = await callPerceptron(apiKey, model, sheet, true);
    const firstMessage = messageFrom(attempt.payload).error?.message ?? "";
    const quota = attempt.response.status === 429 || attempt.response.status === 402 || /quota|rate limit/i.test(firstMessage);
    if (attempt.response.status === 400 && !quota) {
      attempt = await callPerceptron(apiKey, model, sheet, false);
    }

    const parsed = messageFrom(attempt.payload);
    if (!attempt.response.ok) {
      const message = parsed.error?.message ?? `Perceptron returned ${attempt.response.status}.`;
      const blocked = attempt.response.status === 429 || attempt.response.status === 402 || /quota|rate limit/i.test(message);
      if (blocked) {
        return error(429, "quota", message.slice(0, 300));
      }
      const code = parsed.error?.code ?? "perceptron_error";
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
