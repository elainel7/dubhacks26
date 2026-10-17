import type { HeadState, ShoulderState } from "./alerts";

export const INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
export const OUTPUT_USD_PER_TOKEN = 1.5 / 1_000_000;
export const SPEND_CAP_USD = 3;

export type DeskScore = {
  face_visible: boolean;
  blink_count: number;
  posture_score: number;
  head: HeadState;
  shoulders: ShoulderState;
};

const HEADS: readonly HeadState[] = ["upright", "forward", "unknown"];
const SHOULDERS: readonly ShoulderState[] = ["level", "tilted", "unknown"];

export const DESK_PROMPT = [
  "These frames are one webcam clip of a person at a laptop, in timestamp order.",
  "blink_count is how many times the eyelids fully close and open again in this clip.",
  "Looking down is not a blink. A blink is short.",
  "posture_score is an integer from 1 to 10 for the last frame.",
  "10 is upright, with the head over the shoulders.",
  "1 is a deep slouch or the head pushed toward the screen.",
  "If no face is visible, face_visible is false, blink_count is 0, posture_score is 5, and head and shoulders are unknown.",
  "Do not identify the person.",
].join(" ");

export function deskSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      face_visible: { type: "boolean" },
      blink_count: { type: "integer" },
      posture_score: { type: "integer" },
      head: { type: "string", enum: [...HEADS] },
      shoulders: { type: "string", enum: [...SHOULDERS] },
    },
    required: ["face_visible", "blink_count", "posture_score", "head", "shoulders"],
  };
}

export function buildPerceptronRequest(
  model: string,
  frames: { jpegBase64: string; timestampMs: number }[],
  withReasoningEffort: boolean,
) {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: 200,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "desk_state",
        strict: true,
        schema: deskSchema(),
      },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "video_frames",
            video_frames: {
              frames: frames.map((frame) => ({
                image_url: { url: `data:image/jpeg;base64,${frame.jpegBase64}` },
                timestamp_ms: frame.timestampMs,
              })),
            },
          },
          { type: "text", text: DESK_PROMPT },
        ],
      },
    ],
  };

  if (withReasoningEffort) body.reasoning_effort = "none";
  return body;
}

export function parseDeskContent(content: string): DeskScore | null {
  const trimmed = content.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let value: unknown;
  try {
    value = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.face_visible !== "boolean") return null;
  if (typeof record.blink_count !== "number" || !Number.isFinite(record.blink_count)) return null;
  if (typeof record.posture_score !== "number" || !Number.isFinite(record.posture_score)) return null;
  if (typeof record.head !== "string" || !HEADS.includes(record.head as HeadState)) return null;
  if (
    typeof record.shoulders !== "string" ||
    !SHOULDERS.includes(record.shoulders as ShoulderState)
  ) {
    return null;
  }

  return {
    face_visible: record.face_visible,
    blink_count: Math.max(0, Math.min(6, Math.round(record.blink_count))),
    posture_score: Math.max(1, Math.min(10, Math.round(record.posture_score))),
    head: record.head as HeadState,
    shoulders: record.shoulders as ShoulderState,
  };
}

export function tokenCost(promptTokens: number, completionTokens: number) {
  return promptTokens * INPUT_USD_PER_TOKEN + completionTokens * OUTPUT_USD_PER_TOKEN;
}
