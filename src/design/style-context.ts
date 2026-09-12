import { STYLE_PROPS } from "./props-sync";
import { findNode, type DesignDocument, type DesignNode } from "./types";

function slotName(instanceId: string, node: DesignNode): string {
  return node.id.startsWith(`${instanceId}.`) ? node.id.slice(instanceId.length + 1) : node.id;
}

function stylePropsLine(node: DesignNode): string {
  const bits: string[] = [];
  if (node.preset) bits.push(`preset=${node.preset}`);
  if (node.style) bits.push(`style=${node.style}`);
  for (const key of STYLE_PROPS) {
    const v = node.props[key];
    if (v) bits.push(`${key}=${v.length > 48 ? `${v.slice(0, 45)}…` : v}`);
  }
  return bits.join(" ");
}

/** Compact per-card style summary for the chat brief. */
export function styleContextBlock(doc: DesignDocument): string {
  const uses = doc.nodes.filter((n) => n.type === "use").sort((a, b) => a.id.localeCompare(b.id));
  if (!uses.length) return "";
  const lines: string[] = [];
  for (const inst of uses) {
    const children = doc.nodes
      .filter((n) => n.parentId === inst.id)
      .sort((a, b) => slotName(inst.id, a).localeCompare(slotName(inst.id, b)));
    const slots = children
      .map((c) => {
        const styles = stylePropsLine(c);
        return styles ? `${slotName(inst.id, c)}(${c.type}): ${styles}` : null;
      })
      .filter(Boolean);
    if (slots.length) lines.push(`${inst.id}: ${slots.join(" | ")}`);
  }
  if (!lines.length) return "";
  return [
    "STYLES (IR props per feature card — copy all slots: design_copy_styles from=feature.chat to=feature.local):",
    ...lines,
  ].join("\n");
}

export function widgetChildIds(doc: DesignDocument, instanceId: string): string[] {
  const inst = findNode(doc, instanceId);
  if (!inst || inst.type !== "use") return [];
  return doc.nodes.filter((n) => n.parentId === instanceId).map((n) => n.id);
}
