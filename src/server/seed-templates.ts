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
];
