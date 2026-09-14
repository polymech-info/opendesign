import * as fabric from "fabric";
import { applyImageCornerRadius, applyRectCornerRadius, readCornerRadius, readImageCornerRadius } from "./image-radius";
import { collectIds, uniqueIfTaken, nextUnique, objectKindSlug } from "./object-identity";
import {
  applyBorderOptions,
  applyGlassOptions,
  applyStylePreset,
  DEFAULT_BORDER_OPTIONS,
  DEFAULT_GLASS_OPTIONS,
  readBorderOptions,
  readGlassOptions,
  readStylePreset,
  usesOverlayPreset,
  type BorderOptions,
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

export type CopiedShadow = {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  affectStroke: boolean;
  nonScaling: boolean;
};

export type CopiedObjectStyle = {
  fill?: unknown;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  shadow: CopiedShadow | null;
  rx?: number;
  ry?: number;
  cornerRadius?: number;
  stylePreset: StylePresetId;
  glassOptions: GlassOptions;
  borderOptions: BorderOptions;
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

function snapshotShadow(obj: fabric.FabricObject): CopiedShadow | null {
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
    affectStroke: !!shadow.affectStroke,
    nonScaling: !!shadow.nonScaling,
  };
}

function clonePaint(fill: unknown): unknown {
  if (fill == null || typeof fill === "string") return fill;
  if (typeof fill !== "object" || typeof (fill as { toObject?: () => unknown }).toObject !== "function") {
    return undefined;
  }
  try {
    const data = (fill as { toObject: () => Record<string, unknown> }).toObject();
    if (data && (data.type === "linear" || data.type === "radial" || "colorStops" in data)) {
      return new fabric.Gradient(data as ConstructorParameters<typeof fabric.Gradient>[0]);
    }
  } catch {
    /* keep string/backup fill */
  }
  return undefined;
}

export function serializeCopiedStyle(style: CopiedObjectStyle): Record<string, unknown> {
  const fill =
    style.fill == null || typeof style.fill === "string"
      ? style.fill
      : typeof style.fill === "object" && typeof (style.fill as { toObject?: () => unknown }).toObject === "function"
        ? (style.fill as { toObject: () => unknown }).toObject()
        : undefined;
  return { ...style, fill };
}

export function hydrateCopiedStyle(raw: unknown): CopiedObjectStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<CopiedObjectStyle> & { fill?: unknown };
  const fill = clonePaint(rec.fill) ?? (typeof rec.fill === "string" ? rec.fill : undefined);
  return {
    fill,
    stroke: rec.stroke,
    strokeWidth: rec.strokeWidth,
    opacity: rec.opacity,
    shadow: rec.shadow ?? null,
    rx: rec.rx,
    ry: rec.ry,
    cornerRadius: rec.cornerRadius,
    stylePreset: rec.stylePreset ?? "none",
    glassOptions: { ...DEFAULT_GLASS_OPTIONS, ...rec.glassOptions },
    borderOptions: { ...DEFAULT_BORDER_OPTIONS, ...rec.borderOptions },
    fontFamily: rec.fontFamily,
    fontSize: rec.fontSize,
    fontWeight: rec.fontWeight,
    fontStyle: rec.fontStyle,
    underline: rec.underline,
    textAlign: rec.textAlign,
    lineHeight: rec.lineHeight,
    charSpacing: rec.charSpacing,
  };
}

export function styleSwatchCss(style: CopiedObjectStyle): string {
  if (style.stylePreset === "glass") {
    return "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(160,200,255,0.12))";
  }
  if (style.stylePreset === "border") {
    return "linear-gradient(180deg, rgba(255,255,255,0.12), transparent)";
  }
  if (typeof style.fill === "string" && style.fill) return style.fill;
  return "#e2e8f0";
}

function snapshotFill(obj: fabric.FabricObject, icon: boolean, backupFill: unknown): unknown {
  if (icon) return readIconFill(obj);
  const live = obj.fill;
  if (typeof live === "string" && live) return live;
  const cloned = clonePaint(live);
  if (cloned != null) return cloned;
  return typeof backupFill === "string" ? backupFill : undefined;
}

function applyCopiedShadow(obj: fabric.FabricObject, style: CopiedObjectStyle) {
  const next = style.shadow
    ? new fabric.Shadow({
        color: style.shadow.color,
        blur: style.shadow.blur,
        offsetX: style.shadow.offsetX,
        offsetY: style.shadow.offsetY,
        affectStroke: style.shadow.affectStroke,
        nonScaling: style.shadow.nonScaling,
      })
    : null;
  obj.set({ shadow: next });
  obj.objectCaching = next != null ? false : obj.objectCaching;
  const backup = (obj as { _stylePresetBackup?: { shadow?: fabric.FabricObject["shadow"] } })._stylePresetBackup;
  if (backup) backup.shadow = next;
}

export function captureObjectStyle(obj: fabric.FabricObject): CopiedObjectStyle {
  const text = isTextObject(obj);
  const image = obj instanceof fabric.FabricImage;
  const icon = isIconObject(obj);
  const stylePreset = readStylePreset(obj);
  const backup = (obj as { _stylePresetBackup?: { fill?: unknown; stroke?: unknown; strokeWidth?: number } })
    ._stylePresetBackup;
  const liveStroke = icon
    ? readIconStroke(obj)
    : typeof obj.stroke === "string"
      ? obj.stroke
      : undefined;
  const liveStrokeWidth = icon ? readIconStrokeWidth(obj) : obj.strokeWidth || 0;
  const stroke = liveStroke || (typeof backup?.stroke === "string" ? backup.stroke : undefined);
  const strokeWidth =
    liveStrokeWidth ||
    (typeof backup?.strokeWidth === "number" ? backup.strokeWidth : 0);
  const style: CopiedObjectStyle = {
    fill: snapshotFill(obj, icon, backup?.fill),
    stroke,
    strokeWidth,
    opacity: obj.opacity ?? 1,
    shadow: snapshotShadow(obj),
    stylePreset,
    glassOptions: readGlassOptions(obj),
    borderOptions: readBorderOptions(obj),
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

  if (usesOverlayPreset(readStylePreset(obj)) && !usesOverlayPreset(style.stylePreset)) {
    applyStylePreset(obj, "none");
  }

  obj.set({ opacity: style.opacity ?? 1 });

  if (icon) {
    if (typeof style.fill === "string" && style.fill) applyIconFill(obj, style.fill);
    applyIconStroke(obj, style.stroke ?? "", style.strokeWidth ?? 0);
  } else if (text) {
    const next: Record<string, unknown> = {};
    if (typeof style.fill === "string" && style.fill) next.fill = style.fill;
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
    if (style.fill != null && style.fill !== "") obj.set({ fill: style.fill as fabric.FabricObject["fill"] });
    obj.set({
      stroke: style.stroke ?? "",
      strokeWidth: style.strokeWidth ?? 0,
    });
    if (obj instanceof fabric.Rect) {
      const r = style.cornerRadius ?? style.rx;
      if (typeof r === "number") applyRectCornerRadius(obj, r);
    }
  }

  if (!text) {
    applyStylePreset(obj, style.stylePreset);
    if (style.stylePreset === "glass") {
      applyGlassOptions(obj, style.glassOptions);
      if (!icon && !image && style.fill != null && style.fill !== "") {
        obj.set({ fill: style.fill as fabric.FabricObject["fill"] });
      }
      if (!icon && !image) {
        obj.set({
          stroke: style.stroke ?? "",
          strokeWidth: style.strokeWidth ?? 0,
        });
      }
    }
    if (style.stylePreset === "border") {
      applyBorderOptions(obj, style.borderOptions);
    }
  }

  applyCopiedShadow(obj, style);
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

const STYLE_PATCH_KEYS = new Set([
  "fill",
  "stroke",
  "strokeWidth",
  "rx",
  "ry",
  "_cornerRadius",
  "shadow",
  "objectCaching",
  "_stylePreset",
  "_glassOptions",
  "_borderOptions",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "textAlign",
  "_iconFill",
  "_iconName",
  "_iconUrl",
  "src",
  "opacity",
  "visible",
  "text",
]);

/** Strip geometry / identity from projected Fabric JSON — safe for live style sync. */
export function pickStylePatchProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (STYLE_PATCH_KEYS.has(key)) out[key] = value;
  }
  return out;
}

export function applyObjectPatch(obj: fabric.FabricObject, props: Record<string, unknown>) {
  const next = { ...props };
  delete next.type;
  delete next.version;
  if (!isIconObject(obj)) delete next.src;
  if ("_stylePreset" in next) {
    applyStylePreset(obj, String(next._stylePreset) as StylePresetId);
    delete next._stylePreset;
  }
  if ("_glassOptions" in next) {
    applyGlassOptions(obj, (next._glassOptions ?? {}) as Partial<GlassOptions>);
    delete next._glassOptions;
  }
  if ("_borderOptions" in next) {
    applyBorderOptions(obj, (next._borderOptions ?? {}) as Partial<BorderOptions>);
    delete next._borderOptions;
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
  if (usesOverlayPreset(readStylePreset(obj)) && ("fill" in props || "stroke" in props || "strokeWidth" in props)) {
    const styled = obj as fabric.FabricObject & {
      _stylePresetBackup?: {
        fill: unknown;
        stroke: unknown;
        strokeWidth: number;
        shadow: fabric.FabricObject["shadow"];
        objectCaching: boolean;
        rx?: number;
        ry?: number;
      };
    };
    const prev = styled._stylePresetBackup;
    styled._stylePresetBackup = {
      fill: "fill" in props ? obj.fill : prev?.fill ?? obj.fill,
      stroke: "stroke" in props ? obj.stroke : prev?.stroke ?? obj.stroke,
      strokeWidth: "strokeWidth" in props ? obj.strokeWidth || 0 : prev?.strokeWidth ?? (obj.strokeWidth || 0),
      shadow: prev?.shadow ?? obj.shadow ?? null,
      objectCaching: prev?.objectCaching ?? obj.objectCaching,
      rx: obj instanceof fabric.Rect ? obj.rx : prev?.rx,
      ry: obj instanceof fabric.Rect ? obj.ry : prev?.ry,
    };
  }
  if ("text" in props) obj.dirty = true;
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
