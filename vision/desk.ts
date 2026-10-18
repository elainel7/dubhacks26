import type { HeadState, ShoulderState } from "./alerts";

export const INPUT_USD_PER_TOKEN = 0.15 / 1_000_000;
export const OUTPUT_USD_PER_TOKEN = 1.5 / 1_000_000;
export const SPEND_CAP_USD = 3;

export type DeskScore = {
  face_visible: boolean;
  blink_count: number;
  eyes_closed: boolean;
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
    "blink_count is how many times the eyelids close in the small panels, read left to right.",
    "A blink is the change from pupils visible to lids covering the pupils.",
    "Count that close even when the eyes stay shut through the end of the sheet.",
    "If the eyes are shut in every small panel, blink_count is 0 and eyes_closed is true.",
    "A held close is still a blink. It is not one blink per panel, and it does not end until the eyes open.",
    "eyes_closed is true when the lids cover the pupils in the last small panel, and false when the pupils are visible there.",
    "Eyes that are already shut in the first panel and then open are not an extra blink.",
    "Several shut panels after one close are one blink, not one blink per panel.",
    "The person may wear glasses. A bright reflection is not an open eye.",
    "Looking down with the pupils still visible is not a blink. Lids covering the pupils is a blink even if the chin drops.",
    "The small panels are only for blinks.",
    "posture_score is an integer from 1 to 100 for the large panel labeled POSTURE. Ignore the small panels for this score.",
    "1 is the worst posture and 100 is the best. Use the whole range.",
    "90 to 100: ear is directly over the shoulder, chin is back, chest is open.",
    "70 to 85: upright, with only a small forward drift of the head.",
    "50 to 65: head is clearly in front of the shoulders, or the upper back is rounded.",
    "25 to 45: a real slouch, face much closer to the camera than the chest.",
    "1 to 20: collapsed toward the desk.",
    "A slouch and sitting up must differ by at least 25 points. Do not reuse one number for every sheet.",
    "If no face is visible, face_visible is false, blink_count is 0, eyes_closed is false, posture_score is 50, and head and shoulders are unknown.",
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
      eyes_closed: { type: "boolean" },
      posture_score: { type: "integer" },
      head: { type: "string", enum: [...HEADS] },
      shoulders: { type: "string", enum: [...SHOULDERS] },
    },
    required: ["face_visible", "blink_count", "eyes_closed", "posture_score", "head", "shoulders"],
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
    eyes_closed: record.eyes_closed === true,
    posture_score: postureOutOf100(record.posture_score),
    head: record.head as HeadState,
    shoulders: record.shoulders as ShoulderState,
  };
}

/** The model is asked for 1–100. Clamp that range. A low score stays low. */
export function postureOutOf100(raw: number) {
  return Math.max(1, Math.min(100, Math.round(raw)));
}

export function tokenCost(promptTokens: number, completionTokens: number) {
  return promptTokens * INPUT_USD_PER_TOKEN + completionTokens * OUTPUT_USD_PER_TOKEN;
}
