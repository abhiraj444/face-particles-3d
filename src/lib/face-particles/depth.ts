import type { CropResult } from "./types";
import { IDX } from "./landmarks";
import { clamp } from "./math";

/** Mesh + ellipsoid dome. near = 1. */
export function meshDomeDepth(crop: CropResult): Float32Array {
  const { width: w, height: h, landmarks, mask, iod } = crop;
  const depth = new Float32Array(w * h);
  const mesh = new Float32Array(w * h);
  const weight = new Float32Array(w * h);

  const cx = w * 0.5;
  let cy = h * 0.45;
  let rx = w * 0.38;
  let ry = h * 0.42;
  if (landmarks && landmarks[IDX.forehead] && landmarks[IDX.chin]) {
    const top = landmarks[IDX.forehead]!;
    const chin = landmarks[IDX.chin]!;
    cy = (top.y + chin.y) * 0.5;
    ry = Math.abs(chin.y - top.y) * 0.72;
    rx = Math.max(iod * 1.35, w * 0.28);
  }

  const radius = Math.max(6, iod * 0.22);
  const r2 = radius * radius;
  if (landmarks && landmarks.length > 10) {
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of landmarks) {
      zMin = Math.min(zMin, p.z);
      zMax = Math.max(zMax, p.z);
    }
    const zRange = Math.max(1e-4, zMax - zMin);
    for (const p of landmarks) {
      // Smaller MediaPipe z is closer → higher depth.
      const z01 = clamp(1 - (p.z - zMin) / zRange, 0, 1);
      const x0 = p.x | 0;
      const y0 = p.y | 0;
      const rad = radius | 0;
      for (let y = y0 - rad; y <= y0 + rad; y++) {
        if (y < 0 || y >= h) continue;
        for (let x = x0 - rad; x <= x0 + rad; x++) {
          if (x < 0 || x >= w) continue;
          const dx = x - p.x;
          const dy = y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          const g = Math.exp(-d2 / (r2 * 0.45));
          const i = y * w + x;
          mesh[i] += z01 * g;
          weight[i] += g;
        }
      }
    }
    for (let i = 0; i < mesh.length; i++) {
      if (weight[i] > 1e-5) mesh[i] /= weight[i];
    }
    // Diffuse the splat so cheeks fill in.
    boxBlurInPlace(mesh, w, h, Math.max(2, Math.round(iod * 0.06)));
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      const dome = d < 1 ? Math.sqrt(Math.max(0, 1 - d)) : 0;
      const m = mask[i] ?? 0;
      const meshV = mesh[i];
      const hasMesh = meshV > 0.01;
      const seam = hasMesh ? 0.72 : 0;
      const blended = meshV * seam + dome * (1 - seam);
      depth[i] = blended * (0.35 + 0.65 * m);
    }
  }
  return depth;
}

function boxBlurInPlace(buf: Float32Array, w: number, h: number, radius: number): void {
  if (radius < 1) return;
  const tmp = new Float32Array(buf.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const x = clamp(k, 0, w - 1);
      acc += buf[y * w + x]!;
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      const leave = clamp(x - radius, 0, w - 1);
      const enter = clamp(x + radius + 1, 0, w - 1);
      acc += buf[y * w + enter]! - buf[y * w + leave]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const y = clamp(k, 0, h - 1);
      acc += tmp[y * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      buf[y * w + x] = acc / span;
      const leave = clamp(y - radius, 0, h - 1);
      const enter = clamp(y + radius + 1, 0, h - 1);
      acc += tmp[enter * w + x]! - tmp[leave * w + x]!;
    }
  }
}
