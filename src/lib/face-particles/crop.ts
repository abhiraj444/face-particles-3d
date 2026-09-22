import type { CropResult, Landmark, Params, VisionResult } from "./types";
import { workingSize } from "./config";
import { IDX } from "./landmarks";
import { clamp } from "./math";

const CLASS_HAIR = 1;
const CLASS_BODY = 2;
const CLASS_FACE = 3;

function sampleClass(
  classes: Uint8Array | null,
  classW: number,
  classH: number,
  u: number,
  v: number,
): number {
  if (!classes || classW <= 0 || classH <= 0) return 0;
  const x = clamp(Math.floor(u * classW), 0, classW - 1);
  const y = clamp(Math.floor(v * classH), 0, classH - 1);
  return classes[y * classW + x] ?? 0;
}

function headBounds(vision: VisionResult, srcW: number, srcH: number, chinLimitY?: number) {
  let minX = srcW, minY = srcH, maxX = 0, maxY = 0;
  let found = false;
  if (vision.classes && vision.classW > 0) {
    const { classW, classH, classes } = vision;
    if (!classes) return null;
    const maxNeckY = chinLimitY ? (chinLimitY / srcH) * classH : classH;
    for (let y = 0; y < classH; y++) {
      for (let x = 0; x < classW; x++) {
        const c = classes[y * classW + x] ?? 0;
        const isHairOrFace = c === CLASS_HAIR || c === CLASS_FACE;
        const isNeckSlice = c === CLASS_BODY && y <= maxNeckY;
        if (isHairOrFace || isNeckSlice) {
          const px = (x / classW) * srcW;
          const py = (y / classH) * srcH;
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
          found = true;
        }
      }
    }
  }
  if (!found && vision.landmarks && vision.landmarks.length) {
    for (const p of vision.landmarks) {
      minX = Math.min(minX, p.x * srcW);
      minY = Math.min(minY, p.y * srcH);
      maxX = Math.max(maxX, p.x * srcW);
      maxY = Math.max(maxY, p.y * srcH);
    }
    found = true;
  }
  if (!found) return null;
  return { minX, minY, maxX, maxY };
}

export function headCrop(
  source: HTMLCanvasElement,
  vision: VisionResult,
  params: Pick<Params, "straighten">,
): CropResult {
  const { w: outW, h: outH } = workingSize();
  const srcW = source.width;
  const srcH = source.height;
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create crop canvas.");

  let angle = 0;
  let iod = Math.min(srcW, srcH) * 0.18;
  let faceCx = srcW * 0.5;
  let faceCy = srcH * 0.42;

  const lm = vision.landmarks;
  let chinY = srcH * 0.72;
  if (lm && lm.length > IDX.leftEyeOuter) {
    const r = lm[IDX.rightEyeOuter]!;
    const l = lm[IDX.leftEyeOuter]!;
    const dx = (l.x - r.x) * srcW;
    const dy = (l.y - r.y) * srcH;
    iod = Math.hypot(dx, dy) || iod;
    if (params.straighten) angle = Math.atan2(dy, dx);
    const nose = lm[IDX.noseTip];
    const eyeMidX = ((r.x + l.x) / 2) * srcW;
    const eyeMidY = ((r.y + l.y) / 2) * srcH;
    faceCx = eyeMidX;
    faceCy = nose ? (nose.y * srcH + eyeMidY) * 0.5 : eyeMidY + iod * 0.35;
    if (lm[IDX.chin]) {
      chinY = lm[IDX.chin]!.y * srcH;
    }
  }

  const bounds = headBounds(vision, srcW, srcH, chinY + srcH * 0.15);
  let bw: number;
  let bh: number;
  let bx: number;
  let by: number;
  if (bounds) {
    const pad = 0.22;
    bw = (bounds.maxX - bounds.minX) * (1 + pad * 2);
    bh = (bounds.maxY - bounds.minY) * (1 + pad * 2);
    bx = (bounds.minX + bounds.maxX) / 2;
    by = (bounds.minY + bounds.maxY) / 2;
  } else {
    const side = Math.min(srcW, srcH) * 0.78;
    bw = side;
    bh = side * (4 / 3);
    bx = srcW / 2;
    by = srcH / 2;
  }

  const targetAspect = outW / outH;
  let cropW = bw;
  let cropH = bh;
  if (cropW / cropH > targetAspect) cropH = cropW / targetAspect;
  else cropW = cropH * targetAspect;

  // Center face coordinate at 50% width and 50% height for a perfectly centered 3D portrait
  if (lm && lm.length > IDX.leftEyeOuter) {
    bx = faceCx;
    by = faceCy;
  }

  ctx.save();
  ctx.fillStyle = "#050506";
  ctx.fillRect(0, 0, outW, outH);
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(-angle);
  ctx.scale(outW / cropW, outH / cropH);
  ctx.translate(-bx, -by);
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, outW, outH);
  const mask = new Float32Array(outW * outH);
  const hairSkin = new Float32Array(outW * outH);
  const faceSkin = new Float32Array(outW * outH);

  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const sx = outW / cropW;
  const sy = outH / cropH;

  const mapSrcToCrop = (srcX: number, srcY: number) => {
    const dx = srcX - bx;
    const dy = srcY - by;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: rx * sx + outW / 2, y: ry * sy + outH / 2 };
  };

  let chinCropY = outH * 0.72;
  if (lm && lm[IDX.chin]) {
    const p = mapSrcToCrop(lm[IDX.chin]!.x * srcW, lm[IDX.chin]!.y * srcH);
    chinCropY = p.y;
  }

  if (vision.classes && vision.classW > 0) {
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const lx = (x - outW / 2) / sx;
        const ly = (y - outH / 2) / sy;
        const srcX = lx * Math.cos(angle) - ly * Math.sin(angle) + bx;
        const srcY = lx * Math.sin(angle) + ly * Math.cos(angle) + by;
        const u = srcX / srcW;
        const v = srcY / srcH;
        const c =
          u < 0 || v < 0 || u > 1 || v > 1
            ? 0
            : sampleClass(vision.classes, vision.classW, vision.classH, u, v);
        const i = y * outW + x;
        const isHair = c === CLASS_HAIR;
        const isFace = c === CLASS_FACE;
        const isBody = c === CLASS_BODY;
        const neck = isBody && y > chinCropY - 8 && y < chinCropY + outH * 0.16;
        hairSkin[i] = isHair || isFace || neck ? 1 : 0;
        faceSkin[i] = isFace ? 1 : 0;
        mask[i] = isHair || isFace ? 1 : neck ? clamp(1 - (y - chinCropY) / (outH * 0.14), 0, 1) : 0;
      }
    }
  } else {
    const cx = outW * 0.5;
    const cy = outH * 0.44;
    const rx = outW * 0.36;
    const ry = outH * 0.42;
    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d = nx * nx + ny * ny;
        const m = d < 1 ? clamp(1 - (d - 0.72) / 0.28, 0, 1) : 0;
        const i = y * outW + x;
        mask[i] = m;
        hairSkin[i] = m > 0.2 ? 1 : 0;
        faceSkin[i] = ny > -0.15 && d < 0.72 ? m : 0;
      }
    }
  }

  let landmarks: Landmark[] | null = null;
  if (lm) {
    landmarks = lm.map((p) => {
      const mapped = mapSrcToCrop(p.x * srcW, p.y * srcH);
      return { x: mapped.x, y: mapped.y, z: p.z };
    });
    if (landmarks[IDX.leftEyeOuter] && landmarks[IDX.rightEyeOuter]) {
      const a = landmarks[IDX.rightEyeOuter]!;
      const b = landmarks[IDX.leftEyeOuter]!;
      iod = Math.hypot(b.x - a.x, b.y - a.y) || iod * (outW / cropW);
    }
  }

  return {
    canvas,
    imageData,
    width: outW,
    height: outH,
    landmarks,
    mask,
    hairSkin,
    faceSkin,
    iod,
    hasFace: Boolean(landmarks),
  };
}
