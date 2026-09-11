import * as fabric from "fabric";
import { applyCornerRadius } from "./image-radius";

export type ShapeKind =
  | "rect"
  | "round"
  | "circle"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "star"
  | "arrow"
  | "line";

const SHAPE_DEFAULTS = {
  fill: "#6366f1",
  stroke: "",
  strokeWidth: 0,
  opacity: 1,
};

function poly(cx: number, cy: number, r: number, sides: number, start = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, i) => {
    const a = start + (Math.PI * 2 * i) / sides;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function star(cx: number, cy: number, outer: number, inner: number, spikes = 5) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function createShapeObject(type: ShapeKind, canvasWidth: number, canvasHeight: number) {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  switch (type) {
    case "rect": {
      const rect = new fabric.Rect({
        left: cx - 75,
        top: cy - 75,
        width: 150,
        height: 150,
        ...SHAPE_DEFAULTS,
      });
      applyCornerRadius(rect, 8);
      return rect;
    }
    case "round": {
      const rect = new fabric.Rect({
        left: cx - 90,
        top: cy - 56,
        width: 180,
        height: 112,
        ...SHAPE_DEFAULTS,
      });
      applyCornerRadius(rect, 28);
      return rect;
    }
    case "circle":
      return new fabric.Circle({
        left: cx - 60,
        top: cy - 60,
        radius: 60,
        ...SHAPE_DEFAULTS,
      });
    case "ellipse":
      return new fabric.Ellipse({
        left: cx - 80,
        top: cy - 48,
        rx: 80,
        ry: 48,
        ...SHAPE_DEFAULTS,
      });
    case "triangle":
      return new fabric.Triangle({
        left: cx - 60,
        top: cy - 60,
        width: 120,
        height: 120,
        ...SHAPE_DEFAULTS,
      });
    case "diamond":
      return new fabric.Polygon(poly(0, 0, 70, 4, 0), {
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        ...SHAPE_DEFAULTS,
      });
    case "hexagon":
      return new fabric.Polygon(poly(0, 0, 70, 6), {
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        ...SHAPE_DEFAULTS,
      });
    case "star":
      return new fabric.Polygon(star(0, 0, 70, 32), {
        left: cx,
        top: cy,
        originX: "center",
        originY: "center",
        ...SHAPE_DEFAULTS,
      });
    case "arrow":
      return new fabric.Polygon(
        [
          { x: 0, y: 22 },
          { x: 78, y: 22 },
          { x: 78, y: 0 },
          { x: 128, y: 36 },
          { x: 78, y: 72 },
          { x: 78, y: 50 },
          { x: 0, y: 50 },
        ],
        {
          left: cx,
          top: cy,
          originX: "center",
          originY: "center",
          ...SHAPE_DEFAULTS,
        }
      );
    case "line":
      return new fabric.Line([cx - 100, cy, cx + 100, cy], {
        stroke: "#6366f1",
        strokeWidth: 3,
        fill: "",
      });
    default:
      return null;
  }
}
