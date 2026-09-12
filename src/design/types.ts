export type NodeType =
  | "canvas"
  | "shape"
  | "txt"
  | "icon"
  | "img"
  | "line"
  | "group"
  | "widget"
  | "use"
  | "video"
  | "path";

export type Rect = { x: number; y: number; w: number; h: number };

export type DesignNode = {
  id: string;
  type: NodeType;
  parentId?: string;
  widgetSource?: string;
  role?: string;
  bounds: Rect;
  preset?: string;
  style?: string;
  props: Record<string, string>;
  text?: string;
  textBinding?: string;
  src?: string;
  imageBinding?: string;
  children: string[];
};

export type WidgetDefinition = {
  id: string;
  width: number;
  height: number;
  nodes: DesignNode[];
  props: Record<string, string>;
};

export type PresetDefinition = {
  id: string;
  props: Record<string, string>;
};

export type DesignDocument = {
  canvas: { id: string; width: number; height: number };
  theme: string;
  /** Upload key e.g. uploads/backgrounds/hero-v1.png */
  pageBackground?: string;
  widgets: Record<string, WidgetDefinition>;
  presets: Record<string, PresetDefinition>;
  nodes: DesignNode[];
  content: Record<string, string>;
  errors: Array<{ id?: string; field?: string; code: string; message: string }>;
};

export const DEFAULT_FIELDS = ["id", "type", "x", "y", "w", "h", "fill", "style", "text", "role", "preset", "src"] as const;

export function emptyDocument(): DesignDocument {
  return {
    canvas: { id: "main", width: 1920, height: 1080 },
    theme: "",
    widgets: {},
    presets: {},
    nodes: [],
    content: {},
    errors: [],
  };
}

export function cloneDocument(doc: DesignDocument): DesignDocument {
  return structuredClone(doc);
}

export function findNode(doc: DesignDocument, id: string): DesignNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

export function nodeIndex(doc: DesignDocument): Map<string, DesignNode> {
  return new Map(doc.nodes.map((n) => [n.id, n]));
}
