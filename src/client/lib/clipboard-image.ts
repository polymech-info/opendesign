import { uploadImageFile } from "./file-drop";

export async function imageBlobFromClipboard(event?: ClipboardEvent): Promise<Blob | null> {
  if (event?.clipboardData) {
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    for (const file of Array.from(event.clipboardData.files)) {
      if (file.type.startsWith("image/")) return file;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) return await item.getType(type);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extensionFor(blob: Blob): string {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/gif") return "gif";
  if (blob.type === "image/svg+xml") return "svg";
  return "png";
}

export async function saveClipboardImageToUploads(blob: Blob): Promise<string | null> {
  const ext = extensionFor(blob);
  const file = new File([blob], `clipboard-${Date.now()}.${ext}`, {
    type: blob.type || "image/png",
  });
  return uploadImageFile(file, "images");
}
