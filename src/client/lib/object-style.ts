import * as fabric from "fabric";
import { applyImageCornerRadius, applyRectCornerRadius, readCornerRadius, readImageCornerRadius } from "./image-radius";
import { collectIds, uniqueIfTaken, nextUnique, objectKindSlug } from "./object-identity";
import {
  applyGlassOptions,
  applyStylePreset,
  readGlassOptions,
  readStylePreset,
  type GlassOptions,
  type StylePresetId,
} from "./style-presets";
import {
  applyIconFill,
  applyIconStroke,
  isIconObject,
  readIconFill,
  readIconStroke,
  readIconStrokeWidth,
} from "./tabler-icons";

export type CopiedObjectStyle = {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null;
  rx?: number;
  ry?: number;
  cornerRadius?: number;
  stylePreset: StylePresetId;
  glassOptions: GlassOptions;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  textAlign?: string;
  lineHeight?: number;
  charSpacing?: number;
};

function isTextObject(obj: fabric.FabricObject) {
  return obj instanceof fabric.Textbox || obj instanceof fabric.IText;
}

function snapshotShadow(obj: fabric.FabricObject): CopiedObjectStyle["shadow"] {
  const raw = obj.shadow;
  if (!raw) return null;
  const shadow = typeof raw === "string" ? new fabric.Shadow(raw) : raw;
  if (!shadow) return null;
  if ((shadow.blur ?? 0) <= 0 && !shadow.offsetX && !shadow.offsetY) return null;
  return {
    color: shadow.color || "rgba(15, 23, 42, 0.25)",
    blur: shadow.blur ?? 24,
    offsetX: shadow.offsetX ?? 0,
    offsetY: shadow.offsetY ?? 12,
  };
}

export function captureObjectStyle(obj: fabric.FabricObject): CopiedObjectStyle {
  const text = isTextObject(obj);
  const image = obj instanceof fabric.FabricImage;
  const icon = isIconObject(obj);
  const stylePreset = readStylePreset(obj);
  const backup = (obj as { _stylePresetBackup?: { fill?: unknown; stroke?: unknown; strokeWidth?: number } })
    ._stylePresetBackup;
  const liveFill = icon
    ? readIconFill(obj)
    : typeof obj.fill === "string" && obj.fill
      ? obj.fill
      : undefined;
  const liveStroke = icon
    ? readIconStroke(obj)
    : typeof obj.stroke === "string"
      ? obj.stroke
      : undefined;
  const liveStrokeWidth = icon ? readIconStrokeWidth(obj) : obj.strokeWidth || 0;
  const fill =
    stylePreset === "glass" && typeof backup?.fill === "string" ? backup.fill : liveFill;
  const stroke =
    stylePreset === "glass" && typeof backup?.stroke === "string" ? backup.stroke : liveStroke;
  const strokeWidth =
    stylePreset === "glass" && typeof backup?.strokeWidth === "number"
      ? backup.strokeWidth
      : liveStrokeWidth;
  const style: CopiedObjectStyle = {
    fill,
    stroke,
    strokeWidth,
    opacity: obj.opacity ?? 1,
    shadow: snapshotShadow(obj),
    stylePreset,
    glassOptions: readGlassOptions(obj),
  };
  if (obj instanceof fabric.Rect) {
    style.cornerRadius = readCornerRadius(obj);
  }
  if (image) style.cornerRadius = readImageCornerRadius(obj);
  if (text) {
    const t = obj as fabric.Textbox;
    style.fontFamily = t.fontFamily;
    style.fontSize = t.fontSize;
    style.fontWeight = t.fontWeight;
    style.fontStyle = t.fontStyle;
    style.underline = t.underline;
    style.textAlign = t.textAlign;
    style.lineHeight = t.lineHeight;
    style.charSpacing = t.charSpacing;
  }
  return style;
}

export function applyObjectStyle(obj: fabric.FabricObject, style: CopiedObjectStyle) {
  const text = isTextObject(obj);
  const image = obj instanceof fabric.FabricImage;
  const icon = isIconObject(obj);

  if (readStylePreset(obj) === "glass" && style.stylePreset !== "glass") {
    applyStylePreset(obj, "none");
  }

  obj.set({ opacity: style.opacity ?? 1 });

  if (icon) {
    if (style.fill) applyIconFill(obj, style.fill);
    applyIconStroke(obj, style.stroke ?? "", style.strokeWidth ?? 0);
  } else if (text) {
    const next: Record<string, unknown> = {};
    if (style.fill) next.fill = style.fill;
    if (style.fontFamily) next.fontFamily = style.fontFamily;
    if (style.fontSize != null) next.fontSize = style.fontSize;
    if (style.fontWeight != null) next.fontWeight = style.fontWeight;
    if (style.fontStyle != null) next.fontStyle = style.fontStyle;
    if (style.underline != null) next.underline = style.underline;
    if (style.textAlign) next.textAlign = style.textAlign;
    if (style.lineHeight != null) next.lineHeight = style.lineHeight;
    if (style.charSpacing != null) next.charSpacing = style.charSpacing;
    obj.set(next);
  } else if (image) {
    const radius = style.cornerRadius ?? style.rx;
    if (typeof radius === "number") applyImageCornerRadius(obj, radius);
  } else {
    if (style.fill) obj.set({ fill: style.fill });
    obj.set({
      stroke: style.stroke ?? "",
      strokeWidth: style.strokeWidth ?? 0,
    });
    if (obj instanceof fabric.Rect) {
      const r = style.cornerRadius ?? style.rx;
      if (typeof r === "number") applyRectCornerRadius(obj, r);
    }
  }

  if (style.stylePreset !== "glass") {
    obj.set({
      shadow: style.shadow ? new fabric.Shadow(style.shadow) : null,
    });
    obj.objectCaching = style.shadow != null ? false : obj.objectCaching;
  }

  if (!text) {
    applyStylePreset(obj, style.stylePreset);
    if (style.stylePreset === "glass") {
      applyGlassOptions(obj, style.glassOptions);
    }
  }

  obj.dirty = true;
}

export function selectedCanvasObjects(
  canvas: fabric.Canvas | null | undefined,
  fallback?: fabric.FabricObject | null
): fabric.FabricObject[] {
  if (!canvas) return fallback ? [fallback] : [];
  const objects = canvas.getActiveObjects().filter((obj) => !(obj instanceof fabric.ActiveSelection));
  if (objects.length > 0) return objects;
  const active = canvas.getActiveObject();
  if (active && !(active instanceof fabric.ActiveSelection)) return [active];
  return fallback ? [fallback] : [];
}

export function applyObjectPatch(obj: fabric.FabricObject, props: Record<string, unknown>) {
  const next = { ...props };
  if ("_stylePreset" in next) {
    applyStylePreset(obj, next._stylePreset === "glass" ? "glass" : "none");
    delete next._stylePreset;
  }
  if ("_glassOptions" in next) {
    applyGlassOptions(obj, (next._glassOptions ?? {}) as Partial<GlassOptions>);
    delete next._glassOptions;
  }
  if (isIconObject(obj) && "fill" in next) {
    applyIconFill(obj, String(next.fill ?? ""));
    delete next.fill;
  }
  if (isIconObject(obj) && ("stroke" in next || "strokeWidth" in next)) {
    applyIconStroke(
      obj,
      "stroke" in next ? next.stroke : obj.stroke,
      "strokeWidth" in next ? Number(next.strokeWidth) || 0 : undefined
    );
    delete next.stroke;
    delete next.strokeWidth;
  }
  if ("_id" in next) {
    const taken = collectIds(obj.canvas ?? undefined, obj);
    const value = String(next._id ?? "").trim();
    next._id = value ? uniqueIfTaken(value, taken) : nextUnique(objectKindSlug(obj), taken);
  }
  obj.set(next as Partial<fabric.FabricObject>);
  if ("shadow" in props) {
    obj.objectCaching = props.shadow != null ? false : obj.objectCaching;
    obj.dirty = true;
  }
  if ("_cornerRadius" in props) {
    if (obj instanceof fabric.FabricImage) applyImageCornerRadius(obj, Number(props._cornerRadius) || 0);
    else if (obj instanceof fabric.Rect) applyRectCornerRadius(obj, Number(props._cornerRadius) || 0);
  } else if (
    obj instanceof fabric.Rect &&
    ("stroke" in props || "strokeWidth" in props)
  ) {
    applyRectCornerRadius(obj, readCornerRadius(obj));
  }
  obj.setCoords();
  const parent = obj.group;
  if (parent) {
    parent.dirty = true;
    parent.setCoords();
  }
}
