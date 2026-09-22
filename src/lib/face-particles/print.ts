import type { ParticleSet } from "./types";
import { createMat4, lookAt, multiply, perspective, clamp } from "./math";

export type PrintPose = "current" | "frontal" | "three_quarter_left" | "three_quarter_right" | "tilt";
export type PrintStyle = "mono" | "color" | "hybrid";

export interface PrintOptions {
  pose: PrintPose;
  style: PrintStyle;
  colorMix?: number;
  currentYaw?: number;
  currentPitch?: number;
  dpi?: number;
}

// A4 Dimensions at 300 DPI: 210mm x 297mm
export const A4_WIDTH_300DPI = 2480;
export const A4_HEIGHT_300DPI = 3508;
export const A4_ASPECT = A4_WIDTH_300DPI / A4_HEIGHT_300DPI; // ~0.706955

function getPoseAngles(pose: PrintPose, currentYaw = 0, currentPitch = 0.04): { yaw: number; pitch: number } {
  switch (pose) {
    case "frontal":
      return { yaw: 0, pitch: 0.02 };
    case "three_quarter_left":
      return { yaw: -0.32, pitch: 0.04 };
    case "three_quarter_right":
      return { yaw: 0.32, pitch: 0.04 };
    case "tilt":
      return { yaw: 0, pitch: -0.22 };
    case "current":
    default:
      return { yaw: currentYaw, pitch: currentPitch };
  }
}

interface ProjectedParticle {
  x: number;
  y: number;
  r: number;
  color: string;
  opacity: number;
}

/**
 * Projects 3D particles onto 2D A4 page coordinates with mathematical precision.
 * Centers and scales the portrait to fill 88% of the A4 page gracefully.
 */
export function projectParticlesToA4(
  set: ParticleSet,
  options: PrintOptions,
  canvasW = A4_WIDTH_300DPI,
  canvasH = A4_HEIGHT_300DPI,
): ProjectedParticle[] {
  const { yaw, pitch } = getPoseAngles(options.pose, options.currentYaw, options.currentPitch);
  const aspect = canvasW / canvasH;

  const proj = createMat4();
  const view = createMat4();
  const viewProj = createMat4();

  const baseFov = (32 * Math.PI) / 180;
  // Use vertical FOV fitted to A4 aspect
  const fov = 2 * Math.atan(Math.tan(baseFov / 2) * (0.82 / Math.max(0.45, aspect)));
  perspective(proj, fov, aspect, 0.1, 20);

  const dist = 2.45;
  const eye: [number, number, number] = [
    Math.sin(yaw) * Math.cos(pitch) * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * Math.cos(pitch) * dist,
  ];
  lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
  multiply(viewProj, proj, view);

  const m = viewProj;
  const n = set.count;
  const home = set.home;
  const tone = set.tone;
  const seed = set.seed;
  const color = set.color;

  const ndcX = new Float32Array(n);
  const ndcY = new Float32Array(n);
  const valid = new Uint8Array(n);

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;

  for (let i = 0; i < n; i++) {
    const x = home[i * 3]!;
    const y = home[i * 3 + 1]!;
    const z = home[i * 3 + 2]!;

    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;

    if (cw > 0.01) {
      const invW = 1 / cw;
      const nx = cx * invW;
      const ny = cy * invW;
      ndcX[i] = nx;
      ndcY[i] = ny;
      valid[i] = 1;

      // Filter extreme outliers from boundary hair/clouds for tight framing
      if (Math.abs(nx) < 1.4 && Math.abs(ny) < 1.6) {
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minY = Math.min(minY, ny);
        maxY = Math.max(maxY, ny);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    minX = -0.7; maxX = 0.7; minY = -0.9; maxY = 0.9;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const portraitAspect = spanX / Math.max(0.01, spanY);

  // Target portrait to fill ~88% of A4 printable area
  const marginFrac = 0.06;
  const targetAreaW = canvasW * (1 - marginFrac * 2);
  const targetAreaH = canvasH * (1 - marginFrac * 2);

  let scale: number;
  if (targetAreaW / targetAreaH > portraitAspect) {
    scale = targetAreaH / spanY;
  } else {
    scale = targetAreaW / spanX;
  }

  const centerNdcX = (minX + maxX) / 2;
  const centerNdcY = (minY + maxY) / 2;
  const pageCenterX = canvasW / 2;
  const pageCenterY = canvasH / 2;

  const out: ProjectedParticle[] = [];
  const colorMix = options.colorMix ?? 0.5;
  const style = options.style;

  // Base dot radius at 300 DPI
  const baseDotR = (canvasW / 2480) * 2.5;

  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;

    const px = pageCenterX + (ndcX[i]! - centerNdcX) * scale;
    // Flip Y because in NDC +1 is top, in canvas +1 is bottom
    const py = pageCenterY - (ndcY[i]! - centerNdcY) * scale;

    if (px < -20 || px > canvasW + 20 || py < -20 || py > canvasH + 20) continue;

    const t = tone[i]! / 255;
    const s = seed[i]!;
    const r = baseDotR * (0.75 + 0.45 * t);

    let colStr: string;
    let opacity = 0.88 + 0.12 * t;

    const cr = color[i * 3]!;
    const cg = color[i * 3 + 1]!;
    const cb = color[i * 3 + 2]!;

    // Boost print pigment contrast so light skin tones register with clarity on white paper
    const pr = clamp(Math.round(Math.pow(cr / 255, 1.25) * 0.90 * 255), 0, 255);
    const pg = clamp(Math.round(Math.pow(cg / 255, 1.25) * 0.90 * 255), 0, 255);
    const pb = clamp(Math.round(Math.pow(cb / 255, 1.25) * 0.90 * 255), 0, 255);

    if (style === "mono") {
      colStr = "#0a0a0c";
    } else if (style === "color") {
      colStr = `rgb(${pr},${pg},${pb})`;
    } else {
      // Hybrid: Interweave carbon ink and source color
      const isColor = s < colorMix;
      colStr = isColor ? `rgb(${pr},${pg},${pb})` : "#0a0a0c";
    }

    out.push({
      x: Math.round(px * 10) / 10,
      y: Math.round(py * 10) / 10,
      r: Math.round(r * 10) / 10,
      color: colStr,
      opacity: Math.round(opacity * 100) / 100,
    });
  }

  return out;
}

/**
 * Render directly mapped particles onto an ultra-high resolution 300 DPI A4 Canvas.
 */
export async function renderA4Canvas(
  set: ParticleSet,
  options: PrintOptions,
  width = A4_WIDTH_300DPI,
  height = A4_HEIGHT_300DPI,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("Could not create A4 print canvas");

  // Pure white paper background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const particles = projectParticlesToA4(set, options, width, height);

  // Group by color to minimize state changes for blazing fast rasterization of 50k+ particles
  const colorGroups = new Map<string, { x: number; y: number; r: number; opacity: number }[]>();
  for (const p of particles) {
    let group = colorGroups.get(p.color);
    if (!group) {
      group = [];
      colorGroups.set(p.color, group);
    }
    group.push(p);
  }

  for (const [color, group] of colorGroups.entries()) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const p of group) {
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  return canvas;
}

/**
 * Export mathematical vector SVG of particles on an A4 page.
 * Infinitely sharp vector circles suitable for professional vector plotters, fine-art printing, and Illustrator.
 */
export function exportA4VectorSvg(
  set: ParticleSet,
  options: PrintOptions,
  width = A4_WIDTH_300DPI,
  height = A4_HEIGHT_300DPI,
): string {
  const particles = projectParticlesToA4(set, options, width, height);

  const colorGroups = new Map<string, { x: number; y: number; r: number }[]>();
  for (const p of particles) {
    let group = colorGroups.get(p.color);
    if (!group) {
      group = [];
      colorGroups.set(p.color, group);
    }
    group.push(p);
  }

  const svgParts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="210mm" height="297mm">`,
    `  <rect width="100%" height="100%" fill="#ffffff"/>`,
  ];

  for (const [color, group] of colorGroups.entries()) {
    svgParts.push(`  <g fill="${color}">`);
    for (const p of group) {
      svgParts.push(`    <circle cx="${p.x}" cy="${p.y}" r="${p.r}"/>`);
    }
    svgParts.push(`  </g>`);
  }

  svgParts.push(`</svg>`);
  return svgParts.join("\n");
}

/**
 * Triggers native browser print dialog specifically formatted for physical A4 paper.
 */
export async function printA4Direct(canvas: HTMLCanvasElement): Promise<void> {
  const dataUrl = canvas.toDataURL("image/png");

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";

  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    window.print();
    return;
  }

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Face Particles - A4 Print</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html, body {
            margin: 0;
            padding: 0;
            width: 210mm;
            height: 297mm;
            background: #ffffff;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          img {
            width: 210mm;
            height: 297mm;
            object-fit: contain;
            display: block;
          }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" onload="window.print(); window.onafterprint = function(){ window.frameElement.remove(); };" />
      </body>
    </html>
  `);
  doc.close();
}
