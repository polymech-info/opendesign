import { designPatchFieldHints } from "./patch-keys";
import { serializeDsl } from "./serialize";
import { styleContextBlock } from "./style-context";
import { layoutContextBlock } from "./layout-issues";
import { normalizeUploadKey, uploadPathHints } from "./upload-paths";
import { findNode, type DesignDocument } from "./types";

/** One-line tool card. Schemas stay on the host — --serve ignores client tools[]. */
export function designToolHints(): string {
  return [
    "design_query query=\"type=txt role=title\"",
    "design_get ids=[\"feature.search\"] include_children=true",
    "design_update where=id=feature.search.title set={\"text\":\"Audio Player\"}",
    "design_update patches=[{id,set}] or where=… set=…",
    "design_copy_styles from=feature.chat to=feature.local — copy card glass/fill/shadow to another instance",
    designPatchFieldHints(),
    "design_create objects=[{type,id,x,y,w,h,fill,glass,shadow}] behind=true — pane under cards",
    "design_use_widget widget id x y bindings={icon,title,caption,body}",
    "design_search_icons query=\"audio\" source=local — only when you need icon candidates; prefer known ids (shield, lock, message-circle)",
    "design_delete where=id=feature.search — deletes widget instance + children (use ids)",
    "design_set_page_background src=uploads/backgrounds/hero-v1.png",
    "design_insert_image id=hero.photo src=uploads/product-v1.png x=200 y=120 w=800 h=600",
    'image_create output_path uploads/backgrounds/hero-v1.png options={prompt:"…"} — host auto-applies page bg',
    'image_create output_path uploads/product-v1.png — host auto-applies design_insert_image',
    "image_transform paths=[uploads/…/v1.png] output_path uploads/…/v2.png apply={replace_id:hero.photo} — replace selected img",
    "image_create output_path uploads/hero-v2.png apply={id:hero.photo} — replaces selected image when SELECTION matches",
    uploadPathHints(),
    "design_export format=dsl|json",
    "design_screenshot — LAST RESORT when SCENE/STYLES/design_query cannot explain overlap, stacking, or clipped text. Host writes uploads/screenshots/canvas.jpg. Then emit image_understand with that exact path.",
    'image_understand paths=["uploads/screenshots/canvas.jpg"] prompt="…" — copy the path exactly; host does not attach pixels to chat.',
  ].join("\n");
}

export type DesignBriefOpts = {
  selectionIds?: string[];
};

function selectionLine(ids: string[], doc: DesignDocument): string {
  const parts = ids.map((id) => {
    const node = findNode(doc, id);
    if (node?.type === "img") {
      const src = node.src ? normalizeUploadKey(node.src) : "";
      return src ? `${id} type=img src=${src}` : `${id} type=img`;
    }
    return id;
  });
  const base = `SELECTION: ${parts.join(", ")}`;
  if (ids.some((id) => id.endsWith(".bg"))) {
    return `${base} (card background — edit icon with ${ids.map((id) => id.replace(/\.bg$/, ".icon")).join(", ")})`;
  }
  return base;
}

/**
 * Single chat context block: tools + live DSL + selection.
 * Not a second inject stack — this *is* the scene the agent should edit.
 */
export function designChatBrief(doc: DesignDocument, opts?: DesignBriefOpts): string {
  const selection = (opts?.selectionIds ?? []).map((id) => id.trim()).filter(Boolean);
  return [
    "You are editing a live OpenDesign canvas. The source is the Design DSL below — not workspace files. Screenshot JPEGs are only for image_understand.",
    "Do not use file/image/MCP editors or claim tools are unavailable — emit JSON below; the host runs it.",
    "Emit compact JSON tool calls (no prose, no scene inventory, no markdown tables, no \"Done.\"). Keep bindings short (≤40 chars each).",
    "Several design_* in one {\"tool_calls\":[...]} array is OK (update + delete + copy_styles). Do not glue an old image_* blob in front.",
    "x/y/w/h are CANVAS pixels. Never copy props.x=0/24/108 from widget slots onto children — that parks cards at the origin. Move a card via the use id (feature.local), not .bg/.title.",
    "SCOPE: when the user says one/this/selected card, target the SELECTION use id only. Never broaden it to where=type=txt, all cards, or every child.",
    "ALIGNMENT: align/line up a card means geometry (x/y on its use id, compared with peer use ids). The txt field align is only left/center/right text alignment; use it only when the user explicitly asks to align text.",
    "To put a glass pane behind feature cards: design_create behind=true with fill/glass (do not dump node lists).",
    "Never combine design_search_icons + design_use_widget. Do not design_export unless the user asks to export.",
    "Prefer SCENE + design_query/design_get. design_screenshot is a last resort after those fail — do not screenshot first or after every edit. After a screenshot path, emit image_understand yourself (host will not send the image).",
    '{"name":"design_update","arguments":{"patches":[{"id":"feature.chat.title","set":{"fill":"#0f172a"}}]}}',
    '{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.security","x":524,"y":80,"bindings":{"icon":"shield","title":"Security","caption":"Protection","body":"Manage access."}}}',
    "TOOLS:",
    designToolHints(),
    selection.length ? selectionLine(selection, doc) : "SELECTION: none",
    styleContextBlock(doc),
    layoutContextBlock(doc),
    "SCENE:",
    serializeDsl(doc).trimEnd(),
  ].join("\n");
}
