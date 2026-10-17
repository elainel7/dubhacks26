declare global {
  interface Navigator {
    serial: {
      requestPort(): Promise<{
        open(options: { baudRate: number }): Promise<void>;
        readable: ReadableStream<Uint8Array> | null;
        writable: WritableStream<Uint8Array> | null;
        close(): Promise<void>;
      }>;
    };
  }
}

export type UnoLink = {
  write: (command: string) => Promise<void>;
  close: () => Promise<void>;
};

export function serialAvailable() {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function connectUno(onLine: (line: string) => void): Promise<UnoLink> {
  if (!serialAvailable()) {
    throw new Error("Web Serial is missing. Open this page in Chrome or Edge.");
  }

  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 9600 });
  if (!port.writable || !port.readable) {
    throw new Error("The serial port did not open a data stream.");
  }

  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let stopped = false;

  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onLine(trimmed);
        }
      }
    } catch {
      // The port was closed or unplugged.
    }
  })();

  return {
    write: async (command: string) => {
      await writer.write(new TextEncoder().encode(command));
    },
    close: async () => {
      stopped = true;
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
      try {
        writer.releaseLock();
      } catch {
        // already released
      }
      try {
        await port.close();
      } catch {
        // unplugged
      }
    },
  };
}
