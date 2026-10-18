export const FRAME_W = 96;
export const FRAME_H = 72;
export const FRAME_PIXELS = FRAME_W * FRAME_H;
export const FRAME_TYPE = 1;

const MAGIC_0 = 0xa5;
const MAGIC_1 = 0x5a;

export type EspScore = {
  face: boolean;
  blinks: number;
  posture: number;
  gap: number;
  rate: number;
  head: string;
  shoulders: string;
};

export type EspLine =
  | { kind: "device"; id: string }
  | { kind: "ok" }
  | { kind: "idle" }
  | { kind: "ready" }
  | { kind: "saved" }
  | { kind: "unsaved" }
  | { kind: "note"; text: string }
  | { kind: "error"; text: string }
  | ({ kind: "score" } & EspScore)
  | { kind: "other"; text: string };

type Port = {
  open(options: { baudRate: number }): Promise<void>;
  setSignals?(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  close(): Promise<void>;
};

type Waiter = {
  kind: EspLine["kind"];
  resolve: (line: EspLine) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** CRC-16/CCITT-FALSE. The bytes "123456789" hash to 0x29B1. */
export function crc16(bytes: Uint8Array) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Largest 4:3 window, then a slight zoom toward the head. Keeps shoulders and does not stretch 16:9. */
export function cameraCrop(videoWidth: number, videoHeight: number) {
  if (videoWidth < 2 || videoHeight < 2) return null;
  const aspect = FRAME_W / FRAME_H;
  let sw: number;
  let sh: number;
  let sx: number;
  let sy: number;
  if (videoWidth / videoHeight > aspect) {
    sh = videoHeight;
    sw = sh * aspect;
    sx = (videoWidth - sw) / 2;
    sy = 0;
  } else {
    sw = videoWidth;
    sh = sw / aspect;
    sx = 0;
    sy = (videoHeight - sh) * 0.32;
  }
  const zoom = 0.82;
  const cw = sw * zoom;
  const ch = sh * zoom;
  sx += (sw - cw) / 2;
  sy += (sh - ch) * 0.2;
  return { sx: Math.max(0, sx), sy: Math.max(0, sy), sw: cw, sh: ch };
}

function eyeEnergy(gray: Uint8Array) {
  let sum = 0;
  const y0 = Math.floor(FRAME_H * 0.28);
  const y1 = Math.floor(FRAME_H * 0.52);
  const x0 = Math.floor(FRAME_W * 0.22);
  const x1 = Math.floor(FRAME_W * 0.78);
  for (let y = y0; y < y1; y++) {
    const row = y * FRAME_W;
    for (let x = x0; x < x1; x++) sum += gray[row + x];
  }
  return sum;
}

/** Two samples: the darkest eyes, then the newest frame for posture. */
export function pickSheetFrames<T extends { gray: Uint8Array }>(ring: T[]): T[] {
  if (ring.length <= 2) return ring.slice();
  let darkest = 0;
  let dark = eyeEnergy(ring[0].gray);
  for (let i = 1; i < ring.length; i++) {
    const energy = eyeEnergy(ring[i].gray);
    if (energy < dark) {
      dark = energy;
      darkest = i;
    }
  }
  const last = ring.length - 1;
  const earlier = darkest === last ? Math.max(0, last - 1) : Math.min(darkest, last);
  const later = darkest === last ? last : Math.max(darkest, last);
  return [ring[earlier], ring[later]];
}

/** One grayscale frame. Timestamp is the low 32 bits, little endian. */
export function encodeFrame(timestampMs: number, gray: Uint8Array) {
  if (gray.length !== FRAME_PIXELS) {
    throw new Error("A frame is 96 by 72 grayscale bytes.");
  }
  const payloadLen = 4 + gray.length;
  const packet = new Uint8Array(2 + 6 + payloadLen + 2);
  packet[0] = MAGIC_0;
  packet[1] = MAGIC_1;
  packet[2] = FRAME_TYPE;
  packet[3] = 0;
  packet[4] = payloadLen & 0xff;
  packet[5] = (payloadLen >>> 8) & 0xff;
  packet[6] = (payloadLen >>> 16) & 0xff;
  packet[7] = (payloadLen >>> 24) & 0xff;
  const timestamp = timestampMs >>> 0;
  packet[8] = timestamp & 0xff;
  packet[9] = (timestamp >>> 8) & 0xff;
  packet[10] = (timestamp >>> 16) & 0xff;
  packet[11] = (timestamp >>> 24) & 0xff;
  packet.set(gray, 12);
  const covered = packet.subarray(2, 12 + gray.length);
  const crc = crc16(covered);
  const end = 12 + gray.length;
  packet[end] = crc & 0xff;
  packet[end + 1] = (crc >>> 8) & 0xff;
  return packet;
}

function field(source: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${name}=([^\\s]+)`).exec(source);
  return match ? match[1] : "";
}

export function parseEspLine(line: string): EspLine {
  const text = line.trim();
  if (text === "ok") return { kind: "ok" };
  if (text === "idle") return { kind: "idle" };
  if (text === "ready") return { kind: "ready" };
  if (text === "saved") return { kind: "saved" };
  if (text === "unsaved") return { kind: "unsaved" };
  if (text.startsWith("device ")) return { kind: "device", id: text.slice("device ".length).trim() };
  if (text.startsWith("note ")) return { kind: "note", text: text.slice("note ".length).trim() };
  if (text.startsWith("error ")) return { kind: "error", text: text.slice("error ".length).trim() };
  if (text.startsWith("score ")) {
    const body = text.slice("score ".length);
    return {
      kind: "score",
      face: field(body, "face") === "1",
      blinks: Number(field(body, "blinks")),
      posture: Number(field(body, "posture")),
      gap: Number(field(body, "gap")),
      rate: Number(field(body, "rate")),
      head: field(body, "head") || "unknown",
      shoulders: field(body, "shoulders") || "unknown",
    };
  }
  return { kind: "other", text };
}

export type EspLink = {
  sendFrame: (timestampMs: number, gray: Uint8Array, whileScoring?: () => void) => Promise<void>;
  /** Tell the board the lids just opened, so its stare clock matches the laptop. */
  noteBlink: () => Promise<void>;
  /** Play the fast blink chirp. Sent at each 5 second mark of an open-eyed stare. */
  noteChirp: () => Promise<void>;
  /** Play the long sit-up honk. The board ignores one that arrives within 15 seconds of the last. */
  noteHonk: () => Promise<void>;
  close: () => Promise<void>;
};

export async function connectEsp32(
  requestPort: () => Promise<Port>,
  onLine: (line: EspLine) => void,
): Promise<EspLink> {
  const port = await requestPort();
  await port.open({ baudRate: 921600 });
  if (!port.writable || !port.readable) {
    throw new Error("The serial port did not open a data stream.");
  }

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let serialChain: Promise<void> = Promise.resolve();

  function writeExclusive(work: () => Promise<void>) {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = serialChain;
    serialChain = gate;
    return previous.then(async () => {
      try {
        await work();
      } finally {
        release();
      }
    });
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let stopped = false;
  let heardBoard = false;
  let heardResolve: (() => void) | null = null;
  let lastPacket: Uint8Array | null = null;
  let waitingForOk = false;
  let resentWhileWaiting = false;
  let idleLatched = false;
  let sheet = 0;
  let countSheetOk = true;
  const waiters: Waiter[] = [];
  const inbox: EspLine[] = [];

  function markHeard() {
    if (heardBoard) return;
    heardBoard = true;
    heardResolve?.();
    heardResolve = null;
  }

  function failWaiters(error: Error) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (!waiter) break;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  function pushLine(line: EspLine) {
    onLine(line);
    if (line.kind === "error" && (line.text === "bad frame" || line.text === "partial")) countSheetOk = false;
    if (line.kind === "ready" || line.kind === "device" || line.kind === "idle" || line.kind === "ok") markHeard();
    if (line.kind === "idle") idleLatched = true;
    if (line.kind === "ready" && waitingForOk && lastPacket && !resentWhileWaiting) {
      resentWhileWaiting = true;
      void writeExclusive(async () => {
        if (lastPacket) await writer.write(lastPacket);
      }).catch(() => {
        /* The port closed while the board was rebooting. */
      });
    }
    const index = waiters.findIndex((waiter) => waiter.kind === line.kind);
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(line);
      return;
    }
    if (line.kind === "ok") inbox.push(line);
  }

  function waitFor(kind: EspLine["kind"], ms: number) {
    const queued = inbox.findIndex((line) => line.kind === kind);
    if (queued >= 0) {
      const [line] = inbox.splice(queued, 1);
      return Promise.resolve(line);
    }
    return new Promise<EspLine>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("The ESP32 did not answer."));
      }, ms);
      waiters.push({ kind, resolve, reject, timer });
    });
  }

  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const raw = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          pushLine(parseEspLine(raw));
          newline = buffer.indexOf("\n");
        }
      }
    } catch {
      /* The port closed. */
    } finally {
      failWaiters(new Error("The ESP32 disconnected."));
    }
  })();

  function waitUntilHeard() {
    if (heardBoard) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        heardResolve = null;
        reject(new Error("The ESP32 sent nothing. Close the Arduino Serial Monitor, unplug the board, plug it back in, and choose the port that appears."));
      }, 20_000);
      heardResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  return {
    async sendFrame(timestampMs: number, gray: Uint8Array, whileScoring?: () => void) {
      await waitUntilHeard();
      idleLatched = false;
      const packet = encodeFrame(timestampMs, gray);
      lastPacket = packet;
      resentWhileWaiting = false;
      waitingForOk = true;
      const pending = waitFor("ok", 40_000);
      try {
        await writeExclusive(async () => {
          for (let offset = 0; offset < packet.length; offset += 512) {
            await writer.write(packet.subarray(offset, Math.min(packet.length, offset + 512)));
          }
        });
      } catch (cause) {
        waitingForOk = false;
        failWaiters(cause instanceof Error ? cause : new Error("Could not write to the ESP32."));
        throw cause;
      }
      try {
        await pending;
      } finally {
        waitingForOk = false;
      }
      if (countSheetOk) sheet += 1;
      else countSheetOk = true;
      if (sheet < 2) return;
      sheet = 0;
      const scoringStarted = Date.now();
      while (!idleLatched) {
        whileScoring?.();
        if (Date.now() - scoringStarted > 45_000) {
          throw new Error("The ESP32 did not answer. It started a score and never finished.");
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      idleLatched = false;
    },
    noteBlink() {
      if (stopped) return Promise.resolve();
      return writeExclusive(() => writer.write(new TextEncoder().encode("blink\n"))).then(() => undefined);
    },
    noteChirp() {
      if (stopped) return Promise.resolve();
      return writeExclusive(() => writer.write(new TextEncoder().encode("chirp\n"))).then(() => undefined);
    },
    noteHonk() {
      if (stopped) return Promise.resolve();
      return writeExclusive(() => writer.write(new TextEncoder().encode("honk\n"))).then(() => undefined);
    },
    async close() {
      stopped = true;
      failWaiters(new Error("Serial port closed."));
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      await port.close();
    },
  };
}
