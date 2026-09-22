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

export type RecordSequenceType = "assemble_disassemble" | "full" | "custom";

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
  const sequence = opts.sequence ?? "assemble_disassemble";
  const forceColor = opts.forceColor ?? true;
  const duration = opts.durationSeconds ?? (sequence === "assemble_disassemble" ? 14 : 30);

  const mime = pickMime();
  if (mime === null) throw new Error("Recording is not supported in this browser.");

  // Save previous state to restore upon completion
  const prevColorMode = engine.colorMode;
  if (forceColor) {
    // 1 = Full RGB source colors
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
    if (sequence === "assemble_disassemble") {
      // Clean, elegant Assemble & Disassemble loop tailored for WhatsApp status
      const partTime = Math.max(2500, Math.round((duration * 1000) / 3));

      // 1. Assemble
      onTick?.("Phase 1/3 · Assembling Face");
      engine.play("build");
      await wait(partTime);

      // 2. Hold & Shimmer in resting face portrait
      onTick?.("Phase 2/3 · Shimmer Portrait");
      engine.play("assemble");
      await wait(partTime);

      // 3. Disassemble
      onTick?.("Phase 3/3 · Dispersing Into Space");
      engine.play("disassemble");
      await wait(partTime);
    } else if (sequence === "full") {
      // Full showcase with all 5 effects
      const rounds = duration >= 24 ? 2 : 1;
      const effectList: { name: EffectName; label: string }[] = [
        { name: "build", label: "Assemble" },
        { name: "ripple", label: "Ripple Wave" },
        { name: "wind", label: "Wind Stream" },
        { name: "vortex", label: "Vortex Spiral" },
        { name: "disassemble", label: "Particle Break" },
      ];

      const stepMs = Math.round((duration * 1000) / (rounds * effectList.length));

      for (let r = 1; r <= rounds; r++) {
        for (let i = 0; i < effectList.length; i++) {
          const eff = effectList[i]!;
          onTick?.(rounds > 1 ? `Round ${r}/${rounds} · ${eff.label} (${i + 1}/5)` : `${eff.label} (${i + 1}/5)`);
          engine.play(eff.name);
          await wait(stepMs);
        }
      }
    } else {
      // Custom selected effects
      const effects = opts.customEffects && opts.customEffects.length > 0
        ? opts.customEffects
        : (["assemble", "disassemble"] as EffectName[]);

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
