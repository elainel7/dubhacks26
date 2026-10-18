import assert from "node:assert/strict";
import test from "node:test";
import { cameraCrop, crc16, encodeFrame, FRAME_PIXELS, parseEspLine, pickSheetFrames } from "./esp32-link";

test("crc16 matches the CCITT-FALSE vector", () => {
  assert.equal(crc16(new TextEncoder().encode("123456789")), 0x29b1);
});

test("a frame packet carries the timestamp, pixels, and crc", () => {
  const gray = new Uint8Array(FRAME_PIXELS);
  gray[0] = 7;
  gray[FRAME_PIXELS - 1] = 9;
  const packet = encodeFrame(0x01020304, gray);
  assert.equal(packet.length, 2 + 6 + 4 + FRAME_PIXELS + 2);
  assert.equal(packet[0], 0xa5);
  assert.equal(packet[1], 0x5a);
  assert.equal(packet[2], 1);
  assert.equal(packet[8], 0x04);
  assert.equal(packet[9], 0x03);
  assert.equal(packet[10], 0x02);
  assert.equal(packet[11], 0x01);
  assert.equal(packet[12], 7);
  assert.equal(packet[12 + FRAME_PIXELS - 1], 9);
  const crc = packet[packet.length - 2] | (packet[packet.length - 1] << 8);
  assert.equal(crc, crc16(packet.subarray(2, packet.length - 2)));
});

test("the camera crop keeps 4:3 and stays inside the frame", () => {
  const wide = cameraCrop(1280, 720);
  assert.ok(wide);
  assert.ok(Math.abs(wide.sw / wide.sh - 160 / 120) < 0.02);
  assert.ok(wide.sx >= 0 && wide.sy >= 0);
  assert.ok(wide.sx + wide.sw <= 1280.01);
  assert.ok(wide.sy + wide.sh <= 720.01);
  assert.ok(wide.sw < 1280);
});

test("the darkest eye sample is kept for the sheet", () => {
  function frame(fill: number) {
    return { gray: new Uint8Array(FRAME_PIXELS).fill(fill) };
  }
  const ring = [frame(200), frame(200), frame(20), frame(200), frame(200), frame(180)];
  const picked = pickSheetFrames(ring);
  assert.equal(picked.length, 2);
  assert.equal(picked[0], ring[2]);
  assert.equal(picked[1], ring[ring.length - 1]);
});

test("score, device, and error lines parse", () => {
  assert.deepEqual(parseEspLine("device lamp-1\r"), { kind: "device", id: "lamp-1" });
  assert.equal(parseEspLine("ok\r").kind, "ok");
  assert.deepEqual(
    parseEspLine("score face=1 blinks=0 posture=72 gap=1.2 rate=4 head=upright shoulders=level"),
    {
      kind: "score",
      face: true,
      blinks: 0,
      posture: 72,
      gap: 1.2,
      rate: 4,
      head: "upright",
      shoulders: "level",
    },
  );
  assert.deepEqual(parseEspLine("error wifi"), { kind: "error", text: "wifi" });
  assert.deepEqual(parseEspLine("note You've been staring."), {
    kind: "note",
    text: "You've been staring.",
  });
  assert.equal(parseEspLine("ready").kind, "ready");
  assert.deepEqual(parseEspLine("looking at screen for too long!"), {
    kind: "other",
    text: "looking at screen for too long!",
  });
});
