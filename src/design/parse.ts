import { STYLE_PROPS, stylePropsOnly } from "./props-sync";
import {
  emptyDocument,
  type DesignDocument,
  type DesignNode,
  type NodeType,
  type Rect,
  type WidgetDefinition,
} from "./types";

const KINDS = new Set<string>([
  "canvas",
  "theme",
  "preset",
  "widget",
  "use",
  "shape",
  "txt",
  "icon",
  "img",
  "line",
  "group",
  "video",
  "path",
]);

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, "  ").length : 0;
}

function parseNum(raw: string | undefined, fallback = 0): number {
  if (raw == null) return fallback;
  if (raw.endsWith("%")) return Number.NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseProps(rest: string): { positional: string[]; props: Record<string, string> } {
  const positional: string[] = [];
  const props: Record<string, string> = {};
  const re = /(\S+)=(\S+)|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    if (m[1] != null) props[m[1]] = m[2];
    else if (m[3]) positional.push(m[3]);
  }
  return { positional, props };
}

function boundsFrom(props: Record<string, string>): Rect {
  return {
    x: parseNum(props.x),
    y: parseNum(props.y),
    w: parseNum(props.w),
    h: parseNum(props.h),
  };
}

function bindingKey(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("@")) return undefined;
  return value.slice(1);
}

function makeNode(type: NodeType, id: string, props: Record<string, string>, extra?: Partial<DesignNode>): DesignNode {
  const text = extra?.text ?? props.text;
  const src = extra?.src ?? props.src;
  return {
    id,
    type,
    role: extra?.role ?? props.role,
    parentId: extra?.parentId,
    widgetSource: extra?.widgetSource ?? props.widget,
    bounds: extra?.bounds ?? boundsFrom(props),
    preset: extra?.preset ?? props.preset,
    style: extra?.style ?? props.style,
    props: stylePropsOnly(props),
    text: text?.startsWith("@") ? undefined : text,
    textBinding: extra?.textBinding ?? bindingKey(text),
    src: src?.startsWith("@") ? undefined : src,
    imageBinding: extra?.imageBinding ?? bindingKey(src),
    children: extra?.children ?? [],
  };
}

function resolveLen(raw: string | undefined, base: number, fallback: number): number {
  if (raw == null || raw === "") return fallback;
  if (raw.endsWith("%")) {
    const pct = Number(raw.slice(0, -1));
    return Number.isFinite(pct) ? (base * pct) / 100 : fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function instantiateWidget(
  doc: DesignDocument,
  widgetId: string,
  instanceId: string,
  origin: Rect,
  bindings: Record<string, string> = {},
): { ok: boolean; id?: string; error?: string } {
  const widget = doc.widgets[widgetId];
  if (!widget) {
    const error = `Unknown widget '${widgetId}'`;
    doc.errors.push({ id: instanceId, field: "widget", code: "MISSING_WIDGET", message: error });
    return { ok: false, error };
  }
  if (doc.nodes.some((n) => n.id === instanceId)) {
    return { ok: false, id: instanceId, error: `id already exists: ${instanceId}` };
  }
  const inst: DesignNode = {
    id: instanceId,
    type: "use",
    widgetSource: widgetId,
    bounds: {
      x: origin.x,
      y: origin.y,
      w: origin.w || widget.width,
      h: origin.h || widget.height,
    },
    props: { widget: widgetId },
    children: [],
  };
  const taken = new Set(doc.nodes.map((n) => n.id));
  doc.nodes.push(inst);
  taken.add(instanceId);

  for (const tmpl of widget.nodes) {
    const childId = `${instanceId}.${tmpl.id}`;
    const bind = bindings[tmpl.id] ?? bindings[tmpl.role ?? ""] ?? "";
    const w = resolveLen(tmpl.props.w, inst.bounds.w, tmpl.bounds.w);
    const h = resolveLen(tmpl.props.h, inst.bounds.h, tmpl.bounds.h);
    const x = Number.isFinite(tmpl.bounds.x) ? inst.bounds.x + tmpl.bounds.x : inst.bounds.x;
    const y = Number.isFinite(tmpl.bounds.y) ? inst.bounds.y + tmpl.bounds.y : inst.bounds.y;
    const props = { ...tmpl.props };
    if (bind) {
      if (tmpl.type === "img" || tmpl.role === "icon" || tmpl.type === "icon") {
        if (bind.startsWith("@")) props.src = bind;
        else props.src = bind;
      } else if (tmpl.type === "txt") {
        props.text = bind.startsWith("@") ? bind : bind;
      } else if (tmpl.type === "icon") {
        props.icon = bind.startsWith("@") ? bind : bind;
      }
    }
    const node = makeNode(tmpl.type, childId, props, {
      parentId: instanceId,
      widgetSource: widgetId,
      role: tmpl.role,
      preset: tmpl.preset,
      style: tmpl.style,
      bounds: { x, y, w, h },
    });
    if (tmpl.type === "icon" && bind && !bind.startsWith("@")) node.props.icon = bind;
    inst.children.push(childId);
    if (taken.has(childId)) {
      doc.errors.push({ id: childId, field: "id", code: "DUPLICATE_ID", message: `Duplicate id '${childId}'` });
    }
    doc.nodes.push(node);
    taken.add(childId);
  }
  return { ok: true, id: instanceId };
}

type DeferredProp = { nodeId: string; prop: string; value: string };

export function parseDsl(source: string): DesignDocument {
  const doc = emptyDocument();
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let pendingUse: { widget: string; id: string; origin: Rect; bindings: Record<string, string> } | null = null;
  const deferredProps: DeferredProp[] = [];

  const flushUse = () => {
    if (!pendingUse) return;
    instantiateWidget(doc, pendingUse.widget, pendingUse.id, pendingUse.origin, pendingUse.bindings);
    pendingUse = null;
  };

  const readBlockText = (baseIndent: number): string => {
    const parts: string[] = [];
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      if (!next.trim()) {
        if (indentOf(next) > baseIndent) {
          i += 1;
          parts.push("");
          continue;
        }
        break;
      }
      const ind = indentOf(next);
      if (ind <= baseIndent) break;
      const trimmed = next.trim();
      if (KINDS.has(trimmed.split(/\s+/)[0] ?? "")) break;
      i += 1;
      parts.push(next.slice(baseIndent + (next[baseIndent] === " " ? 2 : 0)).trimEnd());
    }
    return parts.join("\n").trim();
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }
    const indent = indentOf(raw);

    if (trimmed.startsWith("@")) {
      flushUse();
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        i += 1;
        continue;
      }
      const key = trimmed.slice(1, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) doc.content[key] = value;
      i += 1;
      continue;
    }

    const first = trimmed.split(/\s+/, 1)[0] ?? "";
    if (!KINDS.has(first) && trimmed.includes("=") && first.includes(".")) {
      const eq = trimmed.indexOf("=");
      const lhs = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      const dot = lhs.lastIndexOf(".");
      if (dot > 0) {
        const prop = lhs.slice(dot + 1);
        if (STYLE_PROPS.has(prop)) {
          const nodeId = lhs.slice(0, dot);
          const node = doc.nodes.find((n) => n.id === nodeId);
          if (node) node.props[prop] = value;
          else deferredProps.push({ nodeId, prop, value });
          i += 1;
          continue;
        }
      }
      const inst = lhs.slice(0, dot);
      const slot = lhs.slice(dot + 1);
      if (pendingUse && pendingUse.id === inst) pendingUse.bindings[slot] = value;
      else {
        const node = doc.nodes.find((n) => n.id === `${inst}.${slot}` || (n.id === inst && n.role === slot));
        if (node) {
          if (value.startsWith("@")) {
            if (node.type === "img") node.imageBinding = value.slice(1);
            else node.textBinding = value.slice(1);
          } else if (node.type === "icon") node.props.icon = value;
          else node.text = value;
        }
      }
      i += 1;
      continue;
    }

    if (indent > 0) {
      i += 1;
      continue;
    }

    const { positional, props } = parseProps(trimmed.slice(first.length).trim());

    if (first === "canvas") {
      flushUse();
      doc.canvas = {
        id: positional[0] || "main",
        width: parseNum(positional[1], 1920),
        height: parseNum(positional[2], 1080),
      };
    } else if (first === "background") {
      flushUse();
      const raw = positional[0] || props.src || props.key || "";
      if (raw) doc.pageBackground = raw;
    } else if (first === "theme") {
      flushUse();
      doc.theme = positional[0] || props.id || "";
    } else if (first === "preset") {
      flushUse();
      const id = positional[0] || props.id;
      if (id) doc.presets[id] = { id, props };
    } else if (first === "widget") {
      flushUse();
      const id = positional[0] || props.id;
      const widget: WidgetDefinition = {
        id: id || "widget",
        width: parseNum(props.w),
        height: parseNum(props.h),
        nodes: [],
        props,
      };
      const baseIndent = indent;
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (!next.trim()) {
          i += 1;
          continue;
        }
        if (indentOf(next) <= baseIndent) break;
        i += 1;
        const childTrim = next.trim();
        const kind = childTrim.split(/\s+/, 1)[0] ?? "";
        if (!KINDS.has(kind) || kind === "widget" || kind === "canvas" || kind === "theme") continue;
        const childRest = childTrim.slice(kind.length).trim();
        const parsed = parseProps(childRest);
        const childId = parsed.positional[0] || parsed.props.id || kind;
        const child = makeNode(kind as NodeType, childId, parsed.props);
        const block = readBlockText(indentOf(next));
        if (block && !child.text && !child.textBinding) child.text = block;
        widget.nodes.push(child);
      }
      if (id) doc.widgets[id] = widget;
    } else if (first === "use") {
      flushUse();
      const widgetId = positional[0] || props.widget || "";
      const asId = props.as || positional[1] || widgetId;
      pendingUse = {
        widget: widgetId,
        id: asId,
        origin: boundsFrom(props),
        bindings: {},
      };
    } else if (KINDS.has(first)) {
      flushUse();
      const id = positional[0] || props.id || first;
      const node = makeNode(first as NodeType, id, props);
      const block = readBlockText(indent);
      if (block && !node.text && !node.textBinding) node.text = block;
      if (doc.nodes.some((n) => n.id === id)) {
        doc.errors.push({ id, field: "id", code: "DUPLICATE_ID", message: `Duplicate id '${id}'` });
      }
      doc.nodes.push(node);
    }

    i += 1;
  }
  flushUse();
  for (const item of deferredProps) {
    const node = doc.nodes.find((n) => n.id === item.nodeId);
    if (node) node.props[item.prop] = item.value;
  }
  return doc;
}
