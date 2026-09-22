import type { ParticleEngine } from "./engine";
import type { EffectName } from "./types";

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

export type RecordSequenceType = "break_reassemble" | "fill_break" | "custom";

export interface RecordOptions {
  aspect916?: boolean;
  sequence?: RecordSequenceType;
  customEffects?: EffectName[];
  durationSeconds?: number;
  forceColor?: boolean;
}

export async function recordTimeline(
  engine: ParticleEngine,
  options: RecordOptions | number = {},
  onTick?: (label: string) => void,
): Promise<Blob> {
  const opts: RecordOptions = typeof options === "number" ? { durationSeconds: options } : options;
  const aspect916 = opts.aspect916 ?? true;
  const sequence = opts.sequence ?? "break_reassemble";
  const forceColor = opts.forceColor ?? true;
  const duration = opts.durationSeconds ?? 14;

  const mime = pickMime();
  if (mime === null) throw new Error("Recording is not supported in this browser.");

  // Save previous state to restore upon completion
  const prevColorMode = engine.colorMode;
  if (forceColor) {
    engine.colorMode = 1;
  }

  // 9:16 WhatsApp Status / Reels format (1080x1920)
  if (aspect916) {
    engine.setRecordingAspect(9 / 16, 1080, 1920);
  }

  engine.lockIdleOrbit(true);

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

  recorder.start(200);

  try {
    if (sequence === "break_reassemble") {
      // Break apart and auto-reassemble, then ripple
      const partTime = Math.max(2500, Math.round((duration * 1000) / 4));

      // 1. Hold assembled portrait briefly
      onTick?.("Phase 1/4 · Portrait Hold");
      engine.play("assemble");
      await wait(partTime);

      // 2. Break apart (disassemble + auto-reassemble)
      onTick?.("Phase 2/4 · Breaking Apart");
      engine.play("disassemble");
      await wait(partTime);

      // 3. Wait for reassembly
      onTick?.("Phase 3/4 · Reassembling");
      await wait(partTime);

      // 4. Ripple effect
      onTick?.("Phase 4/4 · Ripple Wave");
      engine.play("ripple");
      await wait(partTime);
    } else if (sequence === "fill_break") {
      // Fill from top, then break apart and reassemble
      const partTime = Math.max(3000, Math.round((duration * 1000) / 4));

      // 1. Fill from top
      onTick?.("Phase 1/4 · Filling Portrait");
      engine.play("fill");
      await wait(partTime * 1.4);

      // 2. Hold assembled
      onTick?.("Phase 2/4 · Portrait Shimmer");
      await wait(partTime * 0.6);

      // 3. Break apart (auto-reassembles)
      onTick?.("Phase 3/4 · Breaking Apart");
      engine.play("disassemble");
      await wait(partTime);

      // 4. Reassembly
      onTick?.("Phase 4/4 · Coming Together");
      await wait(partTime);
    } else {
      // Custom selected effects
      const effects = opts.customEffects && opts.customEffects.length > 0
        ? opts.customEffects
        : (["disassemble", "ripple"] as EffectName[]);

      const stepMs = Math.round((duration * 1000) / effects.length);
      for (let i = 0; i < effects.length; i++) {
        const eff = effects[i]!;
        onTick?.(`Effect ${i + 1}/${effects.length} · ${eff.toUpperCase()}`);
        engine.play(eff);
        await wait(stepMs);
      }
    }
  } finally {
    recorder.stop();
    engine.lockIdleOrbit(false);
    if (aspect916) {
      engine.setRecordingAspect(null);
    }
    if (forceColor) {
      engine.colorMode = prevColorMode;
    }
    stream.getTracks().forEach((t) => t.stop());
  }

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

export function downloadText(text: string, filename: string, mimeType = "image/svg+xml"): void {
  const blob = new Blob([text], { type: mimeType });
  downloadBlob(blob, filename);
}
