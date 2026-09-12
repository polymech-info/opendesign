import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { applyImageCornerRadius, readImageCornerRadius } from "./image-radius";
import { abortCanvasTransform } from "./element-group";
import { isIconObject } from "./tabler-icons";

const CORNERS = new Set(["tl", "tr", "bl", "br"]);
const MIDS = new Set(["ml", "mr", "mt", "mb"]);
const MIN_CROP = 24;

export type ImageClipHandle = "ml" | "mr" | "mt" | "mb";

export type ImageClipStart = {
  cropX: number;
  cropY: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  angle?: number;
  flipX?: boolean;
  flipY?: boolean;
  pin?: { x: number; y: number };
};

export function isCroppableImage(obj: fabric.FabricObject | null | undefined): obj is fabric.FabricImage {
  return obj instanceof fabric.FabricImage && !isBgImage(obj) && !isIconObject(obj);
}

type SizedImage = fabric.FabricImage & { _sourceW?: number; _sourceH?: number };

export function imageSourceSize(img: fabric.FabricImage) {
  const sized = img as SizedImage;
  const el = img.getElement() as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
  const nw = Number(el?.naturalWidth || 0);
  const nh = Number(el?.naturalHeight || 0);
  if (nw > 0 && nh > 0) {
    sized._sourceW = nw;
    sized._sourceH = nh;
    return { w: nw, h: nh };
  }
  // Prefer natural pixels only. Layout `el.width` is often a CSS/default size
  // and must not be cached as the bitmap — that offsets the crop frame.
  const windowW = (img.cropX || 0) + (img.width || 1);
  const windowH = (img.cropY || 0) + (img.height || 1);
  const w = Math.max(1, sized._sourceW || 0, windowW);
  const h = Math.max(1, sized._sourceH || 0, windowH);
  sized._sourceW = w;
  sized._sourceH = h;
  return { w, h };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function sceneAxisScale(img: fabric.FabricImage) {
  const m = img.calcTransformMatrix();
  return {
    x: Math.max(1e-6, Math.hypot(m[0], m[1])),
    y: Math.max(1e-6, Math.hypot(m[2], m[3])),
  };
}

function maxCropWindow(img: fabric.FabricImage) {
  const src = imageSourceSize(img);
  const displayW = Math.max(1, (img.width || 1) * Math.abs(img.scaleX || 1));
  const displayH = Math.max(1, (img.height || 1) * Math.abs(img.scaleY || 1));
  const aspect = displayW / displayH;
  let w = src.w;
  let h = w / aspect;
  if (h > src.h) {
    h = src.h;
    w = h * aspect;
  }
  return { w: Math.max(1, w), h: Math.max(1, h), src, aspect };
}

function applyCropWindow(
  img: fabric.FabricImage,
  cropX: number,
  cropY: number,
  width: number,
  height: number
) {
  const src = imageSourceSize(img);
  const displayW = Math.max(1, (img.width || 1) * Math.abs(img.scaleX || 1));
  const displayH = Math.max(1, (img.height || 1) * Math.abs(img.scaleY || 1));
  const aspect = displayW / displayH;
  const minW = Math.min(src.w, Math.max(MIN_CROP, src.w * 0.04));
  const minH = minW / aspect;
  let w = clamp(width, minW, src.w);
  let h = w / aspect;
  if (h > src.h) {
    h = src.h;
    w = h * aspect;
  }
  if (w > src.w) {
    w = src.w;
    h = w / aspect;
  }
  if (h < minH && minH <= src.h) {
    h = minH;
    w = h * aspect;
  }
  const x = clamp(cropX, 0, Math.max(0, src.w - w));
  const y = clamp(cropY, 0, Math.max(0, src.h - h));
  const sx = Math.sign(img.scaleX || 1) || 1;
  const sy = Math.sign(img.scaleY || 1) || 1;
  img.set({
    cropX: x,
    cropY: y,
    width: w,
    height: h,
    scaleX: sx * (displayW / w),
    scaleY: sy * (displayH / h),
  });
  applyImageCornerRadius(img, readImageCornerRadius(img));
  img.setCoords();
  img.dirty = true;
}

export function panImageCrop(img: fabric.FabricImage, sceneDx: number, sceneDy: number) {
  const axis = sceneAxisScale(img);
  let dx = -sceneDx / axis.x;
  let dy = -sceneDy / axis.y;
  if (img.flipX) dx = -dx;
  if (img.flipY) dy = -dy;
  applyCropWindow(img, (img.cropX || 0) + dx, (img.cropY || 0) + dy, img.width || 1, img.height || 1);
}

export function zoomImageCrop(
  img: fabric.FabricImage,
  factor: number,
  handle: "tl" | "tr" | "bl" | "br",
  start: { cropX: number; cropY: number; width: number; height: number }
) {
  const scale = Math.max(0.05, factor);
  const width = start.width / scale;
  const height = start.height / scale;
  const right = start.cropX + start.width;
  const bottom = start.cropY + start.height;
  let cropX = start.cropX;
  let cropY = start.cropY;
  if (handle === "tl") {
    cropX = right - width;
    cropY = bottom - height;
  } else if (handle === "tr") {
    cropX = start.cropX;
    cropY = bottom - height;
  } else if (handle === "bl") {
    cropX = right - width;
    cropY = start.cropY;
  }
  applyCropWindow(img, cropX, cropY, width, height);
}

function clipPinOrigin(handle: ImageClipHandle): {
  originX: fabric.FabricObject["originX"];
  originY: fabric.FabricObject["originY"];
} {
  if (handle === "ml") return { originX: "right", originY: "center" };
  if (handle === "mr") return { originX: "left", originY: "center" };
  if (handle === "mt") return { originX: "center", originY: "bottom" };
  return { originX: "center", originY: "top" };
}

function sceneDeltaToSource(
  sceneDx: number,
  sceneDy: number,
  start: ImageClipStart
) {
  const angle = ((start.angle || 0) * Math.PI) / 180;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let lx = sceneDx * cos - sceneDy * sin;
  let ly = sceneDx * sin + sceneDy * cos;
  if (start.flipX) lx = -lx;
  if (start.flipY) ly = -ly;
  return {
    x: lx / (Math.abs(start.scaleX) || 1),
    y: ly / (Math.abs(start.scaleY) || 1),
  };
}

/** Shift + mid-handle: resize the crop window. Scale stays put (no stretch). */
export function clipImageCrop(
  img: fabric.FabricImage,
  handle: ImageClipHandle,
  sceneDx: number,
  sceneDy: number,
  start: ImageClipStart
) {
  const src = imageSourceSize(img);
  const delta = sceneDeltaToSource(sceneDx, sceneDy, start);
  const minW = Math.min(src.w, Math.max(MIN_CROP, src.w * 0.04));
  const minH = Math.min(src.h, Math.max(MIN_CROP, src.h * 0.04));
  let cropX = start.cropX;
  let cropY = start.cropY;
  let width = start.width;
  let height = start.height;

  if (handle === "mr") {
    width = clamp(start.width + delta.x, minW, src.w - start.cropX);
  } else if (handle === "ml") {
    width = clamp(start.width - delta.x, minW, start.cropX + start.width);
    cropX = start.cropX + start.width - width;
  } else if (handle === "mb") {
    height = clamp(start.height + delta.y, minH, src.h - start.cropY);
  } else {
    height = clamp(start.height - delta.y, minH, start.cropY + start.height);
    cropY = start.cropY + start.height - height;
  }

  cropX = clamp(cropX, 0, Math.max(0, src.w - width));
  cropY = clamp(cropY, 0, Math.max(0, src.h - height));

  const pinOrigin = clipPinOrigin(handle);
  const pin = start.pin ?? img.getPointByOrigin(pinOrigin.originX, pinOrigin.originY);
  img.set({
    cropX,
    cropY,
    width,
    height,
    scaleX: start.scaleX,
    scaleY: start.scaleY,
  });
  img.setPositionByOrigin(new fabric.Point(pin.x, pin.y), pinOrigin.originX, pinOrigin.originY);
  applyImageCornerRadius(img, readImageCornerRadius(img));
  img.setCoords();
  img.dirty = true;
}

export function readImageCrop(img: fabric.FabricImage) {
  const fit = maxCropWindow(img);
  const width = Math.max(1, img.width || 1);
  const height = Math.max(1, img.height || 1);
  const cropX = img.cropX || 0;
  const cropY = img.cropY || 0;
  const zoom = fit.w / width;
  const maxZoom = fit.w / Math.min(fit.w, Math.max(MIN_CROP, fit.src.w * 0.04));
  return {
    cropX,
    cropY,
    zoom,
    maxX: Math.max(0, fit.src.w - width),
    maxY: Math.max(0, fit.src.h - height),
    minZoom: 1,
    maxZoom: Math.max(1.05, maxZoom),
    cropped: cropX > 0.5 || cropY > 0.5 || Math.abs(width - fit.w) > 0.5,
  };
}

export function setImageCropOrigin(img: fabric.FabricImage, cropX: number, cropY: number) {
  applyCropWindow(img, cropX, cropY, img.width || 1, img.height || 1);
}

export function setImageCropZoom(img: fabric.FabricImage, zoom: number) {
  const fit = maxCropWindow(img);
  const next = Math.max(1, zoom);
  const width = fit.w / next;
  const height = fit.h / next;
  const cx = (img.cropX || 0) + (img.width || 1) / 2;
  const cy = (img.cropY || 0) + (img.height || 1) / 2;
  applyCropWindow(img, cx - width / 2, cy - height / 2, width, height);
}

export function resetImageCrop(img: fabric.FabricImage) {
  const fit = maxCropWindow(img);
  applyCropWindow(img, (fit.src.w - fit.w) / 2, (fit.src.h - fit.h) / 2, fit.w, fit.h);
}

type CropGesture =
  | {
      mode: "pan";
      img: fabric.FabricImage;
      last: fabric.Point;
      locks: { moveX: boolean; moveY: boolean };
    }
  | {
      mode: "zoom";
      img: fabric.FabricImage;
      handle: "tl" | "tr" | "bl" | "br";
      origin: fabric.Point;
      startDist: number;
      start: { cropX: number; cropY: number; width: number; height: number };
      locks: { moveX: boolean; moveY: boolean; scaleX: boolean; scaleY: boolean };
    }
  | {
      mode: "clip";
      img: fabric.FabricImage;
      handle: ImageClipHandle;
      startScene: fabric.Point;
      start: ImageClipStart;
      locks: { moveX: boolean; moveY: boolean; scaleX: boolean; scaleY: boolean };
    };

function oppositeCoord(img: fabric.FabricImage, handle: "tl" | "tr" | "bl" | "br") {
  const c = img.oCoords;
  if (handle === "tl") return c.br;
  if (handle === "tr") return c.bl;
  if (handle === "bl") return c.tr;
  return c.tl;
}

export function installImageCropGestures(canvas: fabric.Canvas, onCommit: () => void) {
  let gesture: CropGesture | null = null;

  const finish = (commit: boolean) => {
    if (!gesture) return;
    const { img, locks } = gesture;
    img.lockMovementX = locks.moveX;
    img.lockMovementY = locks.moveY;
    if (gesture.mode === "zoom" || gesture.mode === "clip") {
      img.lockScalingX = gesture.locks.scaleX;
      img.lockScalingY = gesture.locks.scaleY;
    }
    gesture = null;
    canvas.setCursor("default");
    canvas.requestRenderAll();
    if (commit) onCommit();
  };

  const onDown = (opt: { e?: Event }) => {
    const evt = opt.e as MouseEvent | undefined;
    if (!evt?.shiftKey) return;
    const img = canvas.getActiveObject();
    if (!isCroppableImage(img)) return;
    const pointer = canvas.getViewportPoint(evt as never);
    const hit = img.findControl(pointer);
    if (hit?.key === "mtr") return;
    abortCanvasTransform(canvas);
    const scene = canvas.getScenePoint(evt as never);
    if (hit && CORNERS.has(hit.key)) {
      const handle = hit.key as "tl" | "tr" | "bl" | "br";
      img.setCoords();
      const origin = oppositeCoord(img, handle);
      gesture = {
        mode: "zoom",
        img,
        handle,
        origin,
        startDist: Math.max(8, Math.hypot(scene.x - origin.x, scene.y - origin.y)),
        start: {
          cropX: img.cropX || 0,
          cropY: img.cropY || 0,
          width: img.width || 1,
          height: img.height || 1,
        },
        locks: {
          moveX: !!img.lockMovementX,
          moveY: !!img.lockMovementY,
          scaleX: !!img.lockScalingX,
          scaleY: !!img.lockScalingY,
        },
      };
      img.lockMovementX = true;
      img.lockMovementY = true;
      img.lockScalingX = true;
      img.lockScalingY = true;
    } else if (hit && MIDS.has(hit.key)) {
      const handle = hit.key as ImageClipHandle;
      img.setCoords();
      const pinOrigin = clipPinOrigin(handle);
      const pin = img.getPointByOrigin(pinOrigin.originX, pinOrigin.originY);
      gesture = {
        mode: "clip",
        img,
        handle,
        startScene: scene,
        start: {
          cropX: img.cropX || 0,
          cropY: img.cropY || 0,
          width: img.width || 1,
          height: img.height || 1,
          scaleX: img.scaleX || 1,
          scaleY: img.scaleY || 1,
          angle: img.angle || 0,
          flipX: !!img.flipX,
          flipY: !!img.flipY,
          pin: { x: pin.x, y: pin.y },
        },
        locks: {
          moveX: !!img.lockMovementX,
          moveY: !!img.lockMovementY,
          scaleX: !!img.lockScalingX,
          scaleY: !!img.lockScalingY,
        },
      };
      img.lockMovementX = true;
      img.lockMovementY = true;
      img.lockScalingX = true;
      img.lockScalingY = true;
    } else if (!hit) {
      gesture = {
        mode: "pan",
        img,
        last: scene,
        locks: { moveX: !!img.lockMovementX, moveY: !!img.lockMovementY },
      };
      img.lockMovementX = true;
      img.lockMovementY = true;
      canvas.setCursor("grabbing");
    }
  };

  const onMove = (opt: { e?: Event }) => {
    if (!gesture) return;
    const evt = opt.e as MouseEvent | undefined;
    if (!evt) return;
    abortCanvasTransform(canvas);
    const scene = canvas.getScenePoint(evt as never);
    if (gesture.mode === "pan") {
      panImageCrop(gesture.img, scene.x - gesture.last.x, scene.y - gesture.last.y);
      gesture.last = scene;
    } else if (gesture.mode === "clip") {
      clipImageCrop(
        gesture.img,
        gesture.handle,
        scene.x - gesture.startScene.x,
        scene.y - gesture.startScene.y,
        gesture.start
      );
    } else {
      const dist = Math.hypot(scene.x - gesture.origin.x, scene.y - gesture.origin.y);
      zoomImageCrop(gesture.img, dist / gesture.startDist, gesture.handle, gesture.start);
    }
    canvas.requestRenderAll();
  };

  const onUp = () => finish(true);

  canvas.on("mouse:down", onDown);
  canvas.on("mouse:move", onMove);
  canvas.on("mouse:up", onUp);
  return () => {
    canvas.off("mouse:down", onDown);
    canvas.off("mouse:move", onMove);
    canvas.off("mouse:up", onUp);
    finish(false);
  };
}
