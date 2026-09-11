import * as fabric from "fabric";

export function canvasToPngDataUrl(canvas: fabric.StaticCanvas, multiplier = 2): string {
  const objects = canvas.getObjects();
  const prevCache = objects.map((o) => o.objectCaching);
  for (const obj of objects) {
    obj.objectCaching = false;
    obj.dirty = true;
  }
  canvas.renderAll();
  const dataURL = canvas.toDataURL({
    format: "png",
    multiplier,
    quality: 1,
    enableRetinaScaling: false,
  });
  objects.forEach((obj, i) => {
    obj.objectCaching = prevCache[i];
  });
  return dataURL;
}
