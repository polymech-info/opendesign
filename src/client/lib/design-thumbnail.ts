import * as fabric from "fabric";
import { loadFabricJSON } from "./fabric-json";
import { canvasToDataUrl } from "./export-png";

/** Compact JPEG for the home-page design card. */
export async function renderDesignThumbnail(
  canvasJson: string | null | undefined,
  width: number,
  height: number,
): Promise<string | null> {
  const w = Math.max(1, width || 1080);
  const h = Math.max(1, height || 1080);
  const el = document.createElement("canvas");
  const canvas = new fabric.StaticCanvas(el, {
    width: w,
    height: h,
    backgroundColor: "#ffffff",
  });
  try {
    if (canvasJson && canvasJson !== "{}") await loadFabricJSON(canvas, canvasJson);
    canvas.renderAll();
    const multiplier = Math.min(480 / w, 480 / h, 1);
    return canvasToDataUrl(canvas, { format: "jpeg", multiplier: Math.max(multiplier, 0.15), quality: 0.72 });
  } catch (err) {
    console.warn("design thumbnail render failed", err);
    return null;
  } finally {
    canvas.dispose();
  }
}
