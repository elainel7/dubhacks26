export const SHEET_COLS = 6;
export const SHEET_PANELS = 18;
/** Half a second of every camera frame. A blink is about 100–400ms, so it covers several panels. */
export const SHEET_MIN_SPAN_MS = 350;
export const SHEET_WINDOW_MS = 500;

const CELL_W = 192;
const CELL_H = 144;
const LABEL_H = 16;

function loadJpeg(jpegBase64: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("frame"));
    image.src = `data:image/jpeg;base64,${jpegBase64}`;
  });
}

/** One JPEG grid. Panels go left to right, then top to bottom. */
export async function renderContactSheet(frames: { jpeg: string; t: number }[]) {
  if (frames.length < 2 || typeof document === "undefined") return null;
  const startedAt = frames[0].t;
  const clipEndedAt = frames[frames.length - 1].t;
  const images = await Promise.all(frames.map((frame) => loadJpeg(frame.jpeg)));
  const rows = Math.ceil(frames.length / SHEET_COLS);
  const gridWidth = SHEET_COLS * CELL_W;
  const gridHeight = rows * (CELL_H + LABEL_H);
  const postureW = 480;
  const postureH = 360;
  const gap = 16;
  const canvas = document.createElement("canvas");
  canvas.width = gridWidth + gap + postureW;
  canvas.height = Math.max(gridHeight, postureH + LABEL_H);
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

  const postureX = gridWidth + gap;
  context.drawImage(images[images.length - 1], postureX, 0, postureW, postureH);
  context.fillStyle = "#111";
  context.fillRect(postureX, postureH, postureW, LABEL_H);
  context.fillStyle = "#fff";
  context.font = "bold 14px sans-serif";
  context.fillText("POSTURE — score only this panel", postureX + 8, postureH + LABEL_H / 2);

  const url = canvas.toDataURL("image/jpeg", 0.75);
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  return { jpegBase64: url.slice(comma + 1), startedAt, clipEndedAt };
}
