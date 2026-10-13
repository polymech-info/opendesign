export type ConstructionAxis = "h" | "v";

export type ConstructionLine = {
  id: string;
  axis: ConstructionAxis;
  at: number;
};

const STORAGE_KEY = "_constructionLines";

const byPage = new Map<string, ConstructionLine[]>();

let vertical: number[] = [];
let horizontal: number[] = [];

export function readConstructionLines(raw: string | null | undefined): ConstructionLine[] {
  if (!raw || raw === "{}") return [];
  try {
    const data = JSON.parse(raw) as { [STORAGE_KEY]?: unknown };
    const rows = data[STORAGE_KEY];
    if (!Array.isArray(rows)) return [];
    const lines: ConstructionLine[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { id?: unknown; axis?: unknown; at?: unknown };
      if ((rec.axis !== "h" && rec.axis !== "v") || typeof rec.at !== "number" || !Number.isFinite(rec.at)) continue;
      const id = typeof rec.id === "string" && rec.id ? rec.id : crypto.randomUUID();
      lines.push({ id, axis: rec.axis, at: rec.at });
    }
    return lines;
  } catch {
    return [];
  }
}

export function attachConstructionLines(json: string, lines: ConstructionLine[]): string {
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    if (lines.length === 0) delete data[STORAGE_KEY];
    else data[STORAGE_KEY] = lines.map((line) => ({ id: line.id, axis: line.axis, at: line.at }));
    return JSON.stringify(data);
  } catch {
    return json;
  }
}

/** Lines last written for a page. Null until that page has been loaded. */
export function pageConstructionLines(pageId: string): ConstructionLine[] | null {
  return byPage.has(pageId) ? byPage.get(pageId)! : null;
}

export function setPageConstructionLines(pageId: string, lines: ConstructionLine[]) {
  byPage.set(pageId, lines);
}

/** Visible lines on the active page. Object snap reads these. */
export function publishConstructionSnap(lines: ConstructionLine[]) {
  const x: number[] = [];
  const y: number[] = [];
  for (const line of lines) {
    if (line.axis === "v") x.push(line.at);
    else y.push(line.at);
  }
  vertical = x;
  horizontal = y;
}

export function constructionSnapValues(axis: "x" | "y"): number[] {
  return axis === "x" ? vertical : horizontal;
}

type Cursor = { x: number | null; y: number | null };

let cursor: Cursor = { x: null, y: null };
const cursorListeners = new Set<(cursor: Cursor) => void>();

export function reportCursor(x: number | null, y: number | null) {
  const rx = x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10;
  const ry = y == null || !Number.isFinite(y) ? null : Math.round(y * 10) / 10;
  if (cursor.x === rx && cursor.y === ry) return;
  cursor = { x: rx, y: ry };
  for (const listener of cursorListeners) listener(cursor);
}

export function subscribeCursor(listener: (cursor: Cursor) => void) {
  cursorListeners.add(listener);
  listener(cursor);
  return () => {
    cursorListeners.delete(listener);
  };
}
