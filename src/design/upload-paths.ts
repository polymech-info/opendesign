/** Normalize model/host paths to OpenDesign upload keys (under .OpenDesign/). */
export function normalizeUploadKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  let key = trimmed.replace(/\\/g, "/");
  if (key.startsWith("/api/uploads/file/")) key = key.slice("/api/uploads/file/".length);
  if (key.startsWith("http://") || key.startsWith("https://")) {
    const m = key.match(/\/api\/uploads\/file\/(.+)$/);
    if (m) key = m[1];
  }
  const uploadsAt = key.toLowerCase().indexOf("/uploads/");
  if (uploadsAt >= 0) key = key.slice(uploadsAt + 1);
  key = key.replace(/^\/+/, "");
  if (key.startsWith(".OpenDesign/")) key = key.slice(".OpenDesign/".length);
  return key;
}

export function uploadPublicUrl(key: string): string {
  if (key.startsWith("data:") || key.startsWith("blob:")) return key;
  const safe = normalizeUploadKey(key);
  if (safe.startsWith("data:") || safe.startsWith("blob:")) return safe;
  return `/api/uploads/file/${safe}`;
}

/** Accept upload key, relative path, or public URL → canonical upload key. */
export function resolveUploadKey(src: string): string {
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  const key = normalizeUploadKey(src);
  if (!key.startsWith("uploads/")) {
    if (key.startsWith("backgrounds/")) return `uploads/${key}`;
    if (!key.includes("/")) return `uploads/${key}`;
    return key;
  }
  return key;
}

export function isBackgroundUploadKey(key: string): boolean {
  return resolveUploadKey(key).startsWith("uploads/backgrounds/");
}

export function isScreenshotUploadKey(key: string): boolean {
  return resolveUploadKey(key).startsWith("uploads/screenshots/");
}

export function isCanvasImageUploadKey(key: string): boolean {
  const k = resolveUploadKey(key);
  return (
    k.startsWith("uploads/") &&
    !k.startsWith("uploads/backgrounds/") &&
    !k.startsWith("uploads/icons/") &&
    !k.startsWith("uploads/screenshots/")
  );
}

/** Join an upload key onto the absolute `.OpenDesign` project root (Tanit cwd). */
export function joinProjectPath(projectRoot: string, key: string): string {
  const root = projectRoot.trim().replace(/[/\\]+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const rel = resolveUploadKey(key).replace(/[/\\]+/g, sep);
  return `${root}${sep}${rel}`;
}

/** Path `image_understand` should copy: absolute when project root is known, else the upload key. */
export function pictureUnderstandPath(projectRoot: string | undefined, src: string): string | null {
  const key = normalizeUploadKey(src);
  if (!key.startsWith("uploads/") || key.startsWith("http://") || key.startsWith("https://") || key.startsWith("data:")) {
    return null;
  }
  if (projectRoot?.trim()) return joinProjectPath(projectRoot, key);
  return key;
}

export function uploadPathHints(): string {
  return [
    "CWD=.OpenDesign — image_create/image_transform/image_understand accept relative upload keys or the absolute PICTURES paths",
    "page bg: output_path uploads/backgrounds/{slug}-v{n}.png → design_set_page_background",
    "canvas img: output_path uploads/{slug}-v{n}.png → design_insert_image",
    "screenshot: design_screenshot → uploads/screenshots/canvas.jpg then image_understand paths=[that exact path]",
    "iterate: image_transform paths=[prev] output_path uploads/.../slug-v{n+1}.png",
    "URL form: /api/uploads/file/uploads/backgrounds/hero-v1.png",
  ].join("\n");
}
