import * as fabric from "fabric";
import { isIconObject } from "./tabler-icons";

export type ObjectFrame = {
  center: fabric.Point;
  left: number;
  top: number;
  originX: fabric.FabricObject["originX"];
  originY: fabric.FabricObject["originY"];
  angle: number;
  flipX: boolean;
  flipY: boolean;
  skewX: number;
  skewY: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
};

export function captureObjectFrame(obj: fabric.FabricObject): ObjectFrame {
  return {
    center: obj.getCenterPoint(),
    left: obj.left || 0,
    top: obj.top || 0,
    originX: obj.originX,
    originY: obj.originY,
    angle: obj.angle || 0,
    flipX: !!obj.flipX,
    flipY: !!obj.flipY,
    skewX: obj.skewX || 0,
    skewY: obj.skewY || 0,
    width: Math.max(1, obj.getScaledWidth()),
    height: Math.max(1, obj.getScaledHeight()),
    opacity: obj.opacity ?? 1,
    visible: obj.visible !== false,
  };
}

function scaleForFrame(obj: fabric.FabricObject, frame: ObjectFrame) {
  const nativeW = Math.max(1, obj.width || 1);
  const nativeH = Math.max(1, obj.height || 1);
  if (isIconObject(obj)) {
    const scale = Math.max(frame.width, frame.height) / Math.max(nativeW, nativeH);
    return { scaleX: scale, scaleY: scale };
  }
  return { scaleX: frame.width / nativeW, scaleY: frame.height / nativeH };
}

export function applyObjectFrame(obj: fabric.FabricObject, frame: ObjectFrame) {
  const { scaleX, scaleY } = scaleForFrame(obj, frame);
  obj.set({
    angle: frame.angle,
    flipX: frame.flipX,
    flipY: frame.flipY,
    skewX: frame.skewX,
    skewY: frame.skewY,
    scaleX,
    scaleY,
    opacity: frame.opacity,
    visible: frame.visible,
  });
  if (obj.group) {
    obj.set({
      originX: frame.originX,
      originY: frame.originY,
      left: frame.left,
      top: frame.top,
    });
  } else {
    obj.set({ originX: "center", originY: "center" });
    obj.setPositionByOrigin(frame.center, "center", "center");
  }
  obj.setCoords();
}

export function copyObjectChrome(from: fabric.FabricObject, to: fabric.FabricObject) {
  to.set({
    transparentCorners: from.transparentCorners,
    borderColor: from.borderColor,
    borderScaleFactor: from.borderScaleFactor,
    cornerSize: from.cornerSize,
    cornerColor: from.cornerColor,
    cornerStrokeColor: from.cornerStrokeColor,
    cornerStyle: from.cornerStyle,
    padding: from.padding,
  });
  to.controls = from.controls;
  if (from.hoverCursor) to.hoverCursor = from.hoverCursor;
  (to as { _layerId?: string })._layerId = (from as { _layerId?: string })._layerId;
  (to as { _id?: string })._id = (from as { _id?: string })._id;
  (to as { _elementSource?: string })._elementSource = (from as { _elementSource?: string })._elementSource;
  (to as { _elementName?: string })._elementName = (from as { _elementName?: string })._elementName;
}

function withSuspendedGroupLayout(group: fabric.Group, fn: () => void) {
  const manager = group.layoutManager;
  if (!manager) {
    fn();
    return;
  }
  const perform = manager.performLayout.bind(manager);
  manager.performLayout = () => undefined;
  try {
    fn();
  } finally {
    manager.performLayout = perform;
  }
}

export function swapCanvasObject(
  canvas: fabric.Canvas,
  previous: fabric.FabricObject,
  next: fabric.FabricObject
) {
  const frame = captureObjectFrame(previous);
  copyObjectChrome(previous, next);
  const parent = previous.group;
  if (parent && typeof parent.insertAt === "function") {
    const index = parent.getObjects().indexOf(previous);
    withSuspendedGroupLayout(parent, () => {
      parent.remove(previous);
      parent.insertAt(index >= 0 ? index : parent.size(), next);
    });
    applyObjectFrame(next, frame);
    if (typeof parent.triggerLayout === "function") parent.triggerLayout();
    parent.dirty = true;
    parent.setCoords();
  } else {
    const index = canvas.getObjects().indexOf(previous);
    canvas.remove(previous);
    canvas.add(next);
    if (index >= 0) canvas.moveObjectTo(next, index);
    applyObjectFrame(next, frame);
  }
}
