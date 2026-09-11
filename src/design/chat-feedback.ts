import type { ToolCall } from "./tools";

type ToolRun = { name: string; result: unknown };

function rec(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

export function dedupeToolCalls(calls: ToolCall[]): ToolCall[] {
  const seen = new Set<string>();
  const out: ToolCall[] = [];
  for (const call of calls) {
    const key = `${call.name}\0${JSON.stringify(call.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

/** Model replied with JSON tool payload only — hide it from the chat bubble. */
export function isDesignToolOnlyReply(text: string): boolean {
  const trimmed = text.trim();
  if (!/design_[a-z_]+/i.test(trimmed)) return false;
  const compact = trimmed.replace(/\s+/g, "");
  return /^(\{.*\})+$/i.test(compact) || compact.startsWith('{"tool_calls"');
}

function rootDeletedIds(deleted: string[]): string[] {
  const set = new Set(deleted);
  return deleted.filter((id) => {
    const parts = id.split(".");
    for (let i = 1; i < parts.length; i++) {
      if (set.has(parts.slice(0, i).join("."))) return false;
    }
    return true;
  });
}

function deleteSummary(result: Record<string, unknown>): string {
  const deleted = Array.isArray(result.deleted) ? result.deleted.map(String) : [];
  const roots = rootDeletedIds(deleted);
  if (!deleted.length) return "Nothing matched — no objects removed.";
  if (roots.length === 1) return `Removed ${roots[0]} (${deleted.length} layer${deleted.length === 1 ? "" : "s"}).`;
  return `Removed ${deleted.length} objects.`;
}

function updateSummary(result: Record<string, unknown>): string {
  const changed = Number(result.changed ?? 0);
  const matched = Number(result.matched ?? 0);
  if (!changed) return matched ? "No changes applied." : "Nothing matched.";
  const diff = Array.isArray(result.diff) ? result.diff : [];
  const ids = diff.map((row) => String((row as Record<string, unknown>).id ?? "")).filter(Boolean);
  if (ids.length === 1) return `Updated ${ids[0]}.`;
  if (ids.length) return `Updated ${ids.length} objects.`;
  return `Updated ${changed} field${changed === 1 ? "" : "s"}.`;
}

function searchSummary(result: Record<string, unknown>): string {
  const icons = Array.isArray(result.icons) ? result.icons : [];
  if (!icons.length) return "No icons found.";
  const names = icons.slice(0, 5).map((row) => String((row as Record<string, unknown>).id ?? ""));
  return `Found ${icons.length} icon${icons.length === 1 ? "" : "s"}: ${names.join(", ")}${icons.length > 5 ? "…" : ""}`;
}

function oneLine(name: string, result: unknown): string {
  const r = rec(result);
  if (r.ok === false && r.error) return String(r.error);
  if (name === "design_delete") return deleteSummary(r);
  if (name === "design_update") return updateSummary(r);
  if (name === "design_search_icons") return searchSummary(r);
  if (name === "design_create") {
    const created = Array.isArray(r.created) ? r.created.map(String) : [];
    return created.length ? `Created ${created.join(", ")}.` : "Nothing created.";
  }
  if (name === "design") return String(r.error ?? "Design error.");
  return "Done.";
}

/** Short assistant bubble (no raw JSON). */
export function assistantReplyForDesignTools(runs: ToolRun[]): string {
  if (!runs.length) return "I couldn't apply that change.";
  const lines = runs.map((row) => oneLine(row.name, row.result));
  const errors = runs.filter((row) => rec(row.result).ok === false);
  if (errors.length === runs.length) return lines.join(" ");
  return lines.join(" ");
}

/** Tool panel — slightly more detail. */
export function formatDesignToolRuns(runs: ToolRun[]): string {
  if (!runs.length) return "No design tools ran.";
  return runs
    .map((row) => {
      const detail = oneLine(row.name, row.result);
      return `${row.name}: ${detail}`;
    })
    .join("\n");
}
