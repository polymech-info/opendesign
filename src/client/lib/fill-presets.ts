import * as fabric from "fabric";

export const GRADIENT_PRESETS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(180deg, #0f172a 0%, #1e3a8a 100%)",
  "linear-gradient(120deg, #111827 0%, #374151 55%, #9ca3af 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #7c3aed 100%)",
  "linear-gradient(90deg, #ec4899 0%, #8b5cf6 100%)",
  "linear-gradient(160deg, #ecfccb 0%, #22c55e 100%)",
  "linear-gradient(135deg, #fff7ed 0%, #fdba74 40%, #c2410c 100%)",
  "linear-gradient(180deg, #e0f2fe 0%, #0369a1 100%)",
  "linear-gradient(135deg, #18181b 0%, #27272a 40%, #fafafa 100%)",
] as const;

export const OPACITY_PRESETS = [1, 0.8, 0.6, 0.4, 0.2, 0.1] as const;

export const FILL_COLORS = [
  "#6366f1",
  "#0f172a",
  "#ffffff",
  "#f8fafc",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#e2e8f0",
];

function tile(inner: string, size = 40, bg = "#eef2ff") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${bg}"/>${inner}</svg>`;
}

export const PATTERN_PRESETS: { id: string; label: string; svg: string }[] = [
  {
    id: "dots",
    label: "Dots",
    svg: tile(
      `<circle cx="8" cy="8" r="2.2" fill="#6366f1"/><circle cx="28" cy="8" r="2.2" fill="#6366f1"/><circle cx="8" cy="28" r="2.2" fill="#6366f1"/><circle cx="28" cy="28" r="2.2" fill="#6366f1"/>`
    ),
  },
  {
    id: "grid",
    label: "Grid",
    svg: tile(
      `<path d="M0 20h40M20 0v40" stroke="#6366f1" stroke-width="1.2" fill="none"/>`,
      40,
      "#f8fafc"
    ),
  },
  {
    id: "diag",
    label: "Diagonal",
    svg: tile(
      `<path d="M-8 12 L12 -8M0 40 L40 0M28 48 L48 28" stroke="#6366f1" stroke-width="4" fill="none"/>`,
      40,
      "#eef2ff"
    ),
  },
  {
    id: "plus",
    label: "Plus",
    svg: tile(
      `<path d="M20 10v20M10 20h20" stroke="#4338ca" stroke-width="3" stroke-linecap="round"/>`,
      40,
      "#e0e7ff"
    ),
  },
  {
    id: "chevron",
    label: "Chevron",
    svg: tile(
      `<path d="M6 14l14 12 14-12" stroke="#6366f1" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      40,
      "#eef2ff"
    ),
  },
  {
    id: "paper",
    label: "Paper",
    svg: tile(
      `<circle cx="6" cy="11" r="1.1" fill="#94a3b8"/><circle cx="22" cy="7" r="0.9" fill="#cbd5e1"/><circle cx="33" cy="18" r="1.2" fill="#94a3b8"/><circle cx="14" cy="27" r="0.8" fill="#64748b"/><circle cx="29" cy="32" r="1" fill="#94a3b8"/>`,
      40,
      "#f1f5f9"
    ),
  },
];

export function cssLinearToFabricGradient(css: string, width: number, height: number) {
  const angleMatch = css.match(/linear-gradient\(\s*([-\d.]+)deg/i);
  const deg = angleMatch ? parseFloat(angleMatch[1]) : 135;
  const stops = [...css.matchAll(/#([0-9a-f]{3,8})(?:\s+([\d.]+)%)?/gi)];
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return new fabric.Gradient({
    type: "linear",
    gradientUnits: "pixels",
    coords: {
      x1: cx - dx * half,
      y1: cy - dy * half,
      x2: cx + dx * half,
      y2: cy + dy * half,
    },
    colorStops: stops.map((m, i, arr) => ({
      offset: m[2] != null ? parseFloat(m[2]) / 100 : i / Math.max(arr.length - 1, 1),
      color: `#${m[1]}`,
    })),
  });
}

export function gradientFillForObject(obj: fabric.FabricObject, css: string) {
  return cssLinearToFabricGradient(css, obj.width || 100, obj.height || 100);
}

export async function patternFillFromSvg(svg: string) {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("pattern"));
    el.src = url;
  });
  return new fabric.Pattern({ source: img, repeat: "repeat" });
}
