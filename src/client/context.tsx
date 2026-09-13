import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Design, DesignVersion, Template, Page } from "./types";
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
  readImageDropTarget: (
    pageId: string,
    left: number,
    top: number
  ) => { pageId: string; left: number; top: number; width: number; height: number } | null;
  addImageFromClipboard: (event?: ClipboardEvent, replace?: boolean) => Promise<boolean>;
  replaceSelectedImage: (url: string) => Promise<void>;
  setBackground: (type: "color" | "gradient" | "image", value: string) => void;
  lockSelectedAsBackground: () => void;
  updateSelectedObject: (props: Record<string, unknown>) => void;
  copySelectedObjects: () => boolean;
  pasteCopiedCanvasObjects: (raw?: string | null) => Promise<boolean>;
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
  captureCanvasScreenshot: () => string | null;
  exportPNG: (opts?: { toProject?: boolean; name?: string }) => Promise<{ path: string; filename: string; relative: string } | null>;
  copyDesignToClipboard: () => Promise<boolean>;
  getCanvasJSON: () => string;
  getCanvasJSONForPage: (pageId: string) => string;
  applyDesignDocument: (doc: DesignDocument) => Promise<void>;
  applyPatchedDocument: (doc: DesignDocument) => Promise<boolean>;
  patchDesignOnCanvas: (doc: DesignDocument, plan: import("../design/apply-plan").CanvasPatchPlan) => Promise<boolean>;
  loadTemplate: (template: Template) => void;
  scheduleSave: () => void;
  refreshFromDisk: () => Promise<void>;
  acceptHostRevision: (updatedAt?: string, canvasJson?: string) => void;
  layersEpoch: number;
  getLayers: () => LayerItem[];
  selectLayer: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  reorderLayers: (fromDisplayIndex: number, toDisplayIndex: number) => void;
  bringSelectionToFront: () => void;
  sendSelectionToBack: () => void;
  alignSelected: (edge: "left" | "right" | "top" | "bottom") => void;
  matchSelectedSize: (axis: "width" | "height") => void;
  maximizeSelected: () => void;
  resetSelectedImage: () => void;

  // Router
  navigate: (to: string) => void;

  // Designs
  designs: Design[];
  activeDesign: Design | null;
  createDesign: (size?: { width: number; height: number }) => Promise<string | undefined>;
  createFromTemplate: (template: Template) => Promise<string | undefined>;
  loadDesign: (id: string) => Promise<void>;
  saveDesign: (opts?: { snapshot?: boolean }) => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  duplicateDesign: (id: string) => Promise<string | undefined>;
  renameDesign: (id: string, name: string) => Promise<void>;
  saving: boolean;
  diskReloadEpoch: number;
  diskNotice: string | null;
  flashNotice: (message: string) => void;
  versions: DesignVersion[];
  activeVersionRev: number | null;
  saveVersion: (description: string) => Promise<{ version: DesignVersion; created: boolean } | null>;
  restoreVersion: (rev: number) => Promise<void>;
  deleteVersion: (rev: number) => Promise<void>;
  switchVersion: (rev: number | null) => Promise<void>;

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
