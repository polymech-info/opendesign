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

export function pageLayer(canvas: fabric.StaticCanvas | fabric.Canvas, id: string) {
  return canvas.getObjects().find((obj) => (obj as { _id?: string })._id === id);
}

/** Remove page photo layers (keeps theme fill rect). */
export function removePagePhoto(canvas: fabric.StaticCanvas | fabric.Canvas) {
  for (const obj of [...canvas.getObjects()]) {
    const id = (obj as { _id?: string })._id;
    if (id === "canvas.photo" || isBgImage(obj)) canvas.remove(obj);
  }
}

export function setPageThemeFill(canvas: fabric.StaticCanvas | fabric.Canvas, fill: string) {
  const bg = pageLayer(canvas, "canvas.bg");
  if (bg) bg.set("fill", fill);
}

/** Theme fill rect at index 0, optional photo bg directly above it. */
export function stackPageBackgroundLayers(canvas: fabric.StaticCanvas | fabric.Canvas) {
  const bg = pageLayer(canvas, "canvas.bg");
  const photo = pageLayer(canvas, "canvas.photo");
  if (bg) canvas.sendObjectToBack(bg);
  if (photo instanceof fabric.FabricImage) {
    lockBackgroundImage(photo);
    if (bg) {
      const bgIdx = canvas.getObjects().indexOf(bg);
      canvas.moveObjectTo(photo, bgIdx + 1);
    } else {
      canvas.sendObjectToBack(photo);
    }
  }
}

export function restoreLockedBackgrounds(canvas: fabric.StaticCanvas | fabric.Canvas) {
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  try {
    for (const obj of canvas.getObjects()) {
      if (!isBgImage(obj)) continue;
      lockBackgroundImage(obj);
    }
    stackPageBackgroundLayers(canvas);
    if (!(canvas instanceof fabric.Canvas)) return;
    const active = canvas.getActiveObject();
    if (active && (isBgImage(active) || canvas.getActiveObjects().some(isBgImage))) {
      canvas.discardActiveObject();
    }
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
}
