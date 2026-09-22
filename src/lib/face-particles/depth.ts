import type { CropResult } from "./types";
import { IDX } from "./landmarks";
import { clamp } from "./math";

/** Mesh + ellipsoid dome. near = 1. */
export function meshDomeDepth(crop: CropResult): Float32Array {
  const { width: w, height: h, landmarks, mask, iod } = crop;
  const depth = new Float32Array(w * h);

  const cx = w * 0.5;
  let cy = h * 0.45;
  let rx = w * 0.38;
  let ry = h * 0.48;
  if (landmarks && landmarks[IDX.forehead] && landmarks[IDX.chin]) {
    const top = landmarks[IDX.forehead]!;
    const chin = landmarks[IDX.chin]!;
    // Skull crown extends naturally above the forehead landmark
    const crownY = Math.max(0.06 * h, top.y - iod * 1.35);
    cy = (chin.y + crownY) * 0.5;
    ry = Math.max((chin.y - crownY) * 0.62, h * 0.44);
    rx = Math.max(iod * 1.6, w * 0.36);
  }

  // Facial relief: nose bridge, nostril wings, lips, eye sockets.
  // Anchored to 0 at the face perimeter (forehead top, chin, jaw outline, temples)
  // so that relief + dome transitions seamlessly with ZERO steps or cliffs.
  const relief = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  let hasRelief = false;

  if (landmarks && landmarks.length > 10) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of landmarks) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const range = Math.max(1e-4, maxZ - minZ);

    // Peripheral landmarks establish the baseline face surface
    const pForehead = landmarks[IDX.forehead] ?? landmarks[10];
    const pChin = landmarks[IDX.chin] ?? landmarks[152];
    const pLeft = landmarks[234] ?? landmarks[127];
    const pRight = landmarks[454] ?? landmarks[356];

    let baseZ = maxZ;
    if (pForehead && pChin) {
      baseZ = (pForehead.z + pChin.z + (pLeft ? pLeft.z : maxZ) + (pRight ? pRight.z : maxZ)) * 0.25;
      baseZ = Math.max(baseZ, minZ + range * 0.35);
    } else {
      baseZ = minZ + range * 0.70;
    }

    const reliefRange = Math.max(1e-4, baseZ - minZ);
    const radius = Math.max(6, iod * 0.22);
    const r2 = radius * radius;

    for (const p of landmarks) {
      // Relative protrusion: Nose tip (+0.22), eye recesses (-0.05), perimeter (0.0)
      const normProtrusion = clamp((baseZ - p.z) / reliefRange, -0.35, 1.0);
      const val = normProtrusion * 0.22;

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
          const idx = y * w + x;
          relief[idx] += val * g;
          weight[idx] += g;
        }
      }
    }

    for (let i = 0; i < relief.length; i++) {
      if (weight[i] > 1e-5) relief[i] /= weight[i];
    }
    // Diffuse facial relief smoothly across cheeks, glasses, and temples
    boxBlurInPlace(relief, w, h, Math.max(4, Math.round(iod * 0.12)));
    boxBlurInPlace(weight, w, h, Math.max(6, Math.round(iod * 0.18)));
    hasRelief = true;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = nx * nx + ny * ny;
      const dist = Math.sqrt(d);
      // Smooth cosine dome: derivative is 0 at both center and outer boundary
      const dome = dist < 1.0 ? 0.5 * (1.0 + Math.cos(dist * Math.PI)) : 0.0;
      const m = mask[i] ?? 0;

      let rVal = 0;
      if (hasRelief) {
        const conf = clamp(weight[i]! * 1.2, 0, 1.0);
        rVal = relief[i]! * conf;
      }

      // Total depth = continuous skull dome + subtle facial relief.
      // At the forehead, temples, and chin, rVal is 0 so dome + 0 = dome with zero cliff!
      const blended = clamp(dome + rVal, 0.0, 1.0);
      depth[i] = blended * (0.80 + 0.20 * m);
    }
  }

  // Soft global blur to ensure 100% smooth C1 continuous surface across all angles and depth scales
  boxBlurInPlace(depth, w, h, Math.max(3, Math.round(iod * 0.06)));
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
