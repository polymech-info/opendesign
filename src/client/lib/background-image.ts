import * as fabric from "fabric";

export function isBgImage(obj: fabric.FabricObject | null | undefined): boolean {
  return !!(obj as { _isBgImage?: boolean } | undefined)?._isBgImage;
}

export function lockBackgroundImage(obj: fabric.FabricObject) {
  (obj as { _isBgImage?: boolean })._isBgImage = true;
  obj.set({
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hoverCursor: "default",
  });
  obj.clipPath = undefined;
  obj.dirty = true;
}

export function restoreLockedBackgrounds(canvas: fabric.StaticCanvas | fabric.Canvas) {
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  try {
    for (const obj of canvas.getObjects()) {
      if (!isBgImage(obj)) continue;
      lockBackgroundImage(obj);
      canvas.sendObjectToBack(obj);
    }
    if (!(canvas instanceof fabric.Canvas)) return;
    const active = canvas.getActiveObject();
    if (active && (isBgImage(active) || canvas.getActiveObjects().some(isBgImage))) {
      canvas.discardActiveObject();
    }
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
}
