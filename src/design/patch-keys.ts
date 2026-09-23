import type { DesignNode, NodeType } from "./types";

const GEOM = new Set(["x", "y", "w", "h", "width", "height"]);

/** Fields design_update can set that reach the Fabric canvas (per node type). */
export const PROJECTABLE_FIELDS: Record<NodeType, readonly string[]> = {
  canvas: [],
  theme: [],
  widget: [],
  use: ["x", "y", "w", "h"],
  shape: ["fill", "stroke", "strokeWidth", "radius", "shadow", "glass", "glassOptions", "border", "borderOptions", "preset", "gradient", "gradientMask"],
  txt: ["fill", "size", "font", "weight", "align", "text", "style", "shadow", "preset", "gradient", "gradientMask"],
  icon: ["icon", "fill", "shadow"],
  img: ["src", "fit", "gradient", "gradientMask"],
  line: [],
  group: [],
  video: [],
  path: [],
};

/** Editor / Fabric-only — not in IR projection (warn if model tries). */
export const EDITOR_ONLY_FIELDS = [
  "_stylePreset",
  "opacity",
  "pattern",
  "blur",
  "tint",
] as const;

export function designPatchFieldHints(): string {
  return [
    "shape.bg: fill, stroke, strokeWidth, radius, shadow={x,y,blur,color}|soft|hard, glass=true, glassOptions={...}, border=true|line|rim, borderOptions={...}",
    "txt: fill, size, font, weight, align (textAlign only), text, style, shadow",
    "icon: fill, icon (glyph id), shadow",
    "preset card.soft etc. merge under node.props overrides",
    "NOT projected: opacity, raw _stylePreset (use glass=true or border=true on shapes)",
  ].join("\n");
}

/** Normalize model-facing patch keys to IR/projection keys. */
export function normalizePatchKey(node: DesignNode, key: string): string {
  if (key === "width") return "w";
  if (key === "height") return "h";
  if (key === "color" && (node.type === "txt" || node.type === "shape" || node.type === "icon")) return "fill";
  return key;
}

/** Whether a patch key affects Fabric projection for this node type. */
export function patchKeyProjects(node: DesignNode, key: string): boolean {
  const k = normalizePatchKey(node, key);
  if (GEOM.has(k) || k === "role") return true;
  const allowed = PROJECTABLE_FIELDS[node.type] ?? [];
  return allowed.includes(k);
}

export function patchFieldWarning(node: DesignNode, key: string): string | null {
  if (patchKeyProjects(node, key)) return null;
  if (key === "color" && node.type === "icon") {
    return "use fill (not color) on icons — e.g. set.fill=\"#2563eb\"";
  }
  if (key === "color") {
    return `field '${key}' is not projected for type=${node.type} — use fill for text/shape colors`;
  }
  if ((EDITOR_ONLY_FIELDS as readonly string[]).includes(key)) {
    return `field '${key}' is editor-only (glass/gradient) — not in design IR projection`;
  }
  const hint = (PROJECTABLE_FIELDS[node.type] ?? []).join(", ");
  return `field '${key}' is not projected for type=${node.type}${hint ? ` — try: ${hint}` : ""}`;
}

/** Serialize patch values for IR props (objects → JSON string). */
export function coercePropValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
