import * as fabric from "fabric";

const SCALE_DIR = ["e", "se", "s", "sw", "w", "nw", "n", "ne"] as const;

const BIDI: Record<(typeof SCALE_DIR)[number], string> = {
  e: "ew-resize",
  w: "ew-resize",
  n: "ns-resize",
  s: "ns-resize",
  se: "nwse-resize",
  nw: "nwse-resize",
  sw: "nesw-resize",
  ne: "nesw-resize",
};

const HANDLE_FALLBACK: Record<string, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
  ml: "ew-resize",
  mr: "ew-resize",
  mt: "ns-resize",
  mb: "ns-resize",
};

function handleScenePoint(obj: fabric.FabricObject, key: string) {
  const cached = obj.oCoords?.[key as keyof typeof obj.oCoords];
  if (cached) return cached;
  const control = obj.controls?.[key];
  if (!control) return null;
  const originX = control.x < 0 ? "left" : control.x > 0 ? "right" : "center";
  const originY = control.y < 0 ? "top" : control.y > 0 ? "bottom" : "center";
  const point = obj.getPointByOrigin(originX, originY);
  const vt = obj.canvas?.viewportTransform;
  return vt ? fabric.util.transformPoint(point, vt) : point;
}

function cornerQuadrant(obj: fabric.FabricObject, coord: { x: number; y: number }) {
  const center = obj.getCenterPoint();
  const vt = obj.canvas?.viewportTransform;
  const origin = vt ? fabric.util.transformPoint(center, vt) : center;
  const twoPi = Math.PI * 2;
  const angle = Math.atan2(coord.y - origin.y, coord.x - origin.x);
  const wrapped = ((angle % twoPi) + twoPi) % twoPi;
  return Math.round(wrapped / (Math.PI / 4)) % 8;
}

/** Bidirectional resize cursor; ignores lockScaling so crop zoom/clip stay diagonal. */
export function resizeCursorStyleHandler(
  _eventData: unknown,
  _control: fabric.Control,
  fabricObject: fabric.FabricObject,
  coord: { x: number; y: number }
): string {
  return BIDI[SCALE_DIR[cornerQuadrant(fabricObject, coord)]];
}

export function resizeCursorForHandle(obj: fabric.FabricObject, key: string): string {
  const control = obj.controls?.[key];
  const coord = handleScenePoint(obj, key);
  if (control && coord) return resizeCursorStyleHandler(null, control, obj, coord);
  return HANDLE_FALLBACK[key] || "nwse-resize";
}

export function applyResizeCursors(obj: fabric.FabricObject) {
  if (!obj.controls) return;
  for (const key of ["tl", "tr", "bl", "br", "mt", "mb", "ml", "mr"]) {
    if (obj.controls[key]) obj.controls[key].cursorStyleHandler = resizeCursorStyleHandler;
  }
}
