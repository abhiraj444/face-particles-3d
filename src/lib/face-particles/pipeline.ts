import type { CropResult, Params, ParticleSet, PipelineProgress, VisionResult } from "./types";
import { loadImage, loadUrl } from "./io";
import { analyze } from "./vision";
import { headCrop } from "./crop";
import { meshDomeDepth } from "./depth";
import { buildWeights } from "./weights";
import { applyDepthScale, sample } from "./sampler";

export interface PipelineCache {
  source: HTMLCanvasElement;
  vision: VisionResult;
  crop: CropResult;
  depth: Float32Array;
  set: ParticleSet;
}

export async function generateFromFile(
  file: Blob,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Reading photo", fraction: 0.05 });
  const img = await loadImage(file);
  return generateFromCanvas(img, params, onProgress);
}

export async function generateFromUrl(
  url: string,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Loading portrait", fraction: 0.05 });
  const img = await loadUrl(url);
  return generateFromCanvas(img, params, onProgress);
}

export async function generateFromCanvas(
  img: HTMLCanvasElement,
  params: Params,
  onProgress?: (p: PipelineProgress) => void,
): Promise<PipelineCache> {
  onProgress?.({ stage: "Finding a face", fraction: 0.18 });
  const vision = await analyze(img);
  onProgress?.({ stage: "Framing the head", fraction: 0.4 });
  const crop = headCrop(img, vision, params);
  onProgress?.({ stage: "Sculpting depth", fraction: 0.55 });
  const depth = meshDomeDepth(crop);
  onProgress?.({ stage: "Laying the field", fraction: 0.72 });
  const maps = buildWeights(crop, params);
  onProgress?.({ stage: "Sampling particles", fraction: 0.88 });
  const set = sample(maps, depth, crop);
  applyDepthScale(set, params.depth);
  onProgress?.({ stage: "Ready", fraction: 1 });
  return { source: img, vision, crop, depth, set };
}

export function recrop(cache: PipelineCache, params: Params): ParticleSet {
  cache.crop = headCrop(cache.source, cache.vision, params);
  cache.depth = meshDomeDepth(cache.crop);
  return rebuildField(cache, params);
}

export function rebuildField(cache: PipelineCache, params: Params): ParticleSet {
  const maps = buildWeights(cache.crop, params);
  const set = sample(maps, cache.depth, cache.crop);
  applyDepthScale(set, params.depth);
  cache.set = set;
  return set;
}
