import fs from "node:fs";
import path from "node:path";
import type { Roots } from "./paths.js";

export function pngFileSlug(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "design";
}

export function nextProjectPngName(dir: string, title: string) {
  const slug = pngFileSlug(title);
  const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+)\\.png$`, "i");
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(re);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `${slug}_${max + 1}.png`;
}

export function writeProjectDesignPng(roots: Roots, title: string, bytes: Buffer) {
  const dir = path.join(roots.project, "designs");
  fs.mkdirSync(dir, { recursive: true });
  const filename = nextProjectPngName(dir, title);
  const file = path.join(dir, filename);
  fs.writeFileSync(file, bytes);
  return {
    path: file,
    filename,
    relative: `.OpenDesign/designs/${filename}`,
  };
}

/** App chrome screenshot → `<cwd>/docs/assets/screenshot_n.png`. */
export function writeDocsAssetScreenshot(roots: Roots, bytes: Buffer) {
  const dir = path.join(roots.cwd, "docs", "assets");
  fs.mkdirSync(dir, { recursive: true });
  const filename = nextProjectPngName(dir, "screenshot");
  const file = path.join(dir, filename);
  fs.writeFileSync(file, bytes);
  return {
    path: file,
    filename,
    relative: `docs/assets/${filename}`,
  };
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngBytesFromDataUrl(image: string): Buffer | null {
  const parsed = imageBytesFromDataUrl(image);
  return parsed?.ext === "png" ? parsed.bytes : null;
}

export function imageBytesFromDataUrl(image: string): { bytes: Buffer; ext: "png" | "jpg" } | null {
  const raw = image.trim();
  const match = raw.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/i);
  const kind = match?.[1]?.toLowerCase();
  const b64 = match?.[2] ?? (/^[A-Za-z0-9+/=\s]+$/.test(raw) ? raw : "");
  if (!b64) return null;
  try {
    const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
    if (kind === "jpeg" || kind === "jpg") {
      return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 ? { bytes, ext: "jpg" } : null;
    }
    if (bytes.length > 8 && bytes.subarray(0, 8).equals(PNG_SIG)) return { bytes, ext: "png" };
    return null;
  } catch {
    return null;
  }
}
