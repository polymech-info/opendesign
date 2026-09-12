import * as fabric from "fabric";

export type CanvasExportOpts = {
  format?: "png" | "jpeg";
  multiplier?: number;
  quality?: number;
};

export function canvasToDataUrl(canvas: fabric.StaticCanvas, opts?: CanvasExportOpts): string {
  const format = opts?.format ?? "png";
  const multiplier = opts?.multiplier ?? 1;
  const quality = opts?.quality ?? (format === "jpeg" ? 0.72 : 1);
  const objects = canvas.getObjects();
  const prevCache = objects.map((o) => o.objectCaching);
  for (const obj of objects) {
    obj.objectCaching = false;
    obj.dirty = true;
  }
  canvas.renderAll();
  const dataURL = canvas.toDataURL({
    format,
    multiplier,
    quality,
    enableRetinaScaling: false,
  });
  objects.forEach((obj, i) => {
    obj.objectCaching = prevCache[i];
  });
  return dataURL;
}

export function canvasToPngDataUrl(canvas: fabric.StaticCanvas, multiplier = 2): string {
  return canvasToDataUrl(canvas, { format: "png", multiplier, quality: 1 });
}

/** Compact JPEG for agent vision — not a download export. */
export function canvasToScreenshotDataUrl(canvas: fabric.StaticCanvas): string {
  return canvasToDataUrl(canvas, { format: "jpeg", multiplier: 0.5, quality: 0.72 });
}

export function dataUrlToBlob(dataURL: string): Blob {
  const [header, data] = dataURL.split(",");
  const mime = header?.match(/:(.*?);/)?.[1] || "image/png";
  const bytes = Uint8Array.from(atob(data ?? ""), (ch) => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export async function copyCanvasPngToClipboard(canvas: fabric.StaticCanvas): Promise<void> {
  const blob = dataUrlToBlob(canvasToPngDataUrl(canvas, 2));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
