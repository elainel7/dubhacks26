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

export function contactSheetPrompt(panelCount: number, durationMs: number) {
  const seconds = Math.max(0.2, durationMs / 1000).toFixed(1);
  return [
    `This image is one contact sheet of ${panelCount} webcam panels of a person at a laptop.`,
    "Read the panels left to right, then top to bottom. Each panel is labeled with seconds from the start of the sheet.",
    `The sheet covers ${seconds} seconds.`,
    "The panels are every frame the camera produced, usually 30 to 60 per second, over about half a second.",
    "A blink lasts about a tenth of a second, so the eyelids should be shut in several panels in a row.",
    "blink_count is the number of blinks, not the number of panels with closed eyes.",
    "One blink is a run of panels where the eyelids close and then open.",
    "The person may wear glasses. Score the eyelids, not the lenses or the glare.",
    "A bright reflection on the glasses is not an open eye.",
    "Looking down is not a blink.",
    "posture_score is an integer from 1 to 10 for the last panel only.",
    "10 is rare: ears over the shoulders, chin slightly tucked, neck long, torso not leaning toward the screen.",
    "7 is already poor: head forward of the shoulders, rounded upper back, or a lean toward the laptop.",
    "4 is a clear slouch. 1 is collapsed onto the desk.",
    "Do not give 8, 9, or 10 to someone whose head is in front of their shoulders.",
    "If no face is visible, face_visible is false, blink_count is 0, posture_score is 5, and head and shoulders are unknown.",
    "Do not identify the person.",
  ].join(" ");
}

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
  imageBase64: string,
  panelCount: number,
  durationMs: number,
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
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
          },
          { type: "text", text: contactSheetPrompt(panelCount, durationMs) },
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
    blink_count: Math.max(0, Math.min(4, Math.round(record.blink_count))),
    posture_score: Math.max(1, Math.min(10, Math.round(record.posture_score) - 3)),
    head: record.head as HeadState,
    shoulders: record.shoulders as ShoulderState,
  };
}

export function tokenCost(promptTokens: number, completionTokens: number) {
  return promptTokens * INPUT_USD_PER_TOKEN + completionTokens * OUTPUT_USD_PER_TOKEN;
}
