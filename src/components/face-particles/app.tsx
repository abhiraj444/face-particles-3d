import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Aperture,
  Camera,
  ChevronUp,
  Contrast,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanFace,
  Upload,
  Video,
  Wind,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { loadParams, SAMPLES, writeHash } from "@/lib/face-particles/config";
import { ParticleEngine } from "@/lib/face-particles/engine";
import {
  generateFromCanvas,
  generateFromFile,
  generateFromUrl,
  recrop,
  rebuildField,
  type PipelineCache,
} from "@/lib/face-particles/pipeline";
import { paintStudy } from "@/lib/face-particles/procedural";
import { applyDepthScale, makeCloud } from "@/lib/face-particles/sampler";
import { downloadBlob, recordTimeline } from "@/lib/face-particles/record";
import { preloadVision } from "@/lib/face-particles/vision";
import type { AnimState, EffectName, Params } from "@/lib/face-particles/types";

type Busy = { stage: string; fraction: number } | null;

export function FaceParticlesApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const cacheRef = useRef<PipelineCache | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const paramsRef = useRef<Params>(loadParams());
  const rebuildTimer = useRef<number>(0);

  const [params, setParams] = useState<Params>(paramsRef.current);
  const [hero, setHero] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [glOk, setGlOk] = useState(true);
  const [anim, setAnim] = useState<AnimState>("building");
  const [recording, setRecording] = useState<string | null>(null);
  const [hasPortrait, setHasPortrait] = useState(false);
  const [visionReady, setVisionReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ParticleEngine(canvas);
    engineRef.current = engine;
    engine.onState = setAnim;
    setGlOk(engine.supported);
    if (engine.supported) {
      engine.load(makeCloud(32000));
      engine.play("idle");
      engine.assemble = 1;
      engine.targetAssemble = 1;
      engine.start();
    }
    void (async () => {
      try {
        await preloadVision();
        setVisionReady(true);
      } catch {
        setVisionReady(false);
      }
      try {
        setBusy({ stage: "Composing a study", fraction: 0.2 });
        const study = paintStudy(0);
        const cache = await generateFromCanvas(study, paramsRef.current, (p) => setBusy(p));
        cacheRef.current = cache;
        engine.load(cache.set);
        engine.setDrawCount(paramsRef.current.particles);
        engine.setPointSize(paramsRef.current.size);
        engine.setColorMode(paramsRef.current.colorStyle ?? (paramsRef.current.color ? "color" : "mono"));
        engine.setColorMix(paramsRef.current.colorMix ?? 0.5);
        engine.setInvert(paramsRef.current.invert);
        engine.play("build");
        setHasPortrait(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the study.");
      } finally {
        setBusy(null);
      }
    })();
    return () => engine.dispose();
  }, []);

  useEffect(() => {
    paramsRef.current = params;
    writeHash(params);
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDrawCount(params.particles);
    engine.setPointSize(params.size);
    engine.setColorMode(params.colorStyle ?? (params.color ? "color" : "mono"));
    engine.setColorMix(params.colorMix ?? 0.5);
    engine.setInvert(params.invert);
  }, [params]);

  const runSource = useCallback(async (job: () => Promise<PipelineCache>, hideHero = true) => {
    setError(null);
    setBusy({ stage: "Starting", fraction: 0.02 });
    try {
      const cache = await job();
      cacheRef.current = cache;
      const engine = engineRef.current;
      if (!engine) return;
      engine.load(cache.set);
      engine.setDrawCount(paramsRef.current.particles);
      engine.setPointSize(paramsRef.current.size);
      engine.setColorMode(paramsRef.current.colorStyle ?? (paramsRef.current.color ? "color" : "mono"));
      engine.setColorMix(paramsRef.current.colorMix ?? 0.5);
      engine.setInvert(paramsRef.current.invert);
      engine.play("build");
      setHasPortrait(true);
      if (hideHero) setHero(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build this portrait.");
    } finally {
      setBusy(null);
    }
  }, []);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void runSource(() => generateFromFile(file, paramsRef.current, setBusy));
  };

  const onSample = (src: string) => {
    void runSource(() => generateFromUrl(src, paramsRef.current, setBusy));
  };

  const patch = (partial: Partial<Params>) => {
    setParams((p) => {
      const next = { ...p, ...partial };
      paramsRef.current = next;
      const engine = engineRef.current;
      const cache = cacheRef.current;
      if (!engine || !cache) return next;

      if (partial.particles != null) engine.setDrawCount(next.particles);
      if (partial.colorStyle != null) engine.setColorMode(next.colorStyle);
      else if (partial.color != null) engine.setColorMode(next.color);
      if (partial.colorMix != null) engine.setColorMix(next.colorMix);
      if (partial.invert != null) {
        engine.setInvert(next.invert);
      }
      if (partial.depth != null) {
        applyDepthScale(cache.set, next.depth);
        engine.updateHomeZ(cache.set);
      }

      const fieldKeys: (keyof Params)[] = [
        "contrast", "detail", "feature", "floor", "softness", "invert", "removeBg",
      ];
      const needsField = fieldKeys.some((k) => k in partial);
      const needsCrop = "straighten" in partial;

      if (needsCrop || needsField) {
        window.clearTimeout(rebuildTimer.current);
        rebuildTimer.current = window.setTimeout(() => {
          setBusy({ stage: "Updating the field", fraction: 0.5 });
          try {
            const set = needsCrop ? recrop(cache, paramsRef.current) : rebuildField(cache, paramsRef.current);
            engine.load(set, { scatter: false });
            engine.setDrawCount(paramsRef.current.particles);
            engine.play("assemble");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Update failed");
          } finally {
            setBusy(null);
          }
        }, 90);
      }
      return next;
    });
  };

  const play = (name: EffectName) => engineRef.current?.play(name);

  const onRecord = async () => {
    const engine = engineRef.current;
    if (!engine || recording) return;
    setRecording("Starting 30s Recording");
    setHero(false);
    setSheet(false);
    try {
      const blob = await recordTimeline(engine, 30, (label) => setRecording(label));
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      downloadBlob(blob, `face-particles-30s.${ext}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record.");
    } finally {
      setRecording(null);
    }
  };

  const onSaveStill = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const blob = await engine.snapshot();
      downloadBlob(blob, "face-particles.png");
    } catch {
      setError("Could not save a still.");
    }
  };

  return (
    <main
      className={cn(
        "relative h-dvh w-full overflow-hidden transition-colors duration-300",
        params.invert ? "bg-[#faf8f5] text-neutral-900" : "bg-bg text-fg",
      )}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none"
        aria-label="Particle portrait stage"
      />

      {!glOk && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg px-8 text-center">
          <div className="max-w-sm">
            <h1 className="font-display text-3xl">This device cannot draw particles</h1>
            <p className="mt-3 text-sm text-fg-muted">
              Face Particles needs WebGL2, which this browser does not expose.
            </p>
          </div>
        </div>
      )}

      {busy && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,env(safe-area-inset-top))] z-20 flex justify-center px-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-2.5 text-sm shadow-lg backdrop-blur-md",
              params.invert
                ? "border-neutral-300 bg-white/90 text-neutral-800"
                : "border-border bg-bg-elevated/90 text-fg-muted",
            )}
          >
            <Loader2 className="size-4 animate-spin text-accent" />
            <span>{busy.stage}</span>
            <span className="tabular-nums text-fg-subtle">{Math.round(busy.fraction * 100)}%</span>
          </div>
        </div>
      )}

      {recording && (
        <div className="pointer-events-none absolute inset-x-0 top-[max(1.25rem,env(safe-area-inset-top))] z-30 flex justify-center px-4">
          <div className="flex items-center gap-2.5 rounded-full border border-red-500/40 bg-red-950/85 px-4 py-2 text-xs font-semibold text-red-100 shadow-2xl backdrop-blur-md animate-pulse">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            <span>Recording 30s · {recording}</span>
          </div>
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto">
          <p
            className={cn(
              "font-display text-xl tracking-tight transition-colors",
              params.invert ? "text-neutral-900" : "text-fg",
            )}
          >
            Face Particles
          </p>
          <p
            className={cn(
              "text-[11px] uppercase tracking-[0.18em] transition-colors",
              params.invert ? "text-neutral-600 font-semibold" : "text-fg-subtle",
            )}
          >
            On-device
          </p>
        </div>
        <div className="pointer-events-auto flex gap-2">
          {!hero && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="New photo"
              onClick={() => setHero(true)}
              className={
                params.invert
                  ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                  : ""
              }
            >
              <ImagePlus className="size-5" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            aria-label="Save still"
            onClick={() => void onSaveStill()}
            className={
              params.invert
                ? "border-neutral-300 bg-white/85 text-neutral-900 shadow-sm hover:bg-white backdrop-blur-md"
                : ""
            }
          >
            <Download className="size-5" />
          </Button>
          <Button
            variant="primary"
            size="icon"
            aria-label="Record 30s video"
            disabled={!hasPortrait || Boolean(recording)}
            onClick={() => void onRecord()}
            className={
              params.invert ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-sm" : ""
            }
          >
            {recording ? <Loader2 className="size-5 animate-spin" /> : <Video className="size-5" />}
          </Button>
        </div>
      </header>

      {hero && (
        <section className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-16 bg-gradient-to-t from-bg via-bg/85 to-transparent">
          <div className="mx-auto max-w-md rounded-[28px] border border-border bg-bg-elevated/85 p-5">
            <h1 className="font-display text-[2rem] leading-tight tracking-tight">
              A portrait that comes apart in your hands.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">
              Photos stay on this device. Drag through the cloud, then make it yours.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button className="w-full" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                Upload
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => camRef.current?.click()}>
                <Camera className="size-4" />
                Camera
              </Button>
            </div>
            <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-fg-subtle">Try a study</p>
            <div className="mt-2 flex gap-3">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSample(s.src)}
                  className="group flex flex-1 flex-col items-center gap-1.5"
                >
                  <span className="block aspect-[3/4] w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-subtle">
                    <img
                      src={s.src}
                      alt={s.label}
                      className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    />
                  </span>
                  <span className="text-xs text-fg-muted">{s.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-[11px] text-fg-subtle">
              {visionReady ? "Vision models ready" : "Loading face analysis in the background"}
            </p>
          </div>
        </section>
      )}

      {!hero && hasPortrait && !recording && (
        <>
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex justify-center px-3 transition-opacity duration-200",
              sheet ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            <div
              className={cn(
                "pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full border p-1 shadow-lg backdrop-blur-xl transition-colors",
                params.invert
                  ? "border-neutral-300/90 bg-white/90 text-neutral-800 shadow-neutral-200/50"
                  : "border-border bg-bg-elevated/90 text-fg-muted",
              )}
            >
              {(
                [
                  ["assemble", "Assemble", ScanFace],
                  ["disassemble", "Break", Aperture],
                  ["wind", "Wind", Wind],
                  ["vortex", "Vortex", RotateCcw],
                  ["ripple", "Ripple", Contrast],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => play(id)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    params.invert
                      ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950"
                      : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
                    anim === "effect" && (params.invert ? "text-neutral-950 font-semibold" : "text-fg"),
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div
            className={cn(
              "pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex justify-center transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              sheet ? "translate-y-0" : "translate-y-[calc(100%-3rem)]",
            )}
          >
            <div
              className={cn(
                "flex w-full max-w-lg flex-col max-h-[min(70dvh,500px)] rounded-t-[28px] border shadow-2xl backdrop-blur-xl transition-colors",
                params.invert
                  ? "border-neutral-300/80 bg-white/95 text-neutral-900 shadow-neutral-900/10"
                  : "border-border bg-bg-elevated/95 text-fg",
              )}
            >
              <button
                type="button"
                className={cn(
                  "shrink-0 flex w-full flex-col items-center pb-2 pt-2.5 transition-colors border-b",
                  params.invert
                    ? "text-neutral-700 hover:text-neutral-950 border-neutral-200"
                    : "text-fg-muted hover:text-fg border-border/40",
                )}
                onClick={() => setSheet((s) => !s)}
                aria-expanded={sheet}
              >
                <span
                  className={cn(
                    "mb-1.5 h-1.5 w-12 rounded-full",
                    params.invert ? "bg-neutral-300" : "bg-border-strong",
                  )}
                />
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em]">
                  Structure
                  <ChevronUp className={cn("size-3.5 transition-transform duration-200", sheet ? "rotate-0" : "rotate-180")} />
                </span>
              </button>

              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 touch-pan-y">
                <div className="flex flex-col gap-2.5 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "text-xs font-medium uppercase tracking-[0.14em]",
                        params.invert ? "text-neutral-500" : "text-fg-subtle",
                      )}
                    >
                      Particle Palette
                    </span>
                    <div className="w-32">
                      <ToggleRow
                        label="Invert"
                        icon={<FlipHorizontal2 className="size-3.5" />}
                        checked={params.invert}
                        onCheckedChange={(v) => patch({ invert: v })}
                      />
                    </div>
                  </div>

                  <div
                    className={cn(
                      "grid grid-cols-3 gap-1 rounded-xl border p-1",
                      params.invert
                        ? "border-neutral-200 bg-neutral-100"
                        : "border-border bg-bg-subtle",
                    )}
                  >
                    {(
                      [
                        ["mono", "Mono", "B&W"],
                        ["hybrid", "Hybrid", "Color + B&W"],
                        ["color", "Color", "Full RGB"],
                      ] as const
                    ).map(([mode, label, sub]) => {
                      const currentMode = params.colorStyle ?? (params.color ? "color" : "mono");
                      const active = currentMode === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() =>
                            patch({
                              colorStyle: mode,
                              color: mode !== "mono",
                            })
                          }
                          className={cn(
                            "flex flex-col items-center justify-center rounded-lg py-1.5 px-1 text-center transition-all",
                            active
                              ? params.invert
                                ? "bg-white text-neutral-950 shadow-sm font-semibold border border-neutral-300"
                                : "bg-bg-elevated text-fg shadow-sm font-semibold border border-border/80"
                              : params.invert
                                ? "text-neutral-600 hover:bg-white/60 hover:text-neutral-900"
                                : "text-fg-muted hover:bg-bg/50 hover:text-fg",
                          )}
                        >
                          <span className="text-xs">{label}</span>
                          <span
                            className={cn(
                              "text-[10px] tracking-tight",
                              params.invert ? "text-neutral-500" : "text-fg-subtle",
                            )}
                          >
                            {sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {(params.colorStyle ?? (params.color ? "color" : "mono")) === "hybrid" && (
                    <div
                      className={cn(
                        "mt-1 rounded-xl border p-2.5",
                        params.invert
                          ? "border-neutral-200 bg-neutral-50"
                          : "border-border/60 bg-bg/60",
                      )}
                    >
                      <Field
                        label="Hybrid Color Ratio (Derived from Face)"
                        value={`${Math.round((params.colorMix ?? 0.5) * 100)}% Color · ${Math.round((1 - (params.colorMix ?? 0.5)) * 100)}% B&W`}
                      >
                        <Slider
                          min={0.1}
                          max={0.9}
                          step={0.05}
                          value={[params.colorMix ?? 0.5]}
                          onValueChange={([v]) => patch({ colorMix: v ?? 0.5 })}
                        />
                      </Field>
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          params.invert ? "text-neutral-500" : "text-fg-subtle",
                        )}
                      >
                        Interweaves photorealistic colors from the face with silver monochrome particles.
                      </p>
                    </div>
                  )}
                </div>

                <Field label="Particles" value={`${Math.round(params.particles / 1000)}k`}>
                <Slider
                  min={5000}
                  max={100000}
                  step={1000}
                  value={[params.particles]}
                  onValueChange={([v]) => patch({ particles: v ?? params.particles })}
                />
              </Field>
              <Field label="Size" value={params.size.toFixed(1)}>
                <Slider
                  min={0.8}
                  max={4}
                  step={0.1}
                  value={[params.size]}
                  onValueChange={([v]) => patch({ size: v ?? params.size })}
                />
              </Field>
              <Field label="Contrast" value={params.contrast.toFixed(2)}>
                <Slider
                  min={0.6}
                  max={2}
                  step={0.05}
                  value={[params.contrast]}
                  onValueChange={([v]) => patch({ contrast: v ?? params.contrast })}
                />
              </Field>
              <Field label="Detail" value={params.detail.toFixed(2)}>
                <Slider
                  min={0}
                  max={2}
                  step={0.05}
                  value={[params.detail]}
                  onValueChange={([v]) => patch({ detail: v ?? params.detail })}
                />
              </Field>
              <Field label="Features" value={params.feature.toFixed(2)}>
                <Slider
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={[params.feature]}
                  onValueChange={([v]) => patch({ feature: v ?? params.feature })}
                />
              </Field>
              <Field label="Shadow lift" value={params.floor.toFixed(2)}>
                <Slider
                  min={0}
                  max={0.3}
                  step={0.01}
                  value={[params.floor]}
                  onValueChange={([v]) => patch({ floor: v ?? params.floor })}
                />
              </Field>
              <Field label="Silhouette" value={params.softness.toFixed(2)}>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[params.softness]}
                  onValueChange={([v]) => patch({ softness: v ?? params.softness })}
                />
              </Field>
              <Field label="Depth" value={params.depth.toFixed(2)}>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[params.depth]}
                  onValueChange={([v]) => patch({ depth: v ?? params.depth })}
                />
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <ToggleRow
                  label="Straighten"
                  checked={params.straighten}
                  onCheckedChange={(v) => patch({ straighten: v })}
                />
                <ToggleRow
                  label="Cut background"
                  checked={params.removeBg}
                  onCheckedChange={(v) => patch({ removeBg: v })}
                />
              </div>
              </div>
            </div>
          </div>
        </>
      )}

      {recording && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex justify-center">
          <div className="rounded-full border border-border bg-bg-elevated/90 px-4 py-2 text-xs uppercase tracking-[0.18em] text-fg-muted">
            Recording · {recording}
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-x-4 top-[5.5rem] z-30 mx-auto max-w-md rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </main>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 flex items-center justify-between text-xs text-fg-muted">
        {label}
        <span className="tabular-nums text-fg-subtle">{value}</span>
      </span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <label className="flex h-11 items-center justify-between rounded-[var(--radius-md)] border border-border bg-bg px-3 text-sm">
      <span className="flex items-center gap-1.5 text-fg-muted">
        {icon}
        {label}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}
