// Starter templates shipped with the app.
//
// These used to live as an INSERT in src/server/schema.sql. Clawnify applies
// schema.sql as DDL only — a single non-DDL statement fails the whole deploy —
// so the rows moved here and are inserted by ensureSeeded() in index.ts.
//
// originX/originY are explicit: Fabric 6 defaults to center, which would
// shift every left/top from the seed JSON.

import { bundledFeatureCardsTemplate } from "../design/example.js";

export interface SeedTemplate {
  id: string;
  name: string;
  category: string;
  canvas_json: string;
  width: number;
  height: number;
  sort_order: number;
}

const leftTop = { originX: "left", originY: "top" } as const;

/** ISO 216 at 96 dpi — same scale as the A4 canvas preset (794×1123). */
function paperTemplate(
  id: string,
  name: string,
  width: number,
  height: number,
  sort_order: number,
  mm: string
): SeedTemplate {
  const margin = Math.round(width * 0.08);
  const inner = width - margin * 2;
  const titleSize = Math.max(22, Math.round(width * 0.045));
  const bodySize = Math.max(13, Math.round(width * 0.022));
  return {
    id,
    name,
    category: "paper",
    canvas_json: JSON.stringify({
      version: "6.0.0",
      objects: [
        { type: "Rect", ...leftTop, left: 0, top: 0, width, height, fill: "#ffffff" },
        { type: "Rect", ...leftTop, left: margin, top: margin, width: inner, height: 3, fill: "#111827" },
        {
          type: "Textbox",
          ...leftTop,
          left: margin,
          top: margin + 18,
          width: inner,
          text: "Title",
          fontSize: titleSize,
          fontFamily: "Playfair Display",
          fontWeight: "700",
          fill: "#111827",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: margin,
          top: margin + 18 + titleSize + 16,
          width: inner,
          text: "Body copy. Replace this page with your document, flyer, or handout.",
          fontSize: bodySize,
          fontFamily: "Inter",
          fontWeight: "400",
          fill: "#4b5563",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: margin,
          top: height - margin - bodySize - 4,
          width: inner,
          text: `${name}  ·  ${mm}  ·  ${width}×${height}`,
          fontSize: Math.max(10, bodySize - 2),
          fontFamily: "Inter",
          fontWeight: "500",
          fill: "#9ca3af",
        },
      ],
    }),
    width,
    height,
    sort_order,
  };
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  bundledFeatureCardsTemplate(),
  {
    id: "quote-card",
    name: "Quote Card",
    category: "linkedin",
    canvas_json: JSON.stringify({
      version: "6.0.0",
      objects: [
        { type: "Rect", ...leftTop, left: 0, top: 0, width: 1080, height: 1080, fill: "#1a1a2e" },
        {
          type: "Textbox",
          ...leftTop,
          left: 80,
          top: 300,
          width: 920,
          text: "Your inspiring quote goes here",
          fontSize: 48,
          fontFamily: "Playfair Display",
          fontWeight: "700",
          fill: "#ffffff",
          textAlign: "center",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 80,
          top: 900,
          width: 920,
          text: "— Author Name",
          fontSize: 24,
          fontFamily: "Inter",
          fontWeight: "500",
          fill: "#a0a0b0",
          textAlign: "center",
        },
      ],
    }),
    width: 1080,
    height: 1080,
    sort_order: 1,
  },
  {
    id: "stats-highlight",
    name: "Stats Highlight",
    category: "linkedin",
    canvas_json: JSON.stringify({
      version: "6.0.0",
      objects: [
        { type: "Rect", ...leftTop, left: 0, top: 0, width: 1080, height: 1080, fill: "#0f172a" },
        {
          type: "Textbox",
          ...leftTop,
          left: 80,
          top: 200,
          width: 920,
          text: "87%",
          fontSize: 120,
          fontFamily: "Montserrat",
          fontWeight: "900",
          fill: "#3b82f6",
          textAlign: "center",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 80,
          top: 400,
          width: 920,
          text: "of professionals agree that AI\nwill transform their industry",
          fontSize: 36,
          fontFamily: "Inter",
          fontWeight: "500",
          fill: "#e2e8f0",
          textAlign: "center",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 80,
          top: 900,
          width: 920,
          text: "Source: Industry Report 2026",
          fontSize: 18,
          fontFamily: "Inter",
          fontWeight: "400",
          fill: "#64748b",
          textAlign: "center",
        },
      ],
    }),
    width: 1080,
    height: 1080,
    sort_order: 2,
  },
  {
    id: "screenshot-card",
    name: "Screenshot Card",
    category: "screenshot",
    canvas_json: JSON.stringify({ version: "6.0.0", objects: [] }),
    width: 1920,
    height: 1080,
    sort_order: 3,
  },
  {
    id: "poster-art-9-16",
    name: "9:16 Poster art",
    category: "poster",
    canvas_json: JSON.stringify({
      version: "6.0.0",
      objects: [
        { type: "Rect", ...leftTop, left: 0, top: 0, width: 720, height: 1080, fill: "#141218" },
        { type: "Rect", ...leftTop, left: 0, top: 0, width: 720, height: 8, fill: "#e8b86d" },
        {
          type: "Textbox",
          ...leftTop,
          left: 48,
          top: 40,
          width: 624,
          text: "POSTER",
          fontSize: 14,
          fontFamily: "Inter",
          fontWeight: "700",
          fill: "#e8b86d",
          charSpacing: 280,
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 48,
          top: 72,
          width: 624,
          text: "Title of the work",
          fontSize: 56,
          fontFamily: "Playfair Display",
          fontWeight: "700",
          fill: "#f6f1e8",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 48,
          top: 196,
          width: 624,
          text: "A short line for the artist, show, or date",
          fontSize: 18,
          fontFamily: "Inter",
          fontWeight: "400",
          fill: "#c4b8a4",
        },
        {
          type: "Rect",
          ...leftTop,
          left: 48,
          top: 260,
          width: 624,
          height: 680,
          fill: "#2a2430",
          rx: 8,
          ry: 8,
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 48,
          top: 560,
          width: 624,
          text: "Art",
          fontSize: 22,
          fontFamily: "Inter",
          fontWeight: "500",
          fill: "#8a7f74",
          textAlign: "center",
        },
        {
          type: "Textbox",
          ...leftTop,
          left: 48,
          top: 1008,
          width: 624,
          text: "Venue  ·  City  ·  2026",
          fontSize: 14,
          fontFamily: "Inter",
          fontWeight: "500",
          fill: "#8a7f74",
          textAlign: "center",
        },
      ],
    }),
    width: 720,
    height: 1080,
    sort_order: 4,
  },
  paperTemplate("paper-a4", "A4 Portrait", 794, 1123, 5, "210×297 mm"),
  paperTemplate("paper-a4-landscape", "A4 Landscape", 1123, 794, 6, "297×210 mm"),
  paperTemplate("paper-a5", "A5 Portrait", 559, 794, 7, "148×210 mm"),
  paperTemplate("paper-a5-landscape", "A5 Landscape", 794, 559, 8, "210×148 mm"),
  paperTemplate("paper-a6", "A6 Portrait", 397, 559, 9, "105×148 mm"),
  paperTemplate("paper-a6-landscape", "A6 Landscape", 559, 397, 10, "148×105 mm"),
];
