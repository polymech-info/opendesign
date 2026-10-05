import fs from "node:fs";
import path from "node:path";
import { pngFileSlug } from "./project-png.js";
import type { Roots } from "./paths.js";

export function nextProjectPdfName(dir: string, title: string) {
  const slug = pngFileSlug(title);
  const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_(\\d+)\\.pdf$`, "i");
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const match = name.match(re);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `${slug}_${max + 1}.pdf`;
}

export function writeProjectDesignPdf(roots: Roots, title: string, bytes: Uint8Array) {
  const dir = path.join(roots.project, "designs");
  fs.mkdirSync(dir, { recursive: true });
  const filename = nextProjectPdfName(dir, title);
  const file = path.join(dir, filename);
  fs.writeFileSync(file, Buffer.from(bytes));
  return {
    path: file,
    filename,
    relative: `.OpenDesign/designs/${filename}`,
  };
}

export function pdfBytesFromPayload(pdf: string): Buffer | null {
  const raw = pdf.trim();
  const match = raw.match(/^data:application\/pdf;base64,(.+)$/i);
  const b64 = match?.[1] ?? "";
  if (!b64) return null;
  try {
    const bytes = Buffer.from(b64.replace(/\s+/g, ""), "base64");
    return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-" ? bytes : null;
  } catch {
    return null;
  }
}
