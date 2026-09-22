import { useState } from "react";
import { Check, Clock, Sparkles, Smartphone, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { EffectName } from "@/lib/face-particles/types";
import type { RecordOptions, RecordSequenceType } from "@/lib/face-particles/record";

interface RecordDialogProps {
  open: boolean;
  onClose: () => void;
  onStart: (options: RecordOptions) => void;
  invert?: boolean;
}

export function RecordDialog({ open, onClose, onStart, invert }: RecordDialogProps) {
  const [sequence, setSequence] = useState<RecordSequenceType>("break_reassemble");
  const [duration, setDuration] = useState<number>(14);
  const [aspect916, setAspect916] = useState<boolean>(true);
  const [forceColor, setForceColor] = useState<boolean>(true);
  const [selectedEffects, setSelectedEffects] = useState<EffectName[]>([
    "disassemble",
    "ripple",
    "fill",
  ]);

  if (!open) return null;

  const toggleEffect = (eff: EffectName) => {
    setSelectedEffects((prev) =>
      prev.includes(eff) ? prev.filter((e) => e !== eff) : [...prev, eff],
    );
  };

  const handleStart = () => {
    onStart({
      aspect916,
      sequence,
      durationSeconds: duration,
      forceColor,
      customEffects: sequence === "custom" ? selectedEffects : undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={cn(
          "relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-[28px] border p-6 shadow-2xl transition-colors",
          invert
            ? "border-neutral-200 bg-white text-neutral-900 shadow-neutral-900/10"
            : "border-border bg-bg-elevated text-fg",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "absolute right-4 top-4 p-1.5 rounded-full transition-colors",
            invert ? "text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100" : "text-fg-subtle hover:text-fg hover:bg-bg-subtle",
          )}
          aria-label="Close dialog"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-5">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-2xl",
              invert ? "bg-neutral-900 text-white" : "bg-accent/20 text-accent",
            )}
          >
            <Video className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl leading-tight">Record Video</h2>
            <p className={cn("text-xs", invert ? "text-neutral-500" : "text-fg-subtle")}>
              High-definition status video for WhatsApp & Reels
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Format & Color Toggles */}
          <div className="grid grid-cols-1 gap-2">
            <label
              className={cn(
                "flex items-center justify-between p-3 rounded-xl border transition-colors",
                invert ? "border-neutral-200 bg-neutral-50" : "border-border/60 bg-bg/40",
              )}
            >
              <div className="flex items-center gap-2.5">
                <Smartphone className="size-4 text-emerald-500" />
                <div>
                  <div className="text-xs font-semibold">9:16 Vertical Mode</div>
                  <div className={cn("text-[11px]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                    Optimized for WhatsApp Status, Stories & Reels (1080×1920)
                  </div>
                </div>
              </div>
              <Switch checked={aspect916} onCheckedChange={setAspect916} invert={invert} />
            </label>

            <label
              className={cn(
                "flex items-center justify-between p-3 rounded-xl border transition-colors",
                invert ? "border-neutral-200 bg-neutral-50" : "border-border/60 bg-bg/40",
              )}
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="size-4 text-amber-500" />
                <div>
                  <div className="text-xs font-semibold">Full Color Particles</div>
                  <div className={cn("text-[11px]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                    Renders video with photorealistic source colors
                  </div>
                </div>
              </div>
              <Switch checked={forceColor} onCheckedChange={setForceColor} invert={invert} />
            </label>
          </div>

          {/* Animation Sequence Selection */}
          <div>
            <div className={cn("text-xs font-medium uppercase tracking-[0.12em] mb-2", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Animation Flow
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "break_reassemble",
                  label: "Break & Reform",
                  sub: "Disperse + Reassemble",
                  defDur: 14,
                },
                {
                  id: "fill_break",
                  label: "Fill & Break",
                  sub: "Rain fill + Disperse",
                  defDur: 20,
                },
                {
                  id: "custom",
                  label: "Custom Flow",
                  sub: "Choose Effects",
                  defDur: 15,
                },
              ].map((opt) => {
                const active = sequence === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setSequence(opt.id as RecordSequenceType);
                      setDuration(opt.defDur);
                    }}
                    className={cn(
                      "flex flex-col p-2.5 rounded-xl border text-left transition-all",
                      active
                        ? invert
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
                          : "border-accent bg-accent/15 text-fg font-medium"
                        : invert
                          ? "border-neutral-200 bg-white hover:border-neutral-300 text-neutral-800"
                          : "border-border/60 bg-bg/30 hover:border-border text-fg-muted",
                    )}
                  >
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span
                      className={cn(
                        "text-[10px] mt-0.5",
                        active ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle",
                      )}
                    >
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Effects Multi-Select (if Custom selected) */}
          {sequence === "custom" && (
            <div
              className={cn(
                "p-3 rounded-xl border animate-in fade-in",
                invert ? "border-neutral-200 bg-neutral-50" : "border-border/60 bg-bg/40",
              )}
            >
              <div className={cn("text-[11px] font-medium uppercase tracking-[0.1em] mb-2", invert ? "text-neutral-600" : "text-fg-muted")}>
                Select Effects to Chain
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["disassemble", "ripple", "fill"] as EffectName[]).map((eff) => {
                  const sel = selectedEffects.includes(eff);
                  const labels: Record<string, string> = {
                    disassemble: "Break",
                    ripple: "Ripple",
                    fill: "Fill",
                  };
                  return (
                    <button
                      key={eff}
                      type="button"
                      onClick={() => toggleEffect(eff)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors border",
                        sel
                          ? invert
                            ? "bg-neutral-900 text-white border-neutral-900 font-medium"
                            : "bg-fg text-bg border-fg font-medium"
                          : invert
                            ? "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300"
                            : "bg-bg-subtle text-fg-muted border-border hover:border-border-strong",
                      )}
                    >
                      {sel && <Check className="size-3" />}
                      <span>{labels[eff] ?? eff}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Duration Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={cn("text-xs font-medium uppercase tracking-[0.12em]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                Video Duration
              </span>
              <span className={cn("text-xs font-semibold tabular-nums flex items-center gap-1", invert ? "text-neutral-700" : "text-fg")}>
                <Clock className="size-3.5" />
                {duration}s
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[12, 16, 24, 30].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDuration(s)}
                  className={cn(
                    "py-1.5 rounded-lg border text-xs font-semibold transition-all",
                    duration === s
                      ? invert
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-accent bg-accent/20 text-fg"
                      : invert
                        ? "border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-700"
                        : "border-border/60 bg-bg/40 hover:bg-bg text-fg-muted",
                  )}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Start CTA */}
        <div className="mt-6 flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className={cn(
              "flex-[2]",
              invert ? "bg-neutral-900 text-white hover:bg-neutral-800" : "",
            )}
            onClick={handleStart}
          >
            <Video className="size-4 mr-1.5" />
            Start {aspect916 ? "9:16 " : ""}Recording ({duration}s)
          </Button>
        </div>
      </div>
    </div>
  );
}
