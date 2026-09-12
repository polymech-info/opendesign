export interface CanvasSize {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_SIZE_MIN = 100;
export const CANVAS_SIZE_MAX = 8192;

export const CANVAS_SIZES: CanvasSize[] = [
  { label: "Screenshot / HD", width: 1920, height: 1080 },
  { label: "Screenshot / 2K", width: 2560, height: 1440 },
  { label: "LinkedIn Square", width: 1080, height: 1080 },
  { label: "LinkedIn Landscape", width: 1200, height: 627 },
  { label: "LinkedIn Portrait", width: 1200, height: 1500 },
  { label: "Instagram Story", width: 1080, height: 1920 },
  { label: "Phone", width: 390, height: 844 },
  { label: "A4", width: 794, height: 1123 },
];

export function normalizeCanvasSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < CANVAS_SIZE_MIN || h < CANVAS_SIZE_MIN) return null;
  return {
    width: Math.min(CANVAS_SIZE_MAX, w),
    height: Math.min(CANVAS_SIZE_MAX, h),
  };
}

export function matchCanvasSize(width: number, height: number): CanvasSize | undefined {
  return CANVAS_SIZES.find((s) => s.width === width && s.height === height);
}

export function canvasSizeLabel(width: number, height: number): string {
  return matchCanvasSize(width, height)?.label ?? `${width} × ${height}`;
}
