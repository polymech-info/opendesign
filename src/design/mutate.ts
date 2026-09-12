import { coercePropValue, normalizePatchKey, patchFieldWarning } from "./patch-keys";
import { STYLE_PROPS } from "./props-sync";
import { matchingNodes } from "./query";
import { resolveUploadKey, uploadPublicUrl } from "./upload-paths";
import { cloneDocument, findNode, type DesignDocument, type DesignNode, type NodeType } from "./types";
import { instantiateWidget } from "./parse";

export type Patch = { id: string; set: Record<string, unknown> };

export type LayoutArgs = {
  type?: string;
  gap?: number;
  gap_x?: number;
  gap_y?: number;
  cols?: number;
  area?: { x?: number; y?: number; w?: number; h?: number };
};

export type UpdateArgs = {
  where?: string;
  set?: Record<string, unknown>;
  transform?: Record<string, string | number>;
  replace?: Record<string, string>;
  layout?: LayoutArgs;
  patches?: Patch[];
  dry_run?: boolean;
};

export type CreateObject = {
  type: NodeType;
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  width?: number;
  height?: number;
  role?: string;
  preset?: string;
  style?: string;
  text?: string;
  src?: string;
  parent?: string;
  /** Insert under existing cards / images (page photo stays at the back). */
  behind?: boolean;
};

export type ToolResult = {
  ok: boolean;
  matched?: number;
  changed?: number;
  /** Node ids targeted by the op (for in-canvas style sync without full reload). */
  touched?: string[];
  created?: string[];
  deleted?: string[];
  diff?: Array<Record<string, unknown>>;
  errors?: Array<{ id?: string; operation?: number; error: string }>;
  warnings?: Array<{ id?: string; field?: string; warning: string }>;
  objects?: Record<string, unknown>[];
};

const GEOM = new Set(["x", "y", "w", "h"]);

function canvasGeom(doc: DesignDocument | undefined, node: DesignNode, key: string, n: number): number {
  if (!doc || !node.parentId || (key !== "x" && key !== "y")) return n;
  const parent = findNode(doc, node.parentId);
  if (!parent) return n;
  const origin = key === "x" ? parent.bounds.x : parent.bounds.y;
  const size = key === "x" ? parent.bounds.w : parent.bounds.h;
  if (n >= origin && n <= origin + size + 48) return n;
  if (n >= 0 && n <= size) return origin + n;
  return n;
}

function applyScalar(
  node: DesignNode,
  key: string,
  value: unknown,
  doc?: DesignDocument,
): { from: unknown; to: unknown } | null {
  key = normalizePatchKey(node, key);
  const next = coercePropValue(value);
  if (GEOM.has(key)) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    const n = canvasGeom(doc, node, key, raw);
    const from = node.bounds[key as keyof typeof node.bounds];
    if (from === n) return null;
    node.bounds[key as keyof typeof node.bounds] = n;
    return { from, to: n };
  }
  if (key === "preset") {
    const from = node.preset;
    if (from === next) return null;
    node.preset = next;
    return { from, to: next };
  }
  if (key === "style") {
    const from = node.style;
    if (from === next) return null;
    node.style = next;
    return { from, to: next };
  }
  if (key === "role") {
    const from = node.role;
    if (from === next) return null;
    node.role = next;
    return { from, to: next };
  }
  if (key === "text") {
    const from = node.textBinding ? `@${node.textBinding}` : node.text;
    if (typeof next === "string" && next.startsWith("@")) {
      node.textBinding = next.slice(1);
      node.text = undefined;
    } else {
      node.textBinding = undefined;
      node.text = next;
    }
    if (from === (node.textBinding ? `@${node.textBinding}` : node.text)) return null;
    return { from, to: node.textBinding ? `@${node.textBinding}` : node.text };
  }
  if (key === "src") {
    const from = node.imageBinding ? `@${node.imageBinding}` : node.src;
    if (typeof next === "string" && next.startsWith("@")) {
      node.imageBinding = next.slice(1);
      node.src = undefined;
    } else {
      node.imageBinding = undefined;
      node.src = next;
    }
    return { from, to: node.imageBinding ? `@${node.imageBinding}` : node.src };
  }
  const from = node.props[key];
  if (next == null) {
    delete node.props[key];
  } else {
    node.props[key] = next;
  }
  if (from === next) return null;
  return { from, to: next };
}

function coerceTransformExpr(expr: unknown): string {
  if (expr == null) return "";
  if (typeof expr === "number" && Number.isFinite(expr)) return expr >= 0 ? `+${expr}` : String(expr);
  if (typeof expr === "object") {
    const rec = expr as Record<string, unknown>;
    const value = Number(rec.value ?? rec.n ?? rec.by ?? rec.amount);
    const op = String(rec.op ?? rec.operator ?? "add").toLowerCase();
    if (!Number.isFinite(value)) return "";
    if (op === "add" || op === "plus") return `+${value}`;
    if (op === "sub" || op === "subtract" || op === "minus") return `-${value}`;
    if (op === "mul" || op === "multiply") return `*${value}`;
    if (op === "div" || op === "divide") return `/${value}`;
    if (op === "set") return String(value);
  }
  return String(expr);
}

function applyTransform(node: DesignNode, key: string, expr: unknown): { from: unknown; to: unknown } | null {
  if (key === "width") key = "w";
  if (key === "height") key = "h";
  if (!GEOM.has(key)) return null;
  const cur = node.bounds[key as keyof typeof node.bounds];
  const raw = coerceTransformExpr(expr).trim();
  const m = raw.match(/^([+*/-])\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return applyScalar(node, key, raw);
  const op = m[1];
  const n = Number(m[2]);
  let next = cur;
  if (op === "+") next = cur + n;
  else if (op === "-") next = cur - n;
  else if (op === "*") next = cur * n;
  else if (op === "/") next = n === 0 ? cur : cur / n;
  if (next < 0 && (key === "w" || key === "h")) return { from: cur, to: next };
  return applyScalar(node, key, next);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function flattenCreate(spec: CreateObject): CreateObject {
  const rec = spec as CreateObject & {
    size?: unknown;
    position?: unknown;
    pos?: unknown;
  };
  const size = rec.size && typeof rec.size === "object" ? (rec.size as Record<string, unknown>) : null;
  const position =
    rec.position && typeof rec.position === "object"
      ? (rec.position as Record<string, unknown>)
      : rec.pos && typeof rec.pos === "object"
        ? (rec.pos as Record<string, unknown>)
        : null;
  let w = rec.w ?? rec.width;
  let h = rec.h ?? rec.height;
  if (typeof rec.size === "string") {
    const m = rec.size.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
    if (m) {
      w = w ?? Number(m[1]);
      h = h ?? Number(m[2]);
    }
  }
  if (size) {
    w = w ?? num(size.w ?? size.width, Number.NaN);
    h = h ?? num(size.h ?? size.height, Number.NaN);
  }
  return {
    ...rec,
    x: rec.x ?? (position ? num(position.x) : 0),
    y: rec.y ?? (position ? num(position.y) : 0),
    w: Number.isFinite(Number(w)) ? Number(w) : 0,
    h: Number.isFinite(Number(h)) ? Number(h) : 0,
  };
}

function propsFromCreateSpec(spec: CreateObject): Record<string, string> {
  const rec = spec as Record<string, unknown>;
  const props: Record<string, string> = {};
  for (const key of STYLE_PROPS) {
    if (rec[key] == null) continue;
    const next = coercePropValue(rec[key]);
    if (next != null) props[key] = next;
  }
  return props;
}

const STACK_SKIP = new Set<NodeType>(["canvas", "theme", "widget", "use"]);

function insertCreatedNode(doc: DesignDocument, node: DesignNode, behind: boolean) {
  if (!behind) {
    doc.nodes.push(node);
    return;
  }
  const idx = doc.nodes.findIndex((n) => !STACK_SKIP.has(n.type));
  if (idx < 0) doc.nodes.push(node);
  else doc.nodes.splice(idx, 0, node);
}

function restackNodeBehind(doc: DesignDocument, id: string) {
  const idx = doc.nodes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const [node] = doc.nodes.splice(idx, 1);
  insertCreatedNode(doc, node, true);
}

function objectFromSpec(spec: CreateObject): DesignNode {
  const flat = flattenCreate(spec);
  const text = flat.text;
  const src = flat.src;
  return {
    id: flat.id,
    type: flat.type,
    parentId: flat.parent,
    role: flat.role,
    bounds: {
      x: flat.x ?? 0,
      y: flat.y ?? 0,
      w: flat.w ?? 0,
      h: flat.h ?? 0,
    },
    preset: flat.preset,
    style: flat.style,
    props: propsFromCreateSpec(flat),
    text: text?.startsWith("@") ? undefined : text,
    textBinding: text?.startsWith("@") ? text.slice(1) : undefined,
    src: src?.startsWith("@") ? undefined : src,
    imageBinding: src?.startsWith("@") ? src.slice(1) : undefined,
    children: [],
  };
}

export function createObjects(
  doc: DesignDocument,
  objects: CreateObject[],
  dryRun = false,
  opts?: { behind?: boolean },
): ToolResult {
  const errors: ToolResult["errors"] = [];
  const created: string[] = [];
  const target = dryRun ? cloneDocument(doc) : doc;
  for (const spec of objects) {
    if (!spec.id || !spec.type) {
      errors.push({ error: "create requires type and id" });
      continue;
    }
    const flat = flattenCreate(spec);
    const behind = Boolean(opts?.behind || spec.behind || (spec as { behind?: boolean }).behind);
    if ((flat.w ?? 0) < 0 || (flat.h ?? 0) < 0) {
      errors.push({ id: spec.id, error: "width would become negative" });
      continue;
    }
    const existing = findNode(target, spec.id);
    if (existing) {
      existing.bounds = {
        x: flat.x ?? existing.bounds.x,
        y: flat.y ?? existing.bounds.y,
        w: flat.w ?? existing.bounds.w,
        h: flat.h ?? existing.bounds.h,
      };
      if (flat.preset) existing.preset = flat.preset;
      if (flat.style) existing.style = flat.style;
      Object.assign(existing.props, propsFromCreateSpec(flat));
      if (behind) restackNodeBehind(target, existing.id);
      created.push(spec.id);
      continue;
    }
    insertCreatedNode(target, objectFromSpec(spec), behind);
    created.push(spec.id);
  }
  if (errors.length && !dryRun) {
    /* objects already added; callers that want txn use applyTransaction */
  }
  return { ok: errors.length === 0, created, errors: errors.length ? errors : undefined, changed: created.length };
}

export function moveInstance(doc: DesignDocument, node: DesignNode, x: number, y: number) {
  const dx = x - node.bounds.x;
  const dy = y - node.bounds.y;
  if (dx === 0 && dy === 0) return false;
  node.bounds.x = x;
  node.bounds.y = y;
  for (const childId of node.children) {
    const child = findNode(doc, childId);
    if (!child) continue;
    child.bounds.x += dx;
    child.bounds.y += dy;
  }
  return true;
}

export function useWidget(
  doc: DesignDocument,
  args: {
    widget?: string;
    id?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    bindings?: Record<string, string>;
    content?: Record<string, string>;
  },
) {
  const widget = String(args.widget ?? "");
  const id = String(args.id ?? "");
  if (!widget || !id) return { ok: false, errors: [{ error: "design_use_widget requires widget and id" }] };
  if (args.content) {
    for (const [key, value] of Object.entries(args.content)) doc.content[key] = value;
  }
  const result = instantiateWidget(
    doc,
    widget,
    id,
    { x: Number(args.x ?? 0), y: Number(args.y ?? 0), w: Number(args.w ?? 0), h: Number(args.h ?? 0) },
    args.bindings ?? {},
  );
  if (!result.ok) return { ok: false, errors: [{ id, error: result.error ?? "use failed" }] };
  return { ok: true, created: [id], changed: 1 };
}

export function layoutObjects(doc: DesignDocument, where: string, layout: LayoutArgs): ToolResult {
  const kind = String(layout.type ?? "column").toLowerCase();
  const area = layout.area ?? {};
  const originX = Number(area.x ?? 80);
  const originY = Number(area.y ?? 80);
  const gap = Number(layout.gap ?? layout.gap_y ?? 24);
  let nodes = matchingNodes(doc, where, { includeUse: true }).filter((n) => n.type === "use" || !n.parentId);
  if (!nodes.length) nodes = matchingNodes(doc, `type=use ${where}`.trim(), { includeUse: true });
  nodes = nodes.filter((n, i, all) => all.findIndex((x) => x.id === n.id) === i);
  nodes.sort((a, b) => a.id.localeCompare(b.id));
  const diff: Array<Record<string, unknown>> = [];
  if (kind === "column" || kind === "stack" || kind === "left" || kind === "top-left" || kind === "vertical") {
    let y = originY;
    for (const node of nodes) {
      const from = { x: node.bounds.x, y: node.bounds.y };
      if (moveInstance(doc, node, originX, y)) diff.push({ id: node.id, x: { from: from.x, to: originX }, y: { from: from.y, to: y } });
      y += (node.bounds.h || 0) + gap;
    }
  } else if (kind === "row" || kind === "horizontal") {
    const gapX = Number(layout.gap_x ?? layout.gap ?? 24);
    let x = originX;
    for (const node of nodes) {
      const from = { x: node.bounds.x, y: node.bounds.y };
      if (moveInstance(doc, node, x, originY)) diff.push({ id: node.id, x: { from: from.x, to: x }, y: { from: from.y, to: originY } });
      x += (node.bounds.w || 0) + gapX;
    }
  } else {
    return { ok: false, errors: [{ error: `unknown layout type '${kind}'` }] };
  }
  return { ok: true, matched: nodes.length, changed: diff.length, diff };
}

export function updateObjects(doc: DesignDocument, args: UpdateArgs): ToolResult {
  const dry = Boolean(args.dry_run);
  const target = dry ? cloneDocument(doc) : doc;
  const diff: Array<Record<string, unknown>> = [];
  const touched: string[] = [];
  const errors: NonNullable<ToolResult["errors"]> = [];
  const warnings: NonNullable<ToolResult["warnings"]> = [];
  let matched = 0;

  const applyTo = (node: DesignNode, set?: Record<string, unknown>, transform?: Record<string, string | number>, replace?: Record<string, string>) => {
    matched += 1;
    touched.push(node.id);
    const changes: Record<string, unknown> = { id: node.id };
    let changed = false;
    if (replace) {
      for (const [key, value] of Object.entries(replace)) {
        const hit = applyScalar(node, key, value, target);
        if (hit) {
          changes[key] = hit;
          changed = true;
        }
      }
    }
    if (set) {
      for (const [key, value] of Object.entries(set)) {
        const warn = patchFieldWarning(node, key);
        if (warn) warnings.push({ id: node.id, field: key, warning: warn });
        const normalized = normalizePatchKey(node, key);
        const hit = applyScalar(node, normalized, value, target);
        if (hit) {
          changes[normalized] = hit;
          changed = true;
        }
      }
    }
    if (transform) {
      for (const [key, expr] of Object.entries(transform)) {
        const hit = applyTransform(node, key, expr);
        if (hit) {
          if (typeof hit.to === "number" && hit.to < 0 && (key === "w" || key === "h")) {
            errors.push({ id: node.id, error: "width would become negative" });
            continue;
          }
          changes[key] = hit;
          changed = true;
        }
      }
    }
    if (changed) diff.push(changes);
  };

  if (args.layout && args.where) {
    const laid = layoutObjects(target, args.where, args.layout);
    if (!laid.ok) return laid;
    if (errors.length) return { ok: false, matched: laid.matched, changed: 0, errors, diff: laid.diff };
    return { ok: true, matched: laid.matched, changed: laid.changed, diff: laid.diff };
  }

  if (args.patches) {
    for (const patch of args.patches) {
      const node = findNode(target, patch.id);
      if (!node) {
        errors.push({ id: patch.id, error: `unknown id ${patch.id}` });
        continue;
      }
      applyTo(node, patch.set);
    }
  } else {
    const nodes = args.where ? matchingNodes(target, args.where, { includeUse: true }) : [];
    for (const node of nodes) applyTo(node, args.set, args.transform, args.replace);
  }

  if (errors.length) return { ok: false, matched, changed: 0, touched, errors, warnings, diff };
  return {
    ok: true,
    matched,
    changed: diff.length,
    touched,
    warnings: warnings.length ? warnings : undefined,
    diff,
  };
}

export function deleteObjects(doc: DesignDocument, args: { where?: string; ids?: string[]; dry_run?: boolean }): ToolResult {
  const ids = new Set(args.ids ?? []);
  if (args.where) {
    for (const n of matchingNodes(doc, args.where, { includeUse: true })) ids.add(n.id);
  }
  const deleted = doc.nodes.filter((n) => ids.has(n.id) || (n.parentId != null && ids.has(n.parentId))).map((n) => n.id);
  if (!args.dry_run) {
    const drop = new Set(deleted);
    doc.nodes = doc.nodes.filter((n) => !drop.has(n.id));
    for (const n of doc.nodes) n.children = n.children.filter((c) => !drop.has(c));
  }
  return { ok: true, matched: deleted.length, deleted, changed: args.dry_run ? 0 : deleted.length };
}

function storedPropValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Copy style props from one widget instance to another (matched slots: bg, icon, title, …). */
export function copyWidgetStyles(
  doc: DesignDocument,
  args: { from: string; to: string; slots?: string[] },
): ToolResult {
  const fromId = String(args.from ?? "").trim();
  const toId = String(args.to ?? "").trim();
  const fromUse = findNode(doc, fromId);
  const toUse = findNode(doc, toId);
  if (!fromUse || fromUse.type !== "use") {
    return { ok: false, errors: [{ id: fromId, error: "from must be a widget instance (use) id" }] };
  }
  if (!toUse || toUse.type !== "use") {
    return { ok: false, errors: [{ id: toId, error: "to must be a widget instance (use) id" }] };
  }
  const allow = args.slots?.map(String);
  const diff: Array<Record<string, unknown>> = [];
  const touched: string[] = [];
  let matched = 0;
  for (const toChild of doc.nodes.filter((n) => n.parentId === toId)) {
    const slot = toChild.id.slice(toId.length + 1);
    if (allow?.length && !allow.includes(slot)) continue;
    const fromChild = doc.nodes.find((n) => n.id === `${fromId}.${slot}`);
    if (!fromChild) continue;
    matched += 1;
    touched.push(toChild.id);
    const changes: Record<string, unknown> = { id: toChild.id, slot };
    let slotChanged = false;
    if (fromChild.preset !== toChild.preset) {
      changes.preset = { from: toChild.preset, to: fromChild.preset };
      toChild.preset = fromChild.preset;
      slotChanged = true;
    }
    if (fromChild.style !== toChild.style) {
      changes.style = { from: toChild.style, to: fromChild.style };
      toChild.style = fromChild.style;
      slotChanged = true;
    }
    for (const key of STYLE_PROPS) {
      const raw = fromChild.props[key];
      if (raw == null) continue;
      const hit = applyScalar(toChild, key, storedPropValue(raw));
      if (hit) {
        changes[key] = hit;
        slotChanged = true;
      }
    }
    if (slotChanged) diff.push(changes);
  }
  if (!matched) {
    return { ok: false, errors: [{ error: `no matching slots between ${fromId} and ${toId}` }] };
  }
  return {
    ok: true,
    matched,
    changed: diff.length,
    touched,
    diff,
    from: fromId,
    to: toId,
    unchanged: matched > 0 && diff.length === 0,
  };
}

export function setPageBackground(
  doc: DesignDocument,
  args: { src?: string; clear?: boolean },
): ToolResult {
  if (args.clear || !args.src?.trim()) {
    const from = doc.pageBackground;
    doc.pageBackground = undefined;
    return { ok: true, changed: from ? 1 : 0, matched: 1 };
  }
  const key = resolveUploadKey(args.src);
  const from = doc.pageBackground;
  doc.pageBackground = key;
  return {
    ok: true,
    changed: from === key ? 0 : 1,
    matched: 1,
    diff: [{ id: "canvas.photo", src: { from, to: uploadPublicUrl(key) } }],
  };
}

export function replaceImageSrc(doc: DesignDocument, id: string, src: string): ToolResult {
  const node = findNode(doc, id);
  if (!node || node.type !== "img") {
    return { ok: false, errors: [{ id, error: `not an image node: ${id}` }] };
  }
  const key = resolveUploadKey(src);
  const to = uploadPublicUrl(key);
  const from = node.imageBinding ? `@${node.imageBinding}` : node.src;
  node.imageBinding = undefined;
  node.src = to;
  return { ok: true, changed: from === to ? 0 : 1, matched: 1, diff: [{ id, src: { from, to } }] };
}

export function insertImage(
  doc: DesignDocument,
  args: { id: string; src: string; x?: number; y?: number; w?: number; h?: number; fit?: string },
): ToolResult {
  const id = String(args.id ?? "").trim();
  if (!id) return { ok: false, errors: [{ error: "design_insert_image requires id" }] };
  if (findNode(doc, id)) return { ok: false, errors: [{ id, error: `id already exists: ${id}` }] };
  const key = resolveUploadKey(args.src);
  const node: DesignNode = {
    id,
    type: "img",
    bounds: {
      x: Number(args.x ?? 0),
      y: Number(args.y ?? 0),
      w: Number(args.w ?? 640),
      h: Number(args.h ?? 480),
    },
    props: args.fit ? { fit: String(args.fit) } : {},
    src: uploadPublicUrl(key),
    children: [],
  };
  doc.nodes.push(node);
  return { ok: true, created: [id], changed: 1, matched: 1 };
}

export function applyTransaction(
  doc: DesignDocument,
  operations: Array<Record<string, unknown>>,
): ToolResult {
  const snapshot = cloneDocument(doc);
  const errors: NonNullable<ToolResult["errors"]> = [];
  let changed = 0;
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const kind = String(op.op || "");
    let result: ToolResult;
    if (kind === "update" || kind === "layout") result = updateObjects(doc, op as UpdateArgs);
    else if (kind === "create") result = createObjects(doc, (op.objects as CreateObject[]) ?? []);
    else if (kind === "use" || kind === "use_widget") result = useWidget(doc, op);
    else if (kind === "delete") result = deleteObjects(doc, op as { where?: string; ids?: string[] });
    else {
      errors.push({ operation: i, error: `unknown op '${kind}'` });
      Object.assign(doc, snapshot);
      return { ok: false, errors };
    }
    if (!result.ok) {
      for (const err of result.errors ?? []) errors.push({ ...err, operation: i });
      Object.assign(doc, snapshot);
      doc.nodes = snapshot.nodes;
      doc.content = snapshot.content;
      return { ok: false, errors };
    }
    changed += result.changed ?? 0;
  }
  return { ok: errors.length === 0, changed, errors: errors.length ? errors : undefined };
}
