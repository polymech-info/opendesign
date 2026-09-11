import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Design, Template, Page } from "./types";
import type { DesignDocument } from "../design/types";
import type * as fabric from "fabric";
import type { LayerItem } from "./hooks/use-canvas";
import type { IconPick } from "./lib/iconify-icons";
import type { ShapeKind } from "./lib/shapes";

export interface CanvasSize {
  label: string;
  width: number;
  height: number;
}

export const CANVAS_SIZES: CanvasSize[] = [
  { label: "LinkedIn Square", width: 1080, height: 1080 },
  { label: "LinkedIn Landscape", width: 1200, height: 627 },
  { label: "LinkedIn Portrait", width: 1200, height: 1500 },
  { label: "Instagram Story", width: 1080, height: 1920 },
  { label: "Screenshot / HD", width: 1920, height: 1080 },
];

export interface EditorContextValue {
  // Canvas (multi-canvas)
  registerCanvas: (pageId: string, canvas: fabric.Canvas) => void;
  unregisterCanvas: (pageId: string) => void;
  setActiveCanvas: (pageId: string) => void;
  activeCanvasId: string | null;
  canvas: fabric.Canvas | null;
  selectedObject: fabric.FabricObject | null;
  selectionEpoch: number;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  setZoomRaw: (z: number) => void;
  fitScale: number;
  setFitScale: (s: number) => void;

  // Canvas actions
  addText: (preset: "heading" | "subheading" | "body") => void;
  addShape: (type: ShapeKind) => void;
  addIcon: (pick: IconPick) => Promise<void>;
  replaceSelectedIcon: (pick: IconPick) => Promise<void>;
  addImage: (url: string, opts?: { fit?: number; left?: number; top?: number }) => void | Promise<void>;
  addDroppedImages: (
    files: File[],
    at?: { pageId?: string; left?: number; top?: number }
  ) => Promise<void>;
  addImageFromClipboard: (event?: ClipboardEvent, replace?: boolean) => Promise<boolean>;
  replaceSelectedImage: (url: string) => Promise<void>;
  setBackground: (type: "color" | "gradient" | "image", value: string) => void;
  lockSelectedAsBackground: () => void;
  updateSelectedObject: (props: Record<string, unknown>) => void;
  duplicateSelected: () => Promise<void>;
  copySelectedStyle: () => void;
  pasteSelectedStyle: () => void;
  hasCopiedStyle: boolean;
  groupSelected: () => void;
  ungroupSelected: () => void;
  saveSelectionAsElement: () => Promise<void>;
  addLibraryElement: (canvasJson: string, name?: string, sourceId?: string) => Promise<void>;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setCanvasSize: (width: number, height: number) => void;
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  exportPNG: () => void;
  getCanvasJSON: () => string;
  getCanvasJSONForPage: (pageId: string) => string;
  applyDesignDocument: (doc: DesignDocument) => Promise<void>;
  loadTemplate: (template: Template) => void;
  scheduleSave: () => void;
  layersEpoch: number;
  getLayers: () => LayerItem[];
  selectLayer: (id: string) => void;
  reorderLayers: (fromDisplayIndex: number, toDisplayIndex: number) => void;

  // Router
  navigate: (to: string) => void;

  // Designs
  designs: Design[];
  activeDesign: Design | null;
  createDesign: (size?: { width: number; height: number }) => Promise<string | undefined>;
  createFromTemplate: (template: Template) => Promise<string | undefined>;
  loadDesign: (id: string) => Promise<void>;
  saveDesign: () => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  saving: boolean;

  // Pages
  pages: Page[];
  activePageId: string | null;
  activePage: Page | null;
  addPage: () => Promise<void>;
  duplicatePage: (pageId: string) => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;
  renamePage: (pageId: string, title: string) => Promise<void>;
  switchToPage: (pageId: string) => void;

  // Templates
  templates: Template[];

  // State
  loading: boolean;
}

export const EditorContext = createContext<EditorContextValue>(null!);

export function useEditor() {
  return useContext(EditorContext);
}
