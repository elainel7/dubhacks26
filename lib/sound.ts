import type { Buzz } from "@/vision/alerts";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tone(ctx: AudioContext, frequency: number, seconds: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.05;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  await wait(seconds * 1000);
  oscillator.stop();
  oscillator.disconnect();
  gain.disconnect();
}

/** Speaker stand-in for the Uno. The break pattern is short; the board holds the full 20 seconds. */
export async function playBuzz(ctx: AudioContext, kind: Buzz) {
  if (ctx.state === "suspended") await ctx.resume();
  if (kind === "B") {
    await tone(ctx, 880, 0.08);
    await wait(70);
    await tone(ctx, 880, 0.08);
    return;
  }
  if (kind === "P") {
    for (let i = 0; i < 3; i++) {
      await tone(ctx, 220, 0.12);
      if (i < 2) await wait(80);
    }
    return;
  }
  for (let i = 0; i < 4; i++) {
    await tone(ctx, 440, 0.16);
    if (i < 3) await wait(280);
  }
}
