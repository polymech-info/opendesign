import { matchingNodes } from "./query";
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
};

export type ToolResult = {
  ok: boolean;
  matched?: number;
  changed?: number;
  created?: string[];
  deleted?: string[];
  diff?: Array<Record<string, unknown>>;
  errors?: Array<{ id?: string; operation?: number; error: string }>;
  objects?: Record<string, unknown>[];
};

const GEOM = new Set(["x", "y", "w", "h"]);

function applyScalar(node: DesignNode, key: string, value: unknown): { from: unknown; to: unknown } | null {
  if (key === "width") key = "w";
  if (key === "height") key = "h";
  const next = value == null ? undefined : String(value);
  if (GEOM.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
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
    props: {},
    text: text?.startsWith("@") ? undefined : text,
    textBinding: text?.startsWith("@") ? text.slice(1) : undefined,
    src: src?.startsWith("@") ? undefined : src,
    imageBinding: src?.startsWith("@") ? src.slice(1) : undefined,
    children: [],
  };
}

export function createObjects(doc: DesignDocument, objects: CreateObject[], dryRun = false): ToolResult {
  const errors: ToolResult["errors"] = [];
  const created: string[] = [];
  const target = dryRun ? cloneDocument(doc) : doc;
  for (const spec of objects) {
    if (!spec.id || !spec.type) {
      errors.push({ error: "create requires type and id" });
      continue;
    }
    if (findNode(target, spec.id)) {
      errors.push({ id: spec.id, error: `id already exists: ${spec.id}` });
      continue;
    }
    if ((flattenCreate(spec).w ?? 0) < 0 || (flattenCreate(spec).h ?? 0) < 0) {
      errors.push({ id: spec.id, error: "width would become negative" });
      continue;
    }
    target.nodes.push(objectFromSpec(spec));
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
  const errors: NonNullable<ToolResult["errors"]> = [];
  let matched = 0;

  const applyTo = (node: DesignNode, set?: Record<string, unknown>, transform?: Record<string, string | number>, replace?: Record<string, string>) => {
    matched += 1;
    const changes: Record<string, unknown> = { id: node.id };
    let changed = false;
    if (replace) {
      for (const [key, value] of Object.entries(replace)) {
        const hit = applyScalar(node, key, value);
        if (hit) {
          changes[key] = hit;
          changed = true;
        }
      }
    }
    if (set) {
      for (const [key, value] of Object.entries(set)) {
        const hit = applyScalar(node, key, value);
        if (hit) {
          changes[key] = hit;
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
    if (errors.length) return { ok: false, matched: laid.matched, changed: 0, errors, diff: dry ? laid.diff : undefined };
    return { ok: true, matched: laid.matched, changed: laid.changed, diff: dry ? laid.diff : undefined };
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

  if (errors.length) return { ok: false, matched, changed: 0, errors, diff: dry ? diff : undefined };
  return { ok: true, matched, changed: diff.length, diff: dry ? diff : undefined };
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
