import * as fabric from "fabric";
import { restoreImageCornerRadii, FABRIC_EXTRA_PROPS } from "./image-radius";
import { isBgImage, restoreLockedBackgrounds } from "./background-image";
import { restoreStylePresets } from "./style-presets";
import { restoreElementGroups } from "./element-group";
import { restoreObjectIdentities } from "./object-identity";
import { hydratePageBackground } from "./design-images";
import { hydrateDesignIconFills } from "./design-icons";
import { applyDesignStylesToCanvas } from "./design-style-sync";
import { documentFromCanvasJson } from "../../design/project";
import { canvasSceneSize, parseFabricJSON } from "../../shared/canvas-json";

export {
  listCanvasAssets,
  parseFabricJSON,
  rewriteLocalAssetUrl,
  sanitizeCanvasJSONString,
  type CanvasAsset,
} from "../../shared/canvas-json";

// Fabric 7 defaults origin to center; keep left/top so existing designs and
// `left`/`top` placement in this editor stay put.
Object.assign(fabric.FabricObject.ownDefaults, { originX: "left", originY: "top" });

fabric.FabricObject.customProperties = [
  ...new Set([...(fabric.FabricObject.customProperties ?? []), ...FABRIC_EXTRA_PROPS]),
];

/** Fabric 6 registers both `Rect` and legacy `rect`. Older seeds still use
 * `image` instead of `src` on Image objects — map that so loadFromJSON can fetch.
 * Dead remote URLs are stripped so Fabric never throws `Error loading <url>`. */

export type LoadFabricOptions = {
  onWarn?: (message: string) => void;
};

function imageElementSize(obj: fabric.FabricImage): { width: number; height: number; src: string } {
  const el = obj.getElement() as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number; src?: string } | null;
  const width = Number(el?.naturalWidth || el?.width || 0);
  const height = Number(el?.naturalHeight || el?.height || 0);
  const src =
    (typeof obj.getSrc === "function" ? obj.getSrc() : "") ||
    (typeof el?.src === "string" ? el.src : "");
  return { width, height, src };
}

export function inspectLoadedImages(canvas: fabric.StaticCanvas | fabric.Canvas): string[] {
  const issues: string[] = [];
  for (const obj of canvas.getObjects()) {
    if (obj instanceof fabric.FabricImage) {
      const { width, src } = imageElementSize(obj);
      if (!width) {
        const kind = isBgImage(obj) ? "background image" : "image";
        issues.push(`${kind} decoded empty (0×0)${src ? `: ${src}` : ""}`);
      }
      continue;
    }
    const fill = obj.fill as { source?: CanvasImageSource } | string | undefined;
    if (fill && typeof fill === "object" && fill.source && typeof fill.source === "object" && "naturalWidth" in fill.source) {
      const w = Number((fill.source as HTMLImageElement).naturalWidth || 0);
      if (!w) issues.push(`pattern fill decoded empty on ${String(obj.type)}`);
    }
  }
  return issues;
}

export async function loadFabricJSON(
  canvas: fabric.StaticCanvas | fabric.Canvas,
  raw: string,
  opts?: LoadFabricOptions
): Promise<void> {
  const wasRendering = canvas.renderOnAddRemove;
  canvas.renderOnAddRemove = false;
  try {
    const parsed = parseFabricJSON(raw);
    const scene = canvasSceneSize(parsed);
    await canvas.loadFromJSON(parsed);
    restoreImageCornerRadii(canvas);
    restoreStylePresets(canvas);
    restoreElementGroups(canvas);
    restoreObjectIdentities(canvas);
    restoreLockedBackgrounds(canvas);
    const doc = documentFromCanvasJson(JSON.stringify(parsed));
    if (doc) {
      applyDesignStylesToCanvas(canvas, doc);
      await hydrateDesignIconFills(canvas, doc);
    }
    // Every load path (page switch, undo, template, thumbnail, headless export,
    // and design-tool reload) must restore the page photo to scene dimensions.
    await hydratePageBackground(canvas, scene?.width, scene?.height);
    for (const issue of inspectLoadedImages(canvas)) {
      opts?.onWarn?.(issue);
      console.warn(issue);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    opts?.onWarn?.(`canvas JSON skipped a failed image/object: ${message}`);
    console.warn("Canvas JSON skipped a failed image/object", err);
  } finally {
    canvas.renderOnAddRemove = wasRendering;
  }
}
