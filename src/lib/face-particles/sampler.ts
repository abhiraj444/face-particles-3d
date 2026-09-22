import type { CropResult, ParticleSet } from "./types";
import type { WeightMaps } from "./weights";
import { N_MAX } from "./config";
import { blueAt, getBlueNoise } from "./blue-noise";
import { hash21 } from "./math";

export function sample(
  maps: WeightMaps,
  depth: Float32Array,
  crop: CropResult,
  nMax = N_MAX,
): ParticleSet {
  const { width: w, height: h, weight, tone } = maps;
  const noise = getBlueNoise();
  const nPix = w * h;
  const keys = new Uint16Array(nPix);
  const index = new Uint32Array(nPix);
  let n = 0;
  for (let i = 0; i < nPix; i++) {
    const wv = weight[i]!;
    if (wv < 0.001) continue;
    const x = i % w;
    const y = (i / w) | 0;
    const t = blueAt(noise, x, y);
    const r = Math.min(1, t / wv);
    keys[n] = (r * 65535) | 0;
    index[n] = i;
    n++;
  }

  const counts = new Uint32Array(65536);
  for (let i = 0; i < n; i++) counts[keys[i]!]++;
  let sum = 0;
  for (let i = 0; i < 65536; i++) {
    const c = counts[i]!;
    counts[i] = sum;
    sum += c;
  }
  const sorted = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const k = keys[i]!;
    sorted[counts[k]!] = index[i]!;
    counts[k]++;
  }

  const count = Math.min(nMax, n);
  const home = new Float32Array(count * 3);
  const restZ = new Float32Array(count);
  const toneOut = new Uint8Array(count);
  const seed = new Float32Array(count);
  const color = new Uint8Array(count * 3);
  const px = crop.imageData.data;
  const aspect = h / w;

  for (let i = 0; i < count; i++) {
    const pi = sorted[i]!;
    const x = pi % w;
    const y = (pi / w) | 0;
    const jx = hash21(x + 0.3, y + 1.7) - 0.5;
    const jy = hash21(x + 9.1, y + 4.2) - 0.5;
    const wx = ((x + jx + 0.5) / w) * 2 - 1;
    const wy = -(((y + jy + 0.5) / h) * 2 - 1) * aspect;
    const z01 = depth[pi] ?? 0;
    home[i * 3] = wx;
    home[i * 3 + 1] = wy;
    home[i * 3 + 2] = (z01 - 0.35) * 0.85;
    restZ[i] = home[i * 3 + 2]!;
    toneOut[i] = clampByte((tone[pi] ?? 0) * 255);
    seed[i] = hash21(x + 21.3, y + 8.9);
    const p = pi * 4;
    color[i * 3] = px[p]!;
    color[i * 3 + 1] = px[p + 1]!;
    color[i * 3 + 2] = px[p + 2]!;
  }

  return { count, home, restZ, tone: toneOut, seed, color };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function makeCloud(count = 40_000): ParticleSet {
  const home = new Float32Array(count * 3);
  const restZ = new Float32Array(count);
  const tone = new Uint8Array(count);
  const seed = new Float32Array(count);
  const color = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = hash21(i, 1.2);
    const v = hash21(i, 7.7);
    const w = hash21(i, 13.9);
    const theta = u * Math.PI * 2;
    const r = Math.sqrt(v) * 1.15;
    home[i * 3] = Math.cos(theta) * r;
    home[i * 3 + 1] = (w - 0.5) * 2.2;
    home[i * 3 + 2] = Math.sin(theta) * r * 0.4;
    restZ[i] = home[i * 3 + 2]!;
    tone[i] = 90 + ((hash21(i, 3.3) * 140) | 0);
    seed[i] = hash21(i, 19.1);
    const g = tone[i]!;
    color[i * 3] = g;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = g;
  }
  return { count, home, restZ, tone, seed, color };
}

export function applyDepthScale(set: ParticleSet, depth: number): void {
  const s = 0.35 + depth * 1.4;
  for (let i = 0; i < set.count; i++) {
    set.home[i * 3 + 2] = set.restZ[i]! * s;
  }
}
