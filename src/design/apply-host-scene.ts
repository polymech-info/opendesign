import { planCanvasApply, type CanvasPatchPlan } from "./apply-plan";
import { isMediaWriteTool, pathToolFailed } from "./media-tools";
import { dispatchDesignTool, MUTATING_DESIGN_TOOLS } from "./tools";
import type { DesignDocument } from "./types";

export type HostToolRun = {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  result: unknown;
};

function rec(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
}

function nonemptyArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length ? value : undefined;
}

/** Host persist finished — the open canvas must apply or reload. */
export function hostToolRunNeedsSceneRefresh(name: string, result: unknown): boolean {
  const r = rec(result);
  if (r.pending || r.ok === false) return false;
  if (isMediaWriteTool(name)) return !pathToolFailed(result);
  if (!MUTATING_DESIGN_TOOLS.has(name)) return false;
  return r.saved === true || Number(r.changed) > 0 || Boolean(nonemptyArray(r.touched));
}

export function hostToolRunsNeedSceneRefresh(runs: HostToolRun[]): boolean {
  return runs.some((run) => hostToolRunNeedsSceneRefresh(run.name, run.result));
}

export function hostToolSceneKey(run: HostToolRun): string | undefined {
  if (!hostToolRunNeedsSceneRefresh(run.name, run.result)) return undefined;
  const r = rec(run.result);
  return run.id || `${run.name}:${String(r.revision_after ?? JSON.stringify(r.touched ?? r.diff ?? r))}`;
}

export function takeFreshHostSceneRuns(runs: HostToolRun[], seen: Set<string>): HostToolRun[] {
  const fresh: HostToolRun[] = [];
  for (const run of runs) {
    const key = hostToolSceneKey(run);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(run);
  }
  return fresh;
}

/** Replay server-owned design_* calls onto the editor IR so the live canvas can patch. */
export function replayHostDesignRuns(
  doc: DesignDocument,
  runs: HostToolRun[],
): { plan: CanvasPatchPlan; replayed: number } {
  const merged: Array<{ name: string; result: unknown }> = [];
  let replayed = 0;
  for (const run of runs) {
    if (!MUTATING_DESIGN_TOOLS.has(run.name)) continue;
    let local: Record<string, unknown> = {};
    try {
      const out = dispatchDesignTool(run.name, run.arguments ?? {}, doc);
      if (out && typeof out === "object" && !Array.isArray(out)) local = out as Record<string, unknown>;
      replayed += 1;
    } catch {
      /* server already persisted; reloadFromDisk is the fallback */
    }
    const server = rec(run.result);
    merged.push({
      name: run.name,
      result: {
        ...local,
        ...server,
        ok: server.ok !== false,
        touched: nonemptyArray(server.touched) ?? local.touched,
        diff: nonemptyArray(server.diff) ?? local.diff,
      },
    });
  }
  return { plan: planCanvasApply(merged), replayed };
}

/** Newest persist timestamp from a batch of host tool results (ISO-8601). */
export function latestHostRevisionAfter(runs: HostToolRun[]): string | undefined {
  let latest: string | undefined;
  for (const run of runs) {
    const after = rec(run.result).revision_after;
    if (typeof after !== "string" || !after.trim()) continue;
    if (!latest || after > latest) latest = after;
  }
  return latest;
}

/** Editor save must not write a stale live canvas over a newer CLI/agent persist. */
export function shouldReloadInsteadOfSave(
  disk: { updated_at?: string; updated_by?: string },
  seenUpdatedAt: string | null,
): boolean {
  return (
    disk.updated_by === "cli" &&
    Boolean(seenUpdatedAt) &&
    Boolean(disk.updated_at) &&
    disk.updated_at !== seenUpdatedAt
  );
}
