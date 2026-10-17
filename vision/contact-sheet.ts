export const SHEET_COLS = 4;
export const SHEET_ROWS = 2;
export const SHEET_PANELS = SHEET_COLS * SHEET_ROWS;
export const SHEET_EVERY_MS = 8_000;
export const SHEET_MIN_SPAN_MS = 7_000;

const CELL_W = 160;
const CELL_H = 120;
const LABEL_H = 16;

function loadJpeg(jpegBase64: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("frame"));
    image.src = `data:image/jpeg;base64,${jpegBase64}`;
  });
}

/** One JPEG grid. Eight panels, left to right, top to bottom. */
export async function renderContactSheet(frames: { jpeg: string; t: number }[]) {
  if (frames.length < 2 || typeof document === "undefined") return null;
  const startedAt = frames[0].t;
  const clipEndedAt = frames[frames.length - 1].t;
  const images = await Promise.all(frames.map((frame) => loadJpeg(frame.jpeg)));
  const canvas = document.createElement("canvas");
  canvas.width = SHEET_COLS * CELL_W;
  canvas.height = SHEET_ROWS * (CELL_H + LABEL_H);
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#111";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "12px sans-serif";
  context.textBaseline = "middle";

  frames.forEach((frame, index) => {
    const column = index % SHEET_COLS;
    const row = Math.floor(index / SHEET_COLS);
    const x = column * CELL_W;
    const y = row * (CELL_H + LABEL_H);
    context.drawImage(images[index], x, y, CELL_W, CELL_H);
    context.fillStyle = "#111";
    context.fillRect(x, y + CELL_H, CELL_W, LABEL_H);
    context.fillStyle = "#fff";
    const seconds = ((frame.t - startedAt) / 1000).toFixed(1);
    context.fillText(`${seconds}s`, x + 4, y + CELL_H + LABEL_H / 2);
  });

  const url = canvas.toDataURL("image/jpeg", 0.6);
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  return { jpegBase64: url.slice(comma + 1), startedAt, clipEndedAt };
}
