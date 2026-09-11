import { DEFAULT_FIELDS, type DesignDocument, type DesignNode } from "./types";

export type QueryArgs = {
  query?: string;
  fields?: string[];
  limit?: number;
};

type Op = "=" | "!=" | "^=" | "$=" | "*=" | "~=" | ">" | "<" | ">=" | "<=";

type Pred = { key: string; op: Op; value: string };

const OP_RE = /^(!=|\^=|\$=|\*=|~=|>=|<=|>|<|=)/;

function fieldValue(node: DesignNode, key: string, doc: DesignDocument): string | number | undefined {
  switch (key) {
    case "id":
      return node.id;
    case "type":
      return node.type;
    case "role":
      return node.role;
    case "preset":
      return node.preset;
    case "style":
      return node.style;
    case "parent":
      return node.parentId;
    case "widget":
      return node.widgetSource;
    case "x":
      return node.bounds.x;
    case "y":
      return node.bounds.y;
    case "w":
      return node.bounds.w;
    case "h":
      return node.bounds.h;
    case "src": {
      if (node.imageBinding) {
        const resolved = doc.content[node.imageBinding];
        if (resolved != null) return resolved;
        return `@${node.imageBinding}`;
      }
      return node.src;
    }
    case "text": {
      if (node.textBinding) return `@${node.textBinding}`;
      if (node.text) return node.text;
      if (node.textBinding && doc.content[node.textBinding] != null) return doc.content[node.textBinding];
      return undefined;
    }
    default:
      return node.props[key];
  }
}

function parsePred(token: string): Pred | null {
  const keyMatch = token.match(/^[A-Za-z_][\w.]*/);
  if (!keyMatch) return null;
  const key = keyMatch[0];
  const rest = token.slice(key.length);
  const opMatch = rest.match(OP_RE);
  if (!opMatch) return null;
  const op = opMatch[1] as Op;
  let value = rest.slice(op.length);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, op, value };
}

function parseWhere(query: string): Pred[][] {
  const trimmed = query.trim();
  if (!trimmed) return [[]];
  return trimmed.split(/\s*\|\s*|\s+OR\s+/i).map((group) => {
    const tokens = group.trim().split(/\s+/).filter(Boolean);
    return tokens.map(parsePred).filter((p): p is Pred => Boolean(p));
  });
}

function matchPred(node: DesignNode, pred: Pred, doc: DesignDocument): boolean {
  const raw = fieldValue(node, pred.key, doc);
  if (pred.op === ">" || pred.op === "<" || pred.op === ">=" || pred.op === "<=") {
    const left = typeof raw === "number" ? raw : Number(raw);
    const right = Number(pred.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (pred.op === ">") return left > right;
    if (pred.op === "<") return left < right;
    if (pred.op === ">=") return left >= right;
    return left <= right;
  }
  const s = raw == null ? "" : String(raw);
  const v = pred.value;
  switch (pred.op) {
    case "=":
      return s === v;
    case "!=":
      return s !== v;
    case "^=":
      return s.startsWith(v);
    case "$=":
      return s.endsWith(v);
    case "*=":
      return s.includes(v);
    case "~=":
      return s.toLowerCase().includes(v.toLowerCase());
    default:
      return false;
  }
}

function matchNode(node: DesignNode, groups: Pred[][], doc: DesignDocument): boolean {
  if (groups.length === 1 && groups[0].length === 0) return true;
  return groups.some((ands) => ands.every((p) => matchPred(node, p, doc)));
}

export function projectNode(node: DesignNode, fields: string[], doc: DesignDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "text") {
      out.text = node.textBinding ? `@${node.textBinding}` : node.text;
      continue;
    }
    const value = fieldValue(node, field, doc);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function queryIncludesUse(groups: Pred[][]): boolean {
  return groups.some((ands) => ands.some((p) => p.key === "type" && p.op === "=" && p.value === "use"));
}

export function queryNodes(doc: DesignDocument, args: QueryArgs = {}): Record<string, unknown>[] {
  const groups = parseWhere(args.query ?? "");
  const fields = args.fields?.length ? args.fields : [...DEFAULT_FIELDS];
  const limit = args.limit ?? 50;
  const includeUse = queryIncludesUse(groups);
  const hits: Record<string, unknown>[] = [];
  for (const node of doc.nodes) {
    if (node.type === "use" && !includeUse) continue;
    if (!matchNode(node, groups, doc)) continue;
    hits.push(projectNode(node, fields, doc));
    if (hits.length >= limit) break;
  }
  return hits;
}

export function getNodes(
  doc: DesignDocument,
  ids: string[],
  includeChildren = false,
): DesignNode[] {
  const want = new Set(ids);
  const out: DesignNode[] = [];
  const seen = new Set<string>();
  for (const node of doc.nodes) {
    const hit = want.has(node.id) || (includeChildren && node.parentId != null && want.has(node.parentId));
    if (!hit || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

export function matchingNodes(doc: DesignDocument, where: string, opts?: { includeUse?: boolean }): DesignNode[] {
  const groups = parseWhere(where);
  const includeUse = opts?.includeUse || queryIncludesUse(groups);
  return doc.nodes.filter((n) => (n.type !== "use" || includeUse) && matchNode(n, groups, doc));
}
