import { looksTruncatedDesignToolJson, stripDesignToolJsonFromText, type ToolCall } from "./tools";

type ToolRun = { name: string; result: unknown };

function rec(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

/** Drop data-URL payload before journal / chat tool cards. Keep path for image_understand. */
export function screenshotResultForLog(name: string, result: unknown): unknown {
  if (name !== "design_screenshot" && name !== "design_export") return result;
  const r = rec(result);
  if (typeof r.image !== "string" && !r.path) return result;
  return {
    ok: r.ok !== false,
    format: r.format,
    path: r.path,
    url: r.url,
    captured: true,
    ...(typeof r.image === "string" ? { bytes: r.image.length } : {}),
  };
}

export function screenshotImageFromRuns(_runs: ToolRun[]): string | undefined {
  return undefined;
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
  const warns = Array.isArray(result.warnings) ? result.warnings.length : 0;
  if (!changed) return matched ? "No IR changes (values already set) — synced live canvas." : "Nothing matched.";
  const diff = Array.isArray(result.diff) ? result.diff : [];
  const ids = diff.map((row) => String((row as Record<string, unknown>).id ?? "")).filter(Boolean);
  const warnNote = warns ? ` (${warns} field${warns === 1 ? "" : "s"} won't show on canvas)` : "";
  if (ids.length === 1) return `Updated ${ids[0]}.${warnNote}`;
  if (ids.length) return `Updated ${ids.length} objects.${warnNote}`;
  return `Updated ${changed} field${changed === 1 ? "" : "s"}.${warnNote}`;
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
  if (name === "design_copy_styles") {
    const from = String(r.from ?? "");
    const to = String(r.to ?? "");
    if (r.unchanged) return `Styles on ${to} already match ${from} — refreshed canvas.`;
    const n = Number(r.changed ?? 0);
    return n ? `Copied styles ${from} → ${to} (${n} slot${n === 1 ? "" : "s"}).` : `Copied styles ${from} → ${to}.`;
  }
  if (name === "design_create") {
    const created = Array.isArray(r.created) ? r.created.map(String) : [];
    return created.length ? `Created ${created.join(", ")}.` : "Nothing created.";
  }
  if (name === "design_export") return r.dsl || r.document ? "Exported design." : "Export failed.";
  if (name === "design_screenshot") {
    if (r.ok === false) return String(r.error ?? "Screenshot failed.");
    const path = typeof r.path === "string" ? r.path : "";
    return path
      ? `Wrote canvas screenshot to ${path}. Emit image_understand to read it.`
      : r.image || r.captured
        ? "Captured a canvas screenshot."
        : "Screenshot pending.";
  }
  if (name === "image_understand") {
    if (r.ok === false) return String(r.error ?? understandAnswer(r) ?? "image_understand failed.");
    const answer = understandAnswer(r);
    if (answer) return answer;
    return "Read the screenshot.";
  }
  if (name === "design_set_page_background") {
    if (Array.isArray(r.diff) && r.diff.length) return "Set page background.";
    return r.changed ? "Cleared page background." : "Page background unchanged.";
  }
  if (name === "design_insert_image") {
    const created = Array.isArray(r.created) ? r.created.map(String) : [];
    return created.length ? `Inserted image ${created.join(", ")}.` : "Image insert failed.";
  }
  if (name === "image_create" || name === "image_transform") {
    const path = outputPathFromEnvelope(r);
    return path ? `Wrote ${path}.` : "Image tool finished.";
  }
  if (name === "design") return String(r.error ?? "Design error.");
  return "Done.";
}

function understandAnswer(r: Record<string, unknown>): string | undefined {
  const direct = r.answer ?? r.text ?? r.result ?? r.content;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const results = Array.isArray(r.results) ? r.results : [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
    const text = rec.text ?? rec.answer ?? rec.content ?? rec.output;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return undefined;
}

function outputPathFromEnvelope(r: Record<string, unknown>): string | undefined {
  const results = Array.isArray(r.results) ? r.results : [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const out = rec.output_path ?? rec.path;
    if (typeof out === "string" && out.trim()) return out.trim();
  }
  return undefined;
}

function isNoopToolCallsText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact === '{"tool_calls":[]}' || compact === '{"tool_calls":null}' || compact === "[]";
}

/** Bubble text after host-run tools — strips JSON, keeps short model prose if any. */
export function assistantDisplayText(
  raw: string,
  runs: ToolRun[],
  opts?: { truncated?: boolean; parseFailed?: boolean },
): string {
  const stripped = stripDesignToolJsonFromText(raw).trim();
  const prose = isNoopToolCallsText(stripped) || isNoopToolCallsText(raw.trim()) ? "" : stripped;
  const toolLine = runs.length
    ? assistantReplyForDesignTools(runs, { truncated: opts?.truncated })
    : opts?.parseFailed
      ? designToolParseFailureMessage(raw, 0)
      : "";
  const keepProse = prose.length > 0 && !/^done\.?$/i.test(prose) && !/design_[a-z_]+/i.test(prose);
  if (keepProse && toolLine) return `${prose}\n\n${toolLine}`;
  if (toolLine) return toolLine;
  if (keepProse) return prose;
  return prose;
}

/** Warn only when truncation likely blocked the edit (not trailing junk after a successful run). */
export function shouldWarnDesignResponseTruncation(opts: {
  truncatedJson: boolean;
  finishReason?: string | null;
  runs: ToolRun[];
  parsedCount: number;
}): boolean {
  if (opts.finishReason === "length") return true;
  if (!opts.truncatedJson) return false;
  if (!opts.parsedCount || !opts.runs.length) return true;
  if (opts.runs.some((row) => rec(row.result).ok === false)) return true;
  return false;
}

/** Short assistant bubble (no raw JSON). */
export function assistantReplyForDesignTools(runs: ToolRun[], opts?: { truncated?: boolean }): string {
  if (!runs.length) return "I couldn't apply that change.";
  const lines = runs.map((row) => oneLine(row.name, row.result));
  const errors = runs.filter((row) => rec(row.result).ok === false);
  const body = errors.length === runs.length ? lines.join(" ") : lines.join(" ");
  if (opts?.truncated) return `${body} (response cut off — retry if the canvas did not update.)`;
  return body;
}

/** User-facing message when design tool JSON was seen but not parsed. */
export function designToolParseFailureMessage(text: string, parsedCount: number): string {
  if (parsedCount > 0) return "";
  if (!/design_[a-z_]+/i.test(text)) {
    return "The model described the scene instead of emitting a tool call. Ask for the change again in one short request.";
  }
  if (looksTruncatedDesignToolJson(text) || looksTruncatedDesignToolJson(stripDesignToolJsonFromText(text))) {
    return "The tool call was cut off before it finished (truncated JSON). Try again or ask for a smaller change.";
  }
  return "Couldn't parse the tool JSON (mixed with a scene report). Ask for the same change again.";
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
