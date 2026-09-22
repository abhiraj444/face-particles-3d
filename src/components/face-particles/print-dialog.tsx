import { useState } from "react";
import {
  Compass,
  Download,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Palette,
  Printer,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ParticleSet } from "@/lib/face-particles/types";
import {
  exportA4VectorSvg,
  printA4Direct,
  renderA4Canvas,
  type PrintPose,
  type PrintStyle,
} from "@/lib/face-particles/print";
import { downloadBlob, downloadText } from "@/lib/face-particles/record";

interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  particleSet: ParticleSet | null;
  currentYaw: number;
  currentPitch: number;
  invert?: boolean;
}

export function PrintDialog({
  open,
  onClose,
  particleSet,
  currentYaw,
  currentPitch,
  invert,
}: PrintDialogProps) {
  const [pose, setPose] = useState<PrintPose>("current");
  const [style, setStyle] = useState<PrintStyle>("mono");
  const [busy, setBusy] = useState<string | null>(null);

  if (!open) return null;

  const handlePrintDirect = async () => {
    if (!particleSet) return;
    setBusy("Preparing A4 Print Document...");
    try {
      const canvas = await renderA4Canvas(particleSet, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      await printA4Direct(canvas);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadPng = async () => {
    if (!particleSet) return;
    setBusy("Rendering 300 DPI A4 Image (2480×3508)...");
    try {
      const canvas = await renderA4Canvas(particleSet, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob failed"))), "image/png");
      });
      const filename = `face-particles-a4-${style}-${pose}.png`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadSvg = () => {
    if (!particleSet) return;
    setBusy("Generating Vector SVG...");
    try {
      const svg = exportA4VectorSvg(particleSet, {
        pose,
        style,
        currentYaw,
        currentPitch,
      });
      const filename = `face-particles-vector-${style}-${pose}.svg`;
      downloadText(svg, filename, "image/svg+xml");
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={cn(
          "relative w-full max-w-lg rounded-[28px] border p-6 shadow-2xl transition-colors",
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
            <Printer className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl leading-tight">A4 Print & Vector Studio</h2>
            <p className={cn("text-xs", invert ? "text-neutral-500" : "text-fg-subtle")}>
              Direct particle mapping formatted to fill full A4 sheet (300 DPI & Vector)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Pose Selector */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Compass className="size-3.5 text-blue-500" />
              <span className={cn("text-xs font-medium uppercase tracking-[0.12em]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                Select Portrait Pose
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { id: "current", label: "Current Live Pose", sub: "Exact angle on screen" },
                { id: "frontal", label: "Frontal", sub: "Straight on symmetric" },
                { id: "three_quarter_left", label: "3/4 Turn Left", sub: "Classic fine-art profile" },
                { id: "three_quarter_right", label: "3/4 Turn Right", sub: "Dynamic right angle" },
                { id: "tilt", label: "Heroic Tilt", sub: "Upward perspective" },
              ].map((p) => {
                const active = pose === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPose(p.id as PrintPose)}
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
                    <span className="text-xs font-semibold">{p.label}</span>
                    <span
                      className={cn(
                        "text-[10px] mt-0.5",
                        active ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle",
                      )}
                    >
                      {p.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Palette Selector */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Palette className="size-3.5 text-purple-500" />
              <span className={cn("text-xs font-medium uppercase tracking-[0.12em]", invert ? "text-neutral-500" : "text-fg-subtle")}>
                Ink & Color Style
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "mono",
                  label: "Carbon Black",
                  sub: "Pure India ink stipple on white",
                },
                {
                  id: "color",
                  label: "Full Color",
                  sub: "Vibrant source photo pigments",
                },
                {
                  id: "hybrid",
                  label: "Hybrid Mix",
                  sub: "Color accents + carbon ink",
                },
              ].map((st) => {
                const active = style === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStyle(st.id as PrintStyle)}
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
                    <span className="text-xs font-semibold">{st.label}</span>
                    <span
                      className={cn(
                        "text-[10px] mt-0.5",
                        active ? (invert ? "text-neutral-300" : "text-fg-muted") : "text-fg-subtle",
                      )}
                    >
                      {st.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Print Fidelity Note */}
          <div
            className={cn(
              "flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed",
              invert ? "border-neutral-200 bg-neutral-50 text-neutral-600" : "border-border/60 bg-bg/40 text-fg-muted",
            )}
          >
            <Sparkles className="size-4 shrink-0 text-amber-500 mt-0.5" />
            <div>
              <strong className={invert ? "text-neutral-900" : "text-fg"}>Direct Vector/Mathematical Mapping: </strong>
              Each particle coordinate is computed directly on the A4 page at 300 DPI ($2480 \times 3508$ px), giving microscope-sharp ink dots with zero pixelation or blurry edges.
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={Boolean(busy)}
            onClick={() => void handleDownloadSvg()}
          >
            <FileCode2 className="size-4 mr-1.5" />
            Vector SVG
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={Boolean(busy)}
            onClick={() => void handleDownloadPng()}
          >
            <ImageIcon className="size-4 mr-1.5" />
            300 DPI PNG
          </Button>
          <Button
            variant="primary"
            className={cn(
              "flex-[1.4]",
              invert ? "bg-neutral-900 text-white hover:bg-neutral-800" : "",
            )}
            disabled={Boolean(busy)}
            onClick={() => void handlePrintDirect()}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" />
                Processing...
              </>
            ) : (
              <>
                <Printer className="size-4 mr-1.5" />
                Print A4
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
