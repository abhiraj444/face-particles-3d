import type { ParticleEngine } from "./engine";

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function recordTimeline(
  engine: ParticleEngine,
  seconds = 30,
  onTick?: (label: string) => void,
): Promise<Blob> {
  const mime = pickMime();
  if (mime === null) throw new Error("Recording is not supported in this browser.");
  const stream = engine.getCanvasStream(30);
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Recorder failed"));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
  });

  engine.lockIdleOrbit(true);
  recorder.start(200);

  // --- ROUND 1 (15 Seconds) ---
  // 1. Assemble / Build (3.0s)
  onTick?.("Round 1/2 · Assemble (1/5)");
  engine.play("build");
  await wait(3000);

  // 2. Ripple (3.0s)
  onTick?.("Round 1/2 · Ripple Wave (2/5)");
  engine.play("ripple");
  await wait(3000);

  // 3. Wind (3.0s)
  onTick?.("Round 1/2 · Wind Stream (3/5)");
  engine.play("wind");
  await wait(3000);

  // 4. Vortex (3.0s)
  onTick?.("Round 1/2 · Vortex Spiral (4/5)");
  engine.play("vortex");
  await wait(3000);

  // 5. Break / Disassemble (3.0s)
  onTick?.("Round 1/2 · Particle Break (5/5)");
  engine.play("disassemble");
  await wait(3000);

  // --- ROUND 2 (15 Seconds) ---
  // 6. Re-assemble (3.0s)
  onTick?.("Round 2/2 · Assemble Face (1/5)");
  engine.play("assemble");
  await wait(3000);

  // 7. Ripple (3.0s)
  onTick?.("Round 2/2 · Contour Ripple (2/5)");
  engine.play("ripple");
  await wait(3000);

  // 8. Wind (3.0s)
  onTick?.("Round 2/2 · Cosmic Wind (3/5)");
  engine.play("wind");
  await wait(3000);

  // 9. Vortex (3.0s)
  onTick?.("Round 2/2 · Galactic Vortex (4/5)");
  engine.play("vortex");
  await wait(3000);

  // 10. Break & Grand Finale (3.0s)
  onTick?.("Round 2/2 · Grand Finale (5/5)");
  engine.play("disassemble");
  await wait(1600);
  engine.play("assemble");
  await wait(1400);

  recorder.stop();
  engine.lockIdleOrbit(false);
  stream.getTracks().forEach((t) => t.stop());
  return done;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
