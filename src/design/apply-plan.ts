export type CanvasPatchPlan = {

  mode: "none" | "patch" | "full";

  images?: Array<{ id: string; url: string }>;

  /** undefined = unchanged, null = clear, string = new src url */

  pageBackground?: string | null;

  /** Re-project style + bounds onto existing canvas objects (no full reload). */

  styleNodeIds?: string[];

};



type ToolRun = { name: string; result: unknown };



function rec(result: unknown): Record<string, unknown> {

  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};

}



const PATCHABLE = new Set([

  "design_update",

  "design_copy_styles",

  "design_set_page_background",

  "design_search_icons",

]);



const INSPECT = new Set([

  "design_screenshot",

  "design_export",

  "design_query",

  "design_get",

  "image_understand",

]);



/** Prefer in-canvas src patch over full reload when only image/page-bg URLs changed. */

export function planCanvasApply(runs: ToolRun[]): CanvasPatchPlan {

  const images: Array<{ id: string; url: string }> = [];

  const styleNodeIds: string[] = [];

  let pageBackground: string | null | undefined;



  for (const { name, result } of runs) {

    if (name === "image_create" || name === "image_transform" || name === "transform") continue;

    if (INSPECT.has(name)) continue;

    const r = rec(result);

    if (r.ok === false) return { mode: "full" };



    if (name === "design_update" || name === "design_copy_styles") {

      const touched = Array.isArray(r.touched) ? r.touched.map(String).filter(Boolean) : [];

      if (touched.length) {

        styleNodeIds.push(...touched);

        continue;

      }

      const matched = Number(r.matched ?? 0);

      const diff = Array.isArray(r.diff) ? r.diff : [];

      if (!diff.length) {

        if (matched > 0) return { mode: "full" };

        continue;

      }

      for (const row of diff) {

        const d = row as Record<string, unknown>;

        const id = String(d.id ?? "");

        const src = d.src as { to?: string } | undefined;

        if (src?.to && id && id !== "canvas.photo") {

          images.push({ id, url: String(src.to) });

          continue;

        }

        return { mode: "full" };

      }

      continue;

    }



    if (name === "design_set_page_background") {

      const diff = Array.isArray(r.diff) ? r.diff : [];

      const row = diff[0] as { src?: { to?: string } } | undefined;

      pageBackground = row?.src?.to ? String(row.src.to) : null;

      continue;

    }



    if (name === "design_insert_image" || name === "design_create" || name === "design_delete" || name === "design_use_widget") {

      return { mode: "full" };

    }



    if (name.startsWith("design_") && !PATCHABLE.has(name)) {

      return { mode: "full" };

    }

  }



  const uniqueStyles = [...new Set(styleNodeIds)];

  if (images.length || pageBackground !== undefined || uniqueStyles.length) {

    return {

      mode: "patch",

      images: images.length ? images : undefined,

      pageBackground,

      styleNodeIds: uniqueStyles.length ? uniqueStyles : undefined,

    };

  }

  return { mode: "none" };

}


