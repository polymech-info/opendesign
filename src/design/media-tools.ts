import { findNode } from "./types";
import { insertImage, replaceImageSrc, setPageBackground } from "./mutate";
import {
  isBackgroundUploadKey,
  isCanvasImageUploadKey,
  normalizeUploadKey,
  resolveUploadKey,
  uploadPublicUrl,
} from "./upload-paths";
import { lastScreenshotPath, resolveUnderstandPaths } from "./screenshot";
import { parseEmittedToolCalls, type ToolCall } from "./tools";
import type { DesignDocument } from "./types";

export const MEDIA_TOOLS = new Set(["image_create", "image_transform", "transform", "image_understand"]);

export type MediaToolRun = { name: string; result: unknown; outputPath?: string };

export function isMediaToolName(name: string): boolean {
  return MEDIA_TOOLS.has(name);
}

export function outputPathFromToolResult(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;
  const results = Array.isArray(r.results) ? r.results : [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const out = rec.output_path ?? rec.path;
    if (typeof out === "string" && out.trim()) return out.trim();
  }
  if (typeof r.output_path === "string" && r.output_path.trim()) return r.output_path.trim();
  return undefined;
}

function slugFromPath(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? "image";
  return base.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "image";
}

export type MediaApplyOpts = {
  id?: string;
  replaceId?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

export function autoApplyUploadPath(
  doc: DesignDocument,
  outputPath: string,
  opts?: MediaApplyOpts,
): { tool: string; result: unknown } | null {
  const key = resolveUploadKey(outputPath);
  if (isBackgroundUploadKey(key)) {
    return { tool: "design_set_page_background", result: setPageBackground(doc, { src: key }) };
  }
  if (isCanvasImageUploadKey(key)) {
    const replaceId = opts?.replaceId ?? opts?.id;
    if (replaceId && findNode(doc, replaceId)?.type === "img") {
      return { tool: "design_update", result: replaceImageSrc(doc, replaceId, key) };
    }
    const id = opts?.id ?? `img.${slugFromPath(key)}`;
    if (findNode(doc, id)) {
      return { tool: "design_update", result: replaceImageSrc(doc, id, key) };
    }
    return {
      tool: "design_insert_image",
      result: insertImage(doc, {
        id,
        src: key,
        x: opts?.x ?? Math.round(doc.canvas.width * 0.25),
        y: opts?.y ?? Math.round(doc.canvas.height * 0.2),
        w: opts?.w ?? Math.round(doc.canvas.width * 0.5),
        h: opts?.h ?? Math.round(doc.canvas.height * 0.5),
      }),
    };
  }
  return null;
}

function normalizeUnderstandArgs(args: Record<string, unknown>): Record<string, unknown> {
  const paths: string[] = [];
  if (Array.isArray(args.paths)) paths.push(...args.paths.map(String));
  if (typeof args.path === "string" && args.path.trim()) paths.push(args.path);
  if (typeof args.input === "string" && args.input.trim()) paths.push(args.input);
  if (Array.isArray(args.input)) paths.push(...args.input.map(String));
  const resolved = resolveUnderstandPaths(paths.map((p) => resolveUploadKey(p)).filter(Boolean));
  const prompt = String(
    args.prompt ?? args.question ?? args.reason ?? "Describe this canvas screenshot. Note overlaps, stacking, clipped text, and positions.",
  );
  return { ...args, paths: resolved, prompt };
}

function intendedOutputPath(args: Record<string, unknown>): string | undefined {
  if (typeof args.output_path === "string" && args.output_path.trim()) return args.output_path.trim();
  const paths = args.paths;
  if (Array.isArray(paths) && typeof paths[0] === "string" && paths[0].trim()) return paths[0].trim();
  const outputPaths = args.output_paths;
  if (Array.isArray(outputPaths) && typeof outputPaths[0] === "string" && outputPaths[0].trim()) {
    return outputPaths[0].trim();
  }
  return undefined;
}

async function uploadAlreadyExists(key: string): Promise<boolean> {
  try {
    const res = await fetch(uploadPublicUrl(resolveUploadKey(key)), { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

function syntheticOkResult(tool: string, outputPath: string): Record<string, unknown> {
  return {
    ok: true,
    tool,
    results: [{ ok: true, output_path: outputPath, path: outputPath }],
    summary: { total: 1, succeeded: 1, failed: 0 },
    reused: true,
  };
}

export function parseEmittedMediaCalls(text: string): ToolCall[] {
  return parseEmittedToolCalls(text).filter((c) => MEDIA_TOOLS.has(c.name));
}

function rec(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

export function pathToolFailed(result: unknown): boolean {
  const r = rec(result);
  if (r.ok === false) return true;
  if (Number((r.summary as { failed?: number } | undefined)?.failed ?? 0) > 0) return true;
  const results = Array.isArray(r.results) ? r.results : [];
  return results.some((row) => row && typeof row === "object" && (row as { ok?: boolean }).ok === false);
}

export function pathToolError(result: unknown): string {
  const r = rec(result);
  if (typeof r.error === "string" && r.error.trim()) return r.error;
  const results = Array.isArray(r.results) ? r.results : [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const err = (row as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return "path tool failed";
}

export function flattenPathToolResult(result: unknown): unknown {
  if (!pathToolFailed(result)) return result;
  return { ...rec(result), ok: false, error: pathToolError(result) };
}

export async function callPathTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch("/api/path-tools/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: name === "transform" ? "image_transform" : name, arguments: args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: (body as { error?: string }).error ?? `path tool HTTP ${res.status}` };
  }
  return flattenPathToolResult(body);
}

export type MediaSelection = { id?: string; srcKey?: string };

export type ApplyMediaOptions = {
  /** When false, only auto-apply from existing uploads / tool results. */
  execute?: boolean;
  selection?: MediaSelection;
  onDocChange?: (doc: DesignDocument) => void;
};

function applyOptsFromArgs(args: Record<string, unknown>, selection?: MediaSelection): MediaApplyOpts {
  const apply = args.apply;
  const rec = apply && typeof apply === "object" ? (apply as Record<string, unknown>) : {};
  const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
  const replaceId =
    typeof rec.replace_id === "string"
      ? rec.replace_id
      : typeof rec.id === "string"
        ? rec.id
        : selection?.id &&
            paths.length &&
            selection.srcKey &&
            resolveUploadKey(paths[0]) === resolveUploadKey(selection.srcKey)
          ? selection.id
          : selection?.id && !isBackgroundUploadKey(resolveUploadKey(intendedOutputPath(args) ?? ""))
            ? selection.id
            : undefined;
  return {
    id: typeof rec.id === "string" ? rec.id : undefined,
    replaceId,
    x: rec.x != null ? Number(rec.x) : undefined,
    y: rec.y != null ? Number(rec.y) : undefined,
    w: rec.w != null ? Number(rec.w) : undefined,
    h: rec.h != null ? Number(rec.h) : undefined,
  };
}

/** Apply canvas IR change from a completed image_create/image_transform result. */
export function applyUploadFromToolResult(
  doc: DesignDocument,
  toolName: string,
  result: unknown,
  args?: Record<string, unknown>,
  opts?: { selection?: MediaSelection },
): { tool: string; result: unknown; outputPath: string } | null {
  const outputPath =
    outputPathFromToolResult(result) ?? (args ? intendedOutputPath(args) : undefined);
  if (!outputPath) return null;
  const r = result as { ok?: boolean } | null;
  if (r && r.ok === false) return null;
  const auto = autoApplyUploadPath(
    doc,
    outputPath,
    args ? applyOptsFromArgs(args, opts?.selection) : undefined,
  );
  if (!auto?.result || typeof auto.result !== "object" || !(auto.result as { ok?: boolean }).ok) return null;
  return { tool: auto.tool, result: auto.result, outputPath: normalizeUploadKey(outputPath) };
}

/** Run emitted image_create/image_transform/image_understand; auto-apply writes only (not understand). */
export async function applyEmittedMediaTools(
  text: string,
  doc: DesignDocument | null,
  opts?: ApplyMediaOptions,
): Promise<MediaToolRun[]> {
  const calls = parseEmittedMediaCalls(text);
  if (!calls.length) return [];
  const out: MediaToolRun[] = [];
  for (const call of calls) {
    const name = call.name === "transform" ? "image_transform" : call.name;
    const understand = name === "image_understand";
    const args = understand ? normalizeUnderstandArgs(call.arguments) : call.arguments;
    const intended = understand ? undefined : intendedOutputPath(args);
    let result: unknown;

    if (understand && !(args.paths as string[] | undefined)?.length) {
      result = { ok: false, error: "image_understand needs paths (from design_screenshot result)" };
    } else if (opts?.execute === false) {
      result = intended ? syntheticOkResult(name, intended) : { ok: true, skipped: true };
    } else if (!understand && intended && await uploadAlreadyExists(intended)) {
      result = syntheticOkResult(name, intended);
    } else {
      try {
        result = await callPathTool(name, args);
        if (understand && pathToolFailed(result)) {
          const last = lastScreenshotPath();
          const used = Array.isArray(args.paths) ? String(args.paths[0] ?? "") : "";
          if (last && used !== last) {
            result = await callPathTool(name, { ...args, paths: [last] });
          }
        }
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    const outputPath = understand ? undefined : outputPathFromToolResult(result) ?? intended;
    out.push({ name, result, outputPath });

    if (understand || !doc || !outputPath) continue;
    const applied = applyUploadFromToolResult(doc, name, result, args, {
      selection: opts?.selection,
    });
    if (applied) {
      out.push({ name: applied.tool, result: applied.result, outputPath: applied.outputPath });
      opts?.onDocChange?.(doc);
    }
  }
  return out;
}
