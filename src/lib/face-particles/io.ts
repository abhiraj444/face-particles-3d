export async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const maxEdge = 1024;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not create a 2D canvas.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas;
}

export async function loadUrl(url: string): Promise<HTMLCanvasElement> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Could not load image (${res.status}).`);
  return loadImage(await res.blob());
}

export function canvasFromImageData(data: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = data.width;
  c.height = data.height;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas.");
  ctx.putImageData(data, 0, 0);
  return c;
}
