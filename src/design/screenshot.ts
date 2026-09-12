/** Persist a canvas JPEG and return a cwd-relative path the model can pass to image_understand. */

export const CANVAS_SCREENSHOT_KEY = "uploads/screenshots/canvas.jpg";

let lastScreenshotKey: string | undefined;

export function rememberScreenshotPath(path: string) {
  const key = path.trim().replace(/\\/g, "/");
  if (key) lastScreenshotKey = key;
}

export function lastScreenshotPath(): string | undefined {
  return lastScreenshotKey;
}

export function looksLikeScreenshotPath(raw: string): boolean {
  const key = raw.trim().replace(/\\/g, "/");
  if (!key) return false;
  if (key.includes("/screenshots/") || key.endsWith("/canvas.jpg")) return true;
  if (/uploads\/\d+_[a-z0-9]+\.jpe?g$/i.test(key)) return true;
  return /canvas[-_.]/i.test(key);
}

/** Prefer the file we just wrote — models often drop a digit from Date.now() names. */
export function resolveUnderstandPaths(requested: string[]): string[] {
  const last = lastScreenshotKey;
  if (!requested.length) return last ? [last] : [];
  if (!last) return requested;
  return requested.map((path) => (looksLikeScreenshotPath(path) ? last : path));
}

export type ScreenshotPersistResult =
  | { ok: true; format: "jpeg"; path: string; url: string }
  | { ok: false; error: string };

function rec(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}

export function screenshotPathFromResult(result: unknown): string | undefined {
  const path = rec(result).path;
  return typeof path === "string" && path.trim() ? path.trim() : undefined;
}

export function screenshotPathFromRuns(runs: Array<{ name: string; result: unknown }>): string | undefined {
  for (const row of runs) {
    if (row.name !== "design_screenshot" && row.name !== "design_export") continue;
    const path = screenshotPathFromResult(row.result);
    if (path) return path;
  }
  return undefined;
}

export function screenshotFollowUpText(path: string, url?: string): string {
  const result = url ? { ok: true, path, url } : { ok: true, path };
  return [
    `{"name":"design_screenshot","result":${JSON.stringify(result)}}`,
    "If you need a visual read, emit image_understand with paths and a prompt. Do not call design_screenshot again.",
  ].join("\n");
}

export function understandFollowUpText(result: unknown): string {
  return [
    `{"name":"image_understand","result":${JSON.stringify(result ?? {})}}`,
    "Emit design_* to edit the canvas if needed.",
  ].join("\n");
}

export function toolFollowUpFromRuns(
  runs: Array<{ name: string; result: unknown }>,
  flags: { canFollowShot: boolean; canFollowUnderstand: boolean },
): { kind: "screenshot" | "understand"; content: string } | null {
  if (flags.canFollowShot) {
    const path = screenshotPathFromRuns(runs.filter((row) => row.name === "design_screenshot"));
    if (path) {
      const shot = runs.find((row) => row.name === "design_screenshot");
      const url = rec(shot?.result).url;
      return {
        kind: "screenshot",
        content: screenshotFollowUpText(path, typeof url === "string" ? url : undefined),
      };
    }
  }
  if (flags.canFollowUnderstand) {
    const understand = runs.find((row) => row.name === "image_understand");
    if (understand) {
      return { kind: "understand", content: understandFollowUpText(understand.result) };
    }
  }
  return null;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = /data:([^;]+)/.exec(header)?.[1] || "image/jpeg";
  const bytes = Uint8Array.from(atob(payload), (ch) => ch.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

/** Capture JPEG → .OpenDesign/uploads/screenshots/… (Tanit cwd). No pixels returned to chat. */
export async function persistCanvasScreenshot(dataUrl: string | null): Promise<ScreenshotPersistResult> {
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    return { ok: false, error: "no active canvas to screenshot" };
  }
  const blob = dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append("file", blob, "canvas.jpg");
  form.append("kind", "screenshots");
  form.append("filename", "canvas.jpg");
  form.append("key", CANVAS_SCREENSHOT_KEY);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { key?: string; url?: string; error?: string };
  if (!res.ok || !body.key) {
    return { ok: false, error: body.error ?? `screenshot upload HTTP ${res.status}` };
  }
  rememberScreenshotPath(body.key);
  return { ok: true, format: "jpeg", path: body.key, url: body.url || `/api/uploads/file/${body.key}` };
}
