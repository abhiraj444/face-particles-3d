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
  seconds = 8,
  onTick?: (label: string) => void,
): Promise<Blob> {
  const mime = pickMime();
  if (mime === null) throw new Error("Recording is not supported in this browser.");
  const stream = engine.getCanvasStream(30);
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
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
  onTick?.("Assemble");
  engine.play("build");
  await wait(1800);
  onTick?.("Hold");
  await wait(1400);
  onTick?.("Sweep");
  engine.play("wind");
  await wait(1600);
  onTick?.("Scatter");
  engine.play("disassemble");
  await wait(1400);
  onTick?.("Return");
  engine.play("assemble");
  await wait(Math.max(400, seconds * 1000 - 1800 - 1400 - 1600 - 1400));
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
