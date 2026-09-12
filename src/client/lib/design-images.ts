import * as fabric from "fabric";
import type { DesignDocument } from "../../design/types";
import { applyImageCornerRadius, readImageCornerRadius } from "./image-radius";
import { swapCanvasObject } from "./object-frame";
import { applyObjectStyle, captureObjectStyle } from "./object-style";
import { ensureStyleRenderer } from "./style-presets";
import { readObjectId } from "./object-identity";
import { lockBackgroundImage, pageLayer, removePagePhoto, stackPageBackgroundLayers } from "./background-image";

async function waitForImageElement(el: HTMLImageElement | undefined): Promise<void> {
  if (!el || el.complete) return;
  await new Promise<void>((resolve) => {
    el.onload = () => resolve();
    el.onerror = () => resolve();
  });
}

export function stretchedImageFrame(
  nativeWidth: number,
  nativeHeight: number,
  sceneWidth: number,
  sceneHeight: number,
) {
  const width = Math.max(1, nativeWidth || 1);
  const height = Math.max(1, nativeHeight || 1);
  return {
    width,
    height,
    scaleX: Math.max(1, sceneWidth || 1) / width,
    scaleY: Math.max(1, sceneHeight || 1) / height,
  };
}

function backgroundSceneSize(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  photo: fabric.FabricImage,
  canvasWidth?: number,
  canvasHeight?: number,
) {
  const bounds = (photo as fabric.FabricImage & { _designBounds?: { w?: number; h?: number } })
    ._designBounds;
  const bg = pageLayer(canvas, "canvas.bg");
  return {
    width:
      canvasWidth ||
      Number(bounds?.w) ||
      Math.abs(Number(bg?.width || 0) * Number(bg?.scaleX || 1)) ||
      canvas.getWidth(),
    height:
      canvasHeight ||
      Number(bounds?.h) ||
      Math.abs(Number(bg?.height || 0) * Number(bg?.scaleY || 1)) ||
      canvas.getHeight(),
  };
}

/** Scale page photo to canvas after async image decode (avoids stretched/corrupt bg on full reload). */
export async function hydratePageBackground(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  canvasWidth?: number,
  canvasHeight?: number,
): Promise<void> {
  const photo = pageLayer(canvas, "canvas.photo");
  if (!(photo instanceof fabric.FabricImage)) return;
  const el = photo.getElement() as HTMLImageElement | undefined;
  await waitForImageElement(el);
  const nw = Math.max(1, el?.naturalWidth || photo.width || 1);
  const nh = Math.max(1, el?.naturalHeight || photo.height || 1);
  const scene = backgroundSceneSize(canvas, photo, canvasWidth, canvasHeight);
  const frame = stretchedImageFrame(nw, nh, scene.width, scene.height);
  photo.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    ...frame,
    _designBounds: { w: scene.width, h: scene.height },
  });
  photo.setCoords();
  lockBackgroundImage(photo);
  stackPageBackgroundLayers(canvas);
}

export async function hydrateDesignImages(canvas: fabric.Canvas, doc: DesignDocument): Promise<void> {
  for (const node of doc.nodes.filter((n) => n.type === "img")) {
    const obj = canvas.getObjects().find((o) => (o as { _id?: string })._id === node.id);
    if (!(obj instanceof fabric.FabricImage)) continue;
    const el = obj.getElement() as HTMLImageElement | undefined;
    const nw = Math.max(1, el?.naturalWidth || obj.width || 1);
    const nh = Math.max(1, el?.naturalHeight || obj.height || 1);
    obj.set({
      originX: "left",
      originY: "top",
      left: node.bounds.x,
      top: node.bounds.y,
      width: nw,
      height: nh,
      scaleX: node.bounds.w / nw,
      scaleY: node.bounds.h / nh,
    });
    applyImageCornerRadius(obj, readImageCornerRadius(obj));
    obj.setCoords();
  }
}

export async function patchFabricImageSrc(
  canvas: fabric.Canvas,
  id: string,
  url: string,
): Promise<fabric.FabricImage | null> {
  const obj = canvas.getObjects().find((o) => (o as { _id?: string })._id === id);
  if (!(obj instanceof fabric.FabricImage)) return null;
  const style = captureObjectStyle(obj);
  const radius = readImageCornerRadius(obj);
  const next = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
  next.set({
    originX: obj.originX,
    originY: obj.originY,
    left: obj.left,
    top: obj.top,
    scaleX: obj.scaleX,
    scaleY: obj.scaleY,
    angle: obj.angle,
    flipX: obj.flipX,
    flipY: obj.flipY,
    _id: id,
  });
  applyObjectStyle(next, style);
  applyImageCornerRadius(next, radius);
  ensureStyleRenderer(next);
  swapCanvasObject(canvas, obj, next);
  canvas.setActiveObject(next);
  return next;
}

export async function patchPageBackgroundSrc(
  canvas: fabric.Canvas,
  url: string,
  canvasWidth: number,
  canvasHeight: number,
): Promise<boolean> {
  const prev = pageLayer(canvas, "canvas.photo");
  const next = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
  const w = next.width || 1;
  const h = next.height || 1;
  next.set({
    left: 0,
    top: 0,
    originX: "left",
    originY: "top",
    scaleX: canvasWidth / w,
    scaleY: canvasHeight / h,
    _id: "canvas.photo",
  });
  lockBackgroundImage(next);
  if (prev instanceof fabric.FabricImage) swapCanvasObject(canvas, prev, next);
  else {
    removePagePhoto(canvas);
    canvas.add(next);
  }
  stackPageBackgroundLayers(canvas);
  return true;
}
