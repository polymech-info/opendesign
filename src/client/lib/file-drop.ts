export type UploadKind = "images" | "backgrounds" | "icons";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function isSvgFile(file: File): boolean {
  return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

export function isSvgUrl(url: string): boolean {
  return /\.svg(\?|#|$)/i.test(url) || url.startsWith("data:image/svg+xml");
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name);
}

export function isFileDrag(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types || []).includes("Files");
}

/** Call from dragenter/dragover/drop. Without this, Explorer→Chrome drops are rejected. */
export function acceptFileDrag(event: DragEvent): boolean {
  if (!isFileDrag(event.dataTransfer)) return false;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  return true;
}

export function imageFilesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null | undefined) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === "file") push(item.getAsFile());
  }
  for (const file of Array.from(dt.files || [])) push(file);
  return out;
}

export type UploadedImage = { url: string; key: string };

export async function uploadImageFileMeta(file: File, kind: UploadKind = "images"): Promise<UploadedImage | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  try {
    const resp = await fetch("/api/uploads", { method: "POST", body: form });
    const data = (await resp.json()) as { url?: string; key?: string };
    if (data.url && data.key) {
      window.dispatchEvent(new Event("opend-uploads-changed"));
      return { url: data.url, key: data.key };
    }
  } catch (e) {
    console.error("Upload failed:", e);
  }
  return null;
}

export async function uploadImageFile(file: File, kind: UploadKind = "images"): Promise<string | null> {
  const uploaded = await uploadImageFileMeta(file, kind);
  return uploaded?.url ?? null;
}
