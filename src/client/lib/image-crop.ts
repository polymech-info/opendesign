import * as fabric from "fabric";
import { isBgImage } from "./background-image";
import { applyImageCornerRadius, readImageCornerRadius } from "./image-radius";
import { abortCanvasTransform } from "./element-group";
import { isIconObject } from "./tabler-icons";

const CORNERS = new Set(["tl", "tr", "bl", "br"]);
const MIN_CROP = 24;

export function isCroppableImage(obj: fabric.FabricObject | null | undefined): obj is fabric.FabricImage {
  return obj instanceof fabric.FabricImage && !isBgImage(obj) && !isIconObject(obj);
}

type SizedImage = fabric.FabricImage & { _sourceW?: number; _sourceH?: number };

export function imageSourceSize(img: fabric.FabricImage) {
  const sized = img as SizedImage;
  const el = img.getElement() as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | null;
  const nw = el?.naturalWidth || el?.width || 0;
  const nh = el?.naturalHeight || el?.height || 0;
  if (nw > 0 && nh > 0) {
    sized._sourceW = nw;
    sized._sourceH = nh;
    return { w: nw, h: nh };
  }
  const w = Math.max(1, sized._sourceW || (img.cropX || 0) + (img.width || 1));
  const h = Math.max(1, sized._sourceH || (img.cropY || 0) + (img.height || 1));
  if (!sized._sourceW) sized._sourceW = w;
  if (!sized._sourceH) sized._sourceH = h;
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
    if (gesture.mode === "zoom") {
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
