export interface Design {
  id: string;
  name: string;
  canvas_json: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  thumbnail_at?: string | null;
  created_at: string;
  updated_at: string;
  updated_by?: "editor" | "cli";
}

export interface DesignRevision {
  id: string;
  updated_at: string;
  updated_by?: "editor" | "cli";
}

export interface DesignVersion {
  id: string;
  design_id: string;
  rev: number;
  kind: "auto" | "manual";
  title: string;
  description: string;
  created_at: string;
  created_by: "editor" | "cli";
  content_hash: string;
  name: string;
  width: number;
  height: number;
}

export interface Page {
  id: string;
  design_id: string;
  title: string;
  canvas_json: string;
  sort_order: number;
  created_at: string;
}

export interface DesignWithPages extends Design {
  pages: Page[];
}

export interface DesignVersionDetail extends DesignVersion {
  canvas_json: string;
  pages: Page[];
  thumbnail_url?: string | null;
}

export interface Template {
  id: string;
  name: string;
  category: string;
  canvas_json: string;
  width: number;
  height: number;
  thumbnail_url: string | null;
  sort_order: number;
}

export interface LibraryElement {
  id: string;
  name: string;
  canvas_json: string;
  width: number;
  height: number;
  created_at: string;
}

export interface SavedStyle {
  id: string;
  name: string;
  swatch?: string;
  style: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  source?: "global" | "project";
}
