/** 1 mm in PDF points (1/72 in). */
export const MM_TO_PT = 72 / 25.4;
/** Canvas pixels are authored at 96 dpi unless the size is a known paper preset. */
export const CANVAS_DPI = 96;

export type IsoPaper = "A4" | "A5" | "A6";

export type PdfPageSize = {
  width: number;
  height: number;
  paper?: IsoPaper;
};

const ISO_PT: Record<IsoPaper, { w: number; h: number }> = {
  A4: { w: 210 * MM_TO_PT, h: 297 * MM_TO_PT },
  A5: { w: 148 * MM_TO_PT, h: 210 * MM_TO_PT },
  A6: { w: 105 * MM_TO_PT, h: 148 * MM_TO_PT },
};

/** Same 96 dpi boxes as the paper templates / canvas presets. */
const ISO_CANVAS: { w: number; h: number; paper: IsoPaper }[] = [
  { w: 794, h: 1123, paper: "A4" },
  { w: 559, h: 794, paper: "A5" },
  { w: 397, h: 559, paper: "A6" },
];

export function pdfPageSize(widthPx: number, heightPx: number): PdfPageSize {
  const w = Math.round(Number(widthPx));
  const h = Math.round(Number(heightPx));
  for (const box of ISO_CANVAS) {
    if (w === box.w && h === box.h) {
      const pt = ISO_PT[box.paper];
      return { width: pt.w, height: pt.h, paper: box.paper };
    }
    if (w === box.h && h === box.w) {
      const pt = ISO_PT[box.paper];
      return { width: pt.h, height: pt.w, paper: box.paper };
    }
  }
  return { width: (w * 72) / CANVAS_DPI, height: (h * 72) / CANVAS_DPI };
}
