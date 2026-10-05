export type JpegPdfPage = {
  jpeg: Uint8Array;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
};

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pad10(n: number) {
  return String(n).padStart(10, "0");
}

function num(n: number) {
  return (Math.round(n * 100) / 100).toString();
}

/** Minimal multi-page PDF: one JPEG image stretched to each MediaBox. */
export function buildJpegPdf(pages: JpegPdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error("PDF needs at least one page");
  const chunks: Uint8Array[] = [];
  let pos = 0;
  const offsets = [0];
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    pos += bytes.length;
  };
  const text = (s: string) => push(ascii(s));
  const obj = (id: number, body: string | Uint8Array[]) => {
    offsets[id] = pos;
    text(`${id} 0 obj\n`);
    if (typeof body === "string") text(body);
    else for (const part of body) push(part);
    text("\nendobj\n");
  };

  text("%PDF-1.4\n%\x80\x80\x80\x80\n");

  const kids: string[] = [];
  for (let i = 0; i < pages.length; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageId = 3 + i * 3;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const w = num(page.pageWidth);
    const h = num(page.pageHeight);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    obj(imageId, [
      ascii(
        `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(page.imageWidth))} /Height ${Math.max(1, Math.round(page.imageHeight))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      ),
      page.jpeg,
      ascii("\nendstream"),
    ]);
    obj(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }

  const xrefAt = pos;
  const count = 2 + pages.length * 3;
  const xref = ["xref", `0 ${count + 1}`, "0000000000 65535 f "];
  for (let i = 1; i <= count; i++) xref.push(`${pad10(offsets[i] ?? 0)} 00000 n `);
  text(`${xref.join("\n")}\n`);
  text(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concat(chunks);
}

/** SOF0/SOF2 width×height. */
export function jpegPixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

export function jpegBytesFromDataUrl(image: string): Uint8Array | null {
  const raw = image.trim();
  const match = raw.match(/^data:image\/jpeg;base64,(.+)$/i);
  const b64 = match?.[1] ?? "";
  if (!b64) return null;
  try {
    const binary = atob(b64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function pdfBytesFromDataUrl(pdf: string): Uint8Array | null {
  const raw = pdf.trim();
  const match = raw.match(/^data:application\/pdf;base64,(.+)$/i);
  const b64 = match?.[1] ?? "";
  if (!b64) return null;
  try {
    const binary = atob(b64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 5) return null;
    const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    return head === "%PDF-" ? bytes : null;
  } catch {
    return null;
  }
}

export function pdfToDataUrl(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:application/pdf;base64,${btoa(binary)}`;
}
