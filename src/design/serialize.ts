import type { DesignDocument, DesignNode } from "./types";

const PROP_ORDER = [
  "parent",
  "role",
  "widget",
  "x",
  "y",
  "w",
  "h",
  "preset",
  "style",
  "src",
  "text",
] as const;

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function nodeLine(n: DesignNode): string {
  const bits: string[] = [n.type, n.id];
  const values: Record<string, string | undefined> = {
    parent: n.parentId,
    role: n.role,
    widget: n.widgetSource,
    x: fmtNum(n.bounds.x),
    y: fmtNum(n.bounds.y),
    w: n.props.w?.endsWith("%") ? n.props.w : fmtNum(n.bounds.w),
    h: n.props.h?.endsWith("%") ? n.props.h : fmtNum(n.bounds.h),
    preset: n.preset,
    style: n.style,
    src: n.imageBinding ? `@${n.imageBinding}` : n.src,
    text: n.textBinding ? `@${n.textBinding}` : n.text?.includes("\n") ? undefined : n.text,
  };
  for (const key of PROP_ORDER) {
    const v = values[key];
    if (v == null || v === "") continue;
    bits.push(`${key}=${v}`);
  }
  let line = bits.join(" ");
  if (n.text && n.text.includes("\n") && !n.textBinding) {
    line += "\n" + n.text.split("\n").map((row) => `  ${row}`).join("\n");
  }
  return line;
}

export function serializeDsl(doc: DesignDocument): string {
  const out: string[] = [];
  out.push(`canvas ${doc.canvas.id} ${doc.canvas.width} ${doc.canvas.height}`);
  if (doc.theme) out.push(`theme ${doc.theme}`);
  out.push("");
  const presetIds = Object.keys(doc.presets).sort();
  for (const id of presetIds) {
    const p = doc.presets[id];
    const extras = Object.entries(p.props)
      .filter(([k]) => k !== "id")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    out.push(extras ? `preset ${id} ${extras}` : `preset ${id}`);
  }
  if (presetIds.length) out.push("");
  const widgetIds = Object.keys(doc.widgets).sort();
  for (const id of widgetIds) {
    const w = doc.widgets[id];
    out.push(`widget ${id} w=${fmtNum(w.width)} h=${fmtNum(w.height)}`);
    for (const child of w.nodes) out.push(`  ${nodeLine(child)}`);
    out.push("");
  }
  const scene = doc.nodes.filter((n) => n.type !== "use" && !n.parentId);
  for (const n of scene) out.push(nodeLine(n));
  const uses = doc.nodes.filter((n) => n.type === "use");
  if (uses.length) out.push("");
  for (const u of uses) {
    out.push(`use ${u.widgetSource || u.props.widget} as=${u.id} x=${fmtNum(u.bounds.x)} y=${fmtNum(u.bounds.y)}`);
    for (const childId of u.children) {
      const child = doc.nodes.find((n) => n.id === childId);
      if (!child) continue;
      const slot = child.id.slice(u.id.length + 1);
      const value =
        child.imageBinding ? `@${child.imageBinding}`
        : child.textBinding ? `@${child.textBinding}`
        : child.props.icon || child.src || child.text;
      if (value) out.push(`${u.id}.${slot}=${value}`);
    }
  }
  const keys = Object.keys(doc.content).sort();
  if (keys.length) out.push("");
  for (const key of keys) out.push(`@${key} = ${doc.content[key]}`);
  return out.join("\n").trimEnd() + "\n";
}
