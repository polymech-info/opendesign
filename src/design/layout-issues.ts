import type { DesignDocument, DesignNode } from "./types";

function box(n: DesignNode) {
  return { id: n.id, x: n.bounds.x, y: n.bounds.y, w: n.bounds.w, h: n.bounds.h };
}

function isBackdrop(n: DesignNode): boolean {
  return (
    n.type === "shape" &&
    !n.parentId &&
    (n.id.includes("pane") || n.id.endsWith(".bg") || n.role === "background")
  );
}

function skipExpectedStack(a: DesignNode, b: DesignNode): boolean {
  const [back, front] = isBackdrop(a) ? [a, b] : isBackdrop(b) ? [b, a] : [null, null];
  if (!back || !front) return false;
  return front.type === "use" || front.type === "txt" || front.type === "icon";
}

function overlaps(a: DesignNode, b: DesignNode): boolean {
  return (
    a.bounds.x < b.bounds.x + b.bounds.w &&
    a.bounds.x + a.bounds.w > b.bounds.x &&
    a.bounds.y < b.bounds.y + b.bounds.h &&
    a.bounds.y + a.bounds.h > b.bounds.y
  );
}

/** Top-level layers agents should not stack on top of each other by accident. */
export function layoutIssueLines(doc: DesignDocument): string[] {
  const layers = doc.nodes.filter(
    (n) =>
      !n.parentId &&
      (n.type === "img" || n.type === "shape" || n.type === "use" || n.type === "txt"),
  );
  const hits: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      const a = layers[i];
      const b = layers[j];
      if (!overlaps(a, b)) continue;
      if (skipExpectedStack(a, b)) continue;
      const pa = box(a);
      const pb = box(b);
      hits.push(
        `${a.id} (${pa.x},${pa.y} ${pa.w}×${pa.h}) overlaps ${b.id} (${pb.x},${pb.y} ${pb.w}×${pb.h})`,
      );
    }
  }
  return hits.slice(0, 8);
}

export function layoutContextBlock(doc: DesignDocument): string {
  const issues = layoutIssueLines(doc);
  if (!issues.length) return "";
  return ["LAYOUT (canvas px — overlaps):", ...issues.map((line) => `- ${line}`)].join("\n");
}
