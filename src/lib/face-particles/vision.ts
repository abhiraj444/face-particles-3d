import {
  FaceLandmarker,
  FilesetResolver,
  ImageSegmenter,
} from "@mediapipe/tasks-vision";
import type { Landmark, VisionResult } from "./types";

const LOCAL_WASM_PATH = "/mediapipe/wasm";
const CDN_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

const LOCAL_LANDMARKER_MODEL = "/mediapipe/models/face_landmarker.task";
const CDN_LANDMARKER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const LOCAL_SEGMENTER_MODEL = "/mediapipe/models/selfie_multiclass_256x256.tflite";
const CDN_SEGMENTER_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

let wasmFilesetPromise: Promise<unknown> | null = null;
let landmarkerPromise: Promise<FaceLandmarker | null> | null = null;
let segmenterPromise: Promise<ImageSegmenter | null> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Get the FaceLandmarker class reference so landmarks.ts can access static connection tables */
export function getFaceLandmarkerClass(): typeof FaceLandmarker | null {
  return typeof FaceLandmarker !== "undefined" ? FaceLandmarker : null;
}

async function getWasmFileset(): Promise<unknown> {
  if (wasmFilesetPromise) return wasmFilesetPromise;
  wasmFilesetPromise = (async () => {
    try {
      return await withTimeout(FilesetResolver.forVisionTasks(LOCAL_WASM_PATH), 6000, "Local WASM resolver");
    } catch {
      // Fallback to CDN
      return await withTimeout(FilesetResolver.forVisionTasks(CDN_WASM_PATH), 15000, "CDN WASM resolver");
    }
  })();
  return wasmFilesetPromise;
}

async function initLandmarker(): Promise<FaceLandmarker | null> {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    try {
      const wasm = (await getWasmFileset()) as Parameters<typeof FaceLandmarker.createFromOptions>[0];
      // Try local model first with GPU delegate, fallback to CPU
      try {
        return await FaceLandmarker.createFromOptions(wasm, {
          baseOptions: { modelAssetPath: LOCAL_LANDMARKER_MODEL, delegate: "GPU" },
          runningMode: "IMAGE",
          numFaces: 4,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
        });
      } catch {
        try {
          return await FaceLandmarker.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: LOCAL_LANDMARKER_MODEL, delegate: "CPU" },
            runningMode: "IMAGE",
            numFaces: 4,
            minFaceDetectionConfidence: 0.4,
            minFacePresenceConfidence: 0.4,
          });
        } catch {
          // Fallback to CDN model
          return await FaceLandmarker.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: CDN_LANDMARKER_MODEL, delegate: "CPU" },
            runningMode: "IMAGE",
            numFaces: 4,
            minFaceDetectionConfidence: 0.4,
            minFacePresenceConfidence: 0.4,
          });
        }
      }
    } catch (err) {
      console.warn("[Vision] FaceLandmarker initialization failed:", err);
      return null;
    }
  })();
  return landmarkerPromise;
}

async function initSegmenter(): Promise<ImageSegmenter | null> {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    try {
      const wasm = (await getWasmFileset()) as Parameters<typeof ImageSegmenter.createFromOptions>[0];
      // Try local model first with GPU, fallback to CPU
      try {
        return await ImageSegmenter.createFromOptions(wasm, {
          baseOptions: { modelAssetPath: LOCAL_SEGMENTER_MODEL, delegate: "GPU" },
          runningMode: "IMAGE",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      } catch {
        try {
          return await ImageSegmenter.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: LOCAL_SEGMENTER_MODEL, delegate: "CPU" },
            runningMode: "IMAGE",
            outputCategoryMask: true,
            outputConfidenceMasks: false,
          });
        } catch {
          // Fallback to CDN model
          return await ImageSegmenter.createFromOptions(wasm, {
            baseOptions: { modelAssetPath: CDN_SEGMENTER_MODEL, delegate: "CPU" },
            runningMode: "IMAGE",
            outputCategoryMask: true,
            outputConfidenceMasks: false,
          });
        }
      }
    } catch (err) {
      console.warn("[Vision] ImageSegmenter initialization failed:", err);
      return null;
    }
  })();
  return segmenterPromise;
}

/** Preload vision models in background */
export async function preloadVision(): Promise<void> {
  if (typeof window === "undefined") return;
  await Promise.allSettled([initLandmarker(), initSegmenter()]);
}

/**
 * Analyze an image canvas to extract face landmarks and multiclass segmentation mask.
 * Automatically picks the largest face if multiple faces are present.
 * Degrades gracefully if either or both models fail.
 */
export async function analyze(source: HTMLCanvasElement): Promise<VisionResult> {
  const sourceW = source.width;
  const sourceH = source.height;
  const inferSource: CanvasImageSource = source;

  const [landmarker, segmenter] = await Promise.all([
    withTimeout(initLandmarker(), 30000, "Landmarker init").catch(() => null),
    withTimeout(initSegmenter(), 30000, "Segmenter init").catch(() => null),
  ]);

  let landmarks: Landmark[] | null = null;
  let hasFace = false;
  let degradedLandmarker = !landmarker;

  if (landmarker) {
    try {
      const result = landmarker.detect(inferSource);
      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        hasFace = true;
        // If multiple faces, select the one with the largest bounding box area
        let bestFace = result.faceLandmarks[0]!;
        let maxArea = -1;

        for (const face of result.faceLandmarks) {
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          for (const p of face) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          const area = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
          if (area > maxArea) {
            maxArea = area;
            bestFace = face;
          }
        }

        landmarks = bestFace.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
        }));
      }
    } catch (err) {
      console.warn("[Vision] Face detection failed:", err);
      degradedLandmarker = true;
    }
  }

  let classes: Uint8Array | null = null;
  let classW = 0;
  let classH = 0;
  let degradedSegmenter = !segmenter;

  if (segmenter) {
    try {
      const segResult = segmenter.segment(inferSource);
      if (segResult.categoryMask) {
        const mask = segResult.categoryMask;
        classW = mask.width;
        classH = mask.height;
        // Copy to standalone Uint8Array
        classes = new Uint8Array(mask.getAsUint8Array());
        mask.close();
      }
      if (segResult.confidenceMasks) {
        for (const m of segResult.confidenceMasks) {
          m.close();
        }
      }
    } catch (err) {
      console.warn("[Vision] Image segmentation failed:", err);
      degradedSegmenter = true;
    }
  }

  return {
    hasFace,
    landmarks,
    classes,
    classW,
    classH,
    sourceW,
    sourceH,
    degraded: {
      landmarker: degradedLandmarker,
      segmenter: degradedSegmenter,
    },
  };
}