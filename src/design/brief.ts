import { designPatchFieldHints } from "./patch-keys";
import { serializeDsl } from "./serialize";
import { styleContextBlock } from "./style-context";
import { layoutContextBlock } from "./layout-issues";
import { normalizeUploadKey, pictureUnderstandPath, uploadPathHints } from "./upload-paths";
import { findNode, type DesignDocument } from "./types";

/** One-line tool card. Schemas live on the Tanit host provider — chat does not emit JSON. */
export function designToolHints(): string {
  return [
    "design_query query=\"type=txt role=title\"",
    "design_get ids=[\"feature.search\"] include_children=true",
    "design_update where=id=feature.search.title set={\"text\":\"Audio Player\"}",
    "design_update patches=[{id,set}] or where=… set=…",
    "design_update where=type=shape|type=txt layout={type:\"fit\"} — scale a selection to the canvas; or transform={scale:1.4,origin:{x,y}}",
    "design_query fields are x,y,w,h,fill (width/height/color also work). id^=ttt.circle matches prefixes; id=ttt.circle does not.",
    "design_copy_styles from=feature.chat to=feature.local — copy card glass/fill/shadow to another instance",
    designPatchFieldHints(),
    "design_create objects=[{type,id,x,y,w,h,fill,glass,shadow}] behind=true — small pane under cards, never a full-page frame",
    "design_use_widget widget id x y bindings={icon,title,caption,body}",
    "design_search_icons query=\"audio\" — one word only (Iconify rejects phrases like \"security shield\"); prefer known ids (shield, lock, message-circle)",
    "design_delete where=id=feature.search — deletes widget instance + children (use ids)",
    "design_set_page_background src=uploads/backgrounds/hero-v1.png",
    "design_insert_image id=hero.photo src=uploads/product-v1.png x=200 y=120 w=800 h=600",
    'image_create output_path uploads/backgrounds/hero-v1.png options={prompt:"…"} — then design_set_page_background',
    "image_create output_path uploads/product-v1.png — then design_insert_image with that path",
    "image_transform paths=[uploads/…/v1.png] output_path uploads/…/v2.png — editor replaces the selected/source img src; do not stop at writing a file",
    uploadPathHints(),
    "design_screenshot — live canvas JPEG path for image_understand. Page background: image_create output_path=uploads/backgrounds/… then design_set_page_background. Never design_create a full-page shape as the background.",
    'image_understand paths=["<absolute path from PICTURES>"] prompt="…" — copy the path exactly; chat pixels are not attached.',
  ].join("\n");
}

export type ProjectGuides = {
  styleGuide?: string;
  skill?: string;
};

export type DesignBriefAttachment = {
  name?: string;
  src: string;
};

export type DesignBriefOpts = {
  selectionIds?: string[];
  guides?: ProjectGuides;
  /** Absolute `.OpenDesign` folder (Tanit cwd). Used to list PICTURES. */
  projectRoot?: string;
  /** Chat attachments already written under uploads/. */
  attachments?: DesignBriefAttachment[];
};

type PictureRow = {
  role: "attached" | "selection" | "canvas" | "background";
  id?: string;
  name?: string;
  path: string;
};

const MAX_PICTURES = 24;

function collectBriefPictures(doc: DesignDocument, opts?: DesignBriefOpts): PictureRow[] {
  const seen = new Set<string>();
  const rows: PictureRow[] = [];
  const add = (row: PictureRow) => {
    const key = row.path.replace(/\\/g, "/").toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  for (const att of opts?.attachments ?? []) {
    const path = pictureUnderstandPath(opts?.projectRoot, att.src);
    if (path) add({ role: "attached", name: att.name, path });
  }

  for (const id of opts?.selectionIds ?? []) {
    const node = findNode(doc, id);
    if (node?.type !== "img" || !node.src) continue;
    const path = pictureUnderstandPath(opts?.projectRoot, node.src);
    if (path) add({ role: "selection", id: node.id, path });
  }

  if (doc.pageBackground) {
    const path = pictureUnderstandPath(opts?.projectRoot, doc.pageBackground);
    if (path) add({ role: "background", id: "canvas.photo", path });
  }

  for (const node of doc.nodes) {
    if (node.type !== "img" || !node.src) continue;
    const path = pictureUnderstandPath(opts?.projectRoot, node.src);
    if (path) add({ role: "canvas", id: node.id, path });
  }

  return rows.slice(0, MAX_PICTURES);
}

/** Disk paths for `image_understand`: selection, else chat attachments, else the only canvas image. */
export function understandPicturePaths(doc: DesignDocument, opts?: DesignBriefOpts): string[] {
  const rows = collectBriefPictures(doc, opts);
  const selected = rows.filter((r) => r.role === "selection").map((r) => r.path);
  if (selected.length) return selected;
  const attached = rows.filter((r) => r.role === "attached").map((r) => r.path);
  if (attached.length) return attached;
  const rest = rows.filter((r) => r.role === "canvas" || r.role === "background");
  return rest.length === 1 ? [rest[0].path] : [];
}

function formatPictureRow(row: PictureRow): string {
  const bits = [row.role, row.path];
  if (row.id) bits.push(`id=${row.id}`);
  if (row.name) bits.push(`name=${row.name}`);
  return bits.join("  ");
}

function picturesBlock(doc: DesignDocument, opts?: DesignBriefOpts): string[] {
  const rows = collectBriefPictures(doc, opts);
  if (!rows.length) {
    return [
      "PICTURES: none on disk.",
      "Chat image pixels are not visible. Do not use info_lookup to find a picture. If the user asks what is in a picture and no path is listed, say so after checking SCENE — do not claim tools are missing.",
    ];
  }
  return [
    "PICTURES (absolute disk paths — copy into image_understand; Tanit cwd is this .OpenDesign folder):",
    ...rows.map(formatPictureRow),
    "If the user says this/the picture, what's in this image, or describe the photo: call image_understand with that absolute path (attached or selection first, else the only canvas image). Do not use info_lookup. Do not say you cannot see the picture.",
  ];
}

function projectGuideBlock(guides?: ProjectGuides): string[] {
  const blocks: string[] = [];
  const style = guides?.styleGuide?.trim();
  const skill = guides?.skill?.trim();
  if (style) blocks.push("STYLE_GUIDE (.OpenDesign/style_guide.md):", style);
  if (skill) blocks.push("SKILL (.OpenDesign/SKILL.md):", skill);
  return blocks;
}

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
    "You are editing a live OpenDesign canvas. The source is the Design DSL below — not workspace files. You cannot see chat image pixels; PICTURES lists disk files for image_understand.",
    "The editor is connected. Never say there is no UI, no scene, or no selection when DESIGN / SCENE / SELECTION is present. Do not call info_lookup or app_command for canvas state.",
    "If the user asks what is selected, answer from SELECTION. If they ask what is in the scene / on the canvas, answer from SCENE or call design_query.",
    "An empty SCENE is still the live canvas. Call design_use_widget (feature-group) or design_create — do not say no document is open, and do not call create_design / MCP.",
    "design_* and image_understand are native tools on this turn. Call them, then answer the user in prose. Do not emit fake JSON tool_calls or say tools are unavailable.",
    "Keep bindings short (≤40 chars each). After image_understand, if the user only asked what is in the picture, answer from that result.",
    "x/y/w/h are CANVAS pixels. Never copy props.x=0/24/108 from widget slots onto children — that parks cards at the origin. Move a card via the use id (feature.local), not .bg/.title.",
    "SCOPE: when the user says one/this/selected card, target the SELECTION use id only. Never broaden it to where=type=txt, all cards, or every child.",
    "ALIGNMENT: align/line up a card means geometry (x/y on its use id, compared with peer use ids). The txt field align is only left/center/right text alignment; use it only when the user explicitly asks to align text.",
    "To put a glass pane behind feature cards: design_create behind=true with fill/glass (do not dump node lists).",
    "A page background is design_set_page_background, not a new full-canvas shape. Full-page frames cover the scene.",
    "Never combine design_search_icons + design_use_widget. Do not design_export unless the user asks to export.",
    "Prefer SCENE + design_query/design_get. For a visual read of the whole canvas, call design_screenshot then image_understand with that exact path.",
    ...projectGuideBlock(opts?.guides),
    "TOOLS:",
    designToolHints(),
    ...picturesBlock(doc, opts),
    selection.length ? selectionLine(selection, doc) : "SELECTION: none",
    styleContextBlock(doc),
    layoutContextBlock(doc),
    "SCENE:",
    serializeDsl(doc).trimEnd(),
  ].join("\n");
}
