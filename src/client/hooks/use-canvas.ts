import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import * as fabric from "fabric";
import { loadFabricJSON } from "../lib/fabric-json";
import { canvasToPngDataUrl, canvasToScreenshotDataUrl, copyCanvasPngToClipboard } from "../lib/export-png";
import { imageBlobFromClipboard, saveClipboardImageToUploads } from "../lib/clipboard-image";
import { uploadImageFile, isSvgFile, isSvgUrl } from "../lib/file-drop";
import {
  applyImageCornerRadius,
  applyRectCornerRadius,
  FABRIC_EXTRA_PROPS,
  IMAGE_CORNER_RADIUS_DEFAULT,
  readImageCornerRadius,
} from "../lib/image-radius";
import { ensureStyleRenderer, invalidateGlassBackdrop, noteGlassBackdropSourceChange } from "../lib/style-presets";
import { isIconObject, createIconObjectFromSvg } from "../lib/tabler-icons";
import { createIconFromPick, sameIconPick, type IconPick } from "../lib/iconify-icons";
import {
  applyObjectPatch,
  applyObjectStyle,
  captureObjectStyle,
  selectedCanvasObjects,
  type CopiedObjectStyle,
} from "../lib/object-style";
import {
  abortCanvasTransform,
  configureElementGroup,
  elementDisplayName,
  enlivenLibraryElement,
  groupSelectedObjects,
  innerTargetFromEvent,
  isElementGroup,
  isInsideElementGroup,
  resolveCtrlClickedChild,
  serializeAsElement,
  setElementGroupsCtrlPick,
  ungroupElement,
} from "../lib/element-group";
import { swapCanvasObject } from "../lib/object-frame";
import { ensureObjectIdentity, readObjectId, retargetCloneTree, type IdentifiedObject } from "../lib/object-identity";
import {
  captureCopiedObjects,
  cloneLiveObjects,
  parseCopiedObjects,
  pasteCopiedObjects,
  readRememberedCopiedObjects,
  writeCopiedObjectsToClipboard,
} from "../lib/copy-objects";
import { installSnapGuides } from "../lib/snap-guides";
import { installImageCropGestures } from "../lib/image-crop";
import { cssLinearToFabricGradient } from "../lib/fill-presets";
import { createShapeObject, type ShapeKind } from "../lib/shapes";
import { api } from "../api";
import type { LibraryElement } from "../types";
import {
  isBgImage,
  lockBackgroundImage,
  pageLayer,
  removePagePhoto,
  setPageThemeFill,
  stackPageBackgroundLayers,
} from "../lib/background-image";
import { patchPageBackgroundInIr, syncImageNodeInIr, syncObjectStyleInIr, syncStackOrderInIr } from "../lib/design-ir-sync";
import { restackSelection, type StackDirection } from "../lib/layer-stack";
import { alignSelectionToFirst, type AlignEdge } from "../lib/align-objects";
import {
  attachDesignDocument,
  documentFromCanvasJson,
  projectToFabricJSON,
  validateFabricProjection,
} from "../../design/project";
import { writeCliCanvasJson } from "../../design/patch-fabric-json";
import { hydrateDesignIconFills } from "../lib/design-icons";
import { hydrateDesignImages, hydratePageBackground, normalizeFabricImageSize, patchFabricImageSrc, patchPageBackgroundSrc } from "../lib/design-images";
import { syncDesignNodesToCanvas } from "../lib/design-style-sync";
import type { CanvasPatchPlan } from "../../design/apply-plan";
import { getActiveDocument, setActiveDocument } from "../../design/tools";
import type { DesignDocument } from "../../design/types";

const MAX_HISTORY = 50;
const NUDGE_STEP = 1;
const NUDGE_SHIFT_STEP = 10;

const TEXT_PRESETS = {
  heading: { text: "Add a heading", fontSize: 48, fontWeight: "700", fontFamily: "Montserrat" },
  subheading: { text: "Add a subheading", fontSize: 32, fontWeight: "500", fontFamily: "Inter" },
  body: { text: "Add body text", fontSize: 18, fontWeight: "400", fontFamily: "Inter" },
} as const;

const SHAPE_DEFAULTS = {
  fill: "#6366f1",
  stroke: "",
  strokeWidth: 0,
  opacity: 1,
};

interface CanvasHistory {
  entries: string[];
  index: number;
}

export interface LayerItem {
  id: string;
  name: string;
  kind: string;
}

function layerName(obj: fabric.FabricObject): string {
  if (isElementGroup(obj)) return elementDisplayName(obj);
  const id = readObjectId(obj);
  if (id) return id;
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
    const text = (obj as fabric.Textbox).text?.trim();
    return text ? text.slice(0, 28) : "Text";
  }
  if (isIconObject(obj)) {
    const name = obj._iconName?.replace(/-/g, " ");
    return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : "Icon";
  }
  if (obj instanceof fabric.FabricImage) return "Image";
  if (obj instanceof fabric.Rect) return "Rectangle";
  if (obj instanceof fabric.Circle) return "Circle";
  if (obj instanceof fabric.Triangle) return "Triangle";
  if (obj instanceof fabric.Line) return "Line";
  return obj.type || "Layer";
}

function canvasDeltaToParentSpace(obj: fabric.FabricObject, dx: number, dy: number) {
  const parent = obj.group;
  if (!parent || (dx === 0 && dy === 0)) return { dx, dy };
  const inv = fabric.util.invertTransform(parent.calcTransformMatrix());
  return {
    dx: inv[0] * dx + inv[2] * dy,
    dy: inv[1] * dx + inv[3] * dy,
  };
}

function nudgeFabricObject(obj: fabric.FabricObject, canvasDx: number, canvasDy: number) {
  const { dx, dy } = canvasDeltaToParentSpace(obj, canvasDx, canvasDy);
  const next: { left?: number; top?: number } = {};
  if (!obj.lockMovementX && dx) next.left = (obj.left || 0) + dx;
  if (!obj.lockMovementY && dy) next.top = (obj.top || 0) + dy;
  if (next.left == null && next.top == null) return false;
  obj.set(next);
  obj.setCoords();
  const parent = obj.group;
  if (parent) {
    parent.dirty = true;
    parent.setCoords();
  }
  return true;
}

function contentObjects(canvas: fabric.Canvas): fabric.FabricObject[] {
  return canvas.getObjects().filter((o) => !isBgImage(o));
}

export function useCanvasState() {
  const canvasMapRef = useRef<Map<string, fabric.Canvas>>(new Map());
  const historyMapRef = useRef<Map<string, CanvasHistory>>(new Map());
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const activeCanvasIdRef = useRef<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const styleClipboardRef = useRef<CopiedObjectStyle | null>(null);
  const [hasCopiedStyle, setHasCopiedStyle] = useState(false);
  const pointerPickRef = useRef<{
    ctrl: boolean;
    inner: fabric.FabricObject | null;
    prevActive: fabric.FabricObject | null;
    subTargets: fabric.FabricObject[];
  } | null>(null);
  const ctrlPickOnRef = useRef(false);
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [layersEpoch, setLayersEpoch] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(1080);
  const [canvasHeight, setCanvasHeight] = useState(1080);
  const [zoom, setZoom] = useState(0.58);
  const [fitScale, setFitScale] = useState(0.58);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const isRestoringRef = useRef<Set<string>>(new Set());
  const nudgeDirtyRef = useRef(false);

  // Helper to get the active canvas
  const getActiveCanvas = useCallback((): fabric.Canvas | null => {
    const id = activeCanvasIdRef.current;
    if (!id) return null;
    return canvasMapRef.current.get(id) ?? null;
  }, []);

  const setAllCanvasesCtrlPick = useCallback((on: boolean) => {
    if (ctrlPickOnRef.current === on) return;
    ctrlPickOnRef.current = on;
    for (const canvas of canvasMapRef.current.values()) {
      setElementGroupsCtrlPick(canvas, on);
      if (on) {
        const hovered = (canvas as fabric.Canvas & { _hoveredTarget?: fabric.FabricObject })._hoveredTarget;
        if (isElementGroup(hovered) || isInsideElementGroup(hovered)) {
          canvas.setCursor("pointer");
        }
      }
    }
  }, []);

  // Update undo/redo state for active canvas
  const updateUndoRedoState = useCallback((pageId: string) => {
    if (pageId !== activeCanvasIdRef.current) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    setCanUndo(hist.index > 0);
    setCanRedo(hist.index < hist.entries.length - 1);
  }, []);

  const canvasHistoryJSON = useCallback((canvas: fabric.Canvas) => {
    const raw = JSON.stringify(canvas.toJSON([...FABRIC_EXTRA_PROPS]));
    const doc = getActiveDocument();
    return doc ? attachDesignDocument(raw, doc) : raw;
  }, []);

  const saveHistory = useCallback((pageId: string) => {
    if (isRestoringRef.current.has(pageId)) return;
    const canvas = canvasMapRef.current.get(pageId);
    if (!canvas) return;
    const json = canvasHistoryJSON(canvas);
    let hist = historyMapRef.current.get(pageId);
    if (!hist) {
      hist = { entries: [], index: -1 };
      historyMapRef.current.set(pageId, hist);
    }
    // Truncate forward history
    hist.entries = hist.entries.slice(0, hist.index + 1);
    hist.entries.push(json);
    if (hist.entries.length > MAX_HISTORY) {
      hist.entries.shift();
    } else {
      hist.index = hist.entries.length - 1;
    }
    updateUndoRedoState(pageId);
  }, [canvasHistoryJSON, updateUndoRedoState]);

  const registerCanvas = useCallback((pageId: string, canvas: fabric.Canvas) => {
    canvasMapRef.current.set(pageId, canvas);

    const enableCtrlPickBeforeFindTarget = (e: PointerEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (ctrlPickOnRef.current) return;
      ctrlPickOnRef.current = true;
      setElementGroupsCtrlPick(canvas, true);
    };
    canvas.upperCanvasEl.addEventListener("pointerdown", enableCtrlPickBeforeFindTarget, true);

    // Ctrl/Cmd+click a child inside a group without starting a group drag.
    canvas.on("mouse:down:before", (opt) => {
      const evt = opt.e as MouseEvent | undefined;
      const ctrl = !!(evt && (evt.ctrlKey || evt.metaKey));
      const subTargets = [...((opt.subTargets ?? []) as fabric.FabricObject[])];
      const prevActive = canvas.getActiveObject() ?? null;
      const onControl = !!(
        prevActive &&
        evt &&
        prevActive.findControl(canvas.getViewportPoint(evt as never))
      );
      const inner =
        ctrl && evt && !onControl
          ? resolveCtrlClickedChild(canvas, opt.target, subTargets, evt)
          : null;
      pointerPickRef.current = { ctrl, inner, prevActive, subTargets };
    });
    canvas.on("mouse:down", () => {
      const pick = pointerPickRef.current;
      if (!pick?.inner) return;
      if (pick.prevActive !== pick.inner) {
        abortCanvasTransform(canvas);
        if (canvas.getActiveObject() !== pick.inner) {
          canvas.setActiveObject(pick.inner);
        }
        canvas.setCursor("pointer");
        canvas.requestRenderAll();
      }
    });
    canvas.on("mouse:move", (opt) => {
      const evt = opt.e as MouseEvent | undefined;
      if (!evt || !(evt.ctrlKey || evt.metaKey)) return;
      if (isElementGroup(opt.target) || isInsideElementGroup(opt.target)) {
        canvas.setCursor("pointer");
      }
    });
    const syncSelection = () => {
      if (activeCanvasIdRef.current !== pageId) return;
      const active = canvas.getActiveObject();
      const pick = pointerPickRef.current;
      if (pick?.inner) {
        setSelectedObject(pick.inner);
      } else if (pick?.ctrl && isElementGroup(active)) {
        const inner = innerTargetFromEvent(active, pick.subTargets);
        setSelectedObject(inner ?? active);
      } else if (active instanceof fabric.ActiveSelection) {
        setSelectedObject(canvas.getActiveObjects()[0] ?? active);
      } else {
        setSelectedObject(active ?? null);
      }
      setSelectionEpoch((n) => n + 1);
    };
    canvas.on("selection:created", syncSelection);
    canvas.on("selection:updated", syncSelection);
    canvas.on("selection:cleared", () => {
      if (activeCanvasIdRef.current === pageId) {
        pointerPickRef.current = null;
        setSelectedObject(null);
        setSelectionEpoch((n) => n + 1);
      }
    });
    installSnapGuides(canvas);
    installImageCropGestures(canvas, () => saveHistory(pageId));

    // History + layer events
    canvas.on("object:added", (e) => {
      const target = e.target;
      if (target) ensureObjectIdentity(target, canvas);
      if (target) ensureStyleRenderer(target);
      noteGlassBackdropSourceChange(target);
      saveHistory(pageId);
      if (!isRestoringRef.current.has(pageId)) setLayersEpoch((n) => n + 1);
    });
    canvas.on("object:scaling", (e) => {
      const target = e.target;
      if (target instanceof fabric.FabricImage) {
        const radius = (target as { _cornerRadius?: number })._cornerRadius;
        if (typeof radius === "number") applyImageCornerRadius(target, radius);
      } else if (target instanceof fabric.Rect) {
        const radius = (target as { _cornerRadius?: number })._cornerRadius;
        if (typeof radius === "number") applyRectCornerRadius(target, radius);
        else applyRectCornerRadius(target, (target.rx || 0) * Math.abs(target.scaleX || 1));
      }
      noteGlassBackdropSourceChange(target);
    });
    canvas.on("object:modified", (e) => {
      const target = e.target;
      if (target instanceof fabric.FabricImage) {
        const radius = (target as { _cornerRadius?: number })._cornerRadius;
        if (typeof radius === "number") applyImageCornerRadius(target, radius);
      } else if (target instanceof fabric.Rect) {
        const radius = (target as { _cornerRadius?: number })._cornerRadius;
        if (typeof radius === "number") applyRectCornerRadius(target, radius);
      }
      noteGlassBackdropSourceChange(target);
      saveHistory(pageId);
    });
    canvas.on("object:removed", (e) => {
      noteGlassBackdropSourceChange(e.target);
      saveHistory(pageId);
      if (!isRestoringRef.current.has(pageId)) setLayersEpoch((n) => n + 1);
    });

    if (ctrlPickOnRef.current) setElementGroupsCtrlPick(canvas, true);

    // Initial history snapshot
    setTimeout(() => {
      const json = canvasHistoryJSON(canvas);
      historyMapRef.current.set(pageId, { entries: [json], index: 0 });
      updateUndoRedoState(pageId);
    }, 100);
  }, [canvasHistoryJSON, saveHistory, updateUndoRedoState]);

  const unregisterCanvas = useCallback((pageId: string) => {
    canvasMapRef.current.delete(pageId);
    historyMapRef.current.delete(pageId);
  }, []);

  const setActiveCanvas = useCallback((pageId: string) => {
    const prevId = activeCanvasIdRef.current;
    if (prevId === pageId) return;

    // Clear selection on previous canvas
    if (prevId) {
      const prevCanvas = canvasMapRef.current.get(prevId);
      if (prevCanvas) {
        prevCanvas.discardActiveObject();
        prevCanvas.requestRenderAll();
      }
    }

    activeCanvasIdRef.current = pageId;
    setActiveCanvasId(pageId);
    setSelectedObject(null);
    updateUndoRedoState(pageId);
  }, [updateUndoRedoState]);

  // ── Text ────────────────────────────────────────────────────────────

  const addText = useCallback(
    (preset: "heading" | "subheading" | "body") => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const cfg = TEXT_PRESETS[preset];
      const text = new fabric.Textbox(cfg.text, {
        left: canvasWidth / 2 - 200,
        top: canvasHeight / 2 - 30,
        width: 400,
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        fontFamily: cfg.fontFamily,
        fill: "#ffffff",
        textAlign: "center",
        editable: true,
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.requestRenderAll();
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  // ── Shapes ──────────────────────────────────────────────────────────

  const addShape = useCallback(
    (type: ShapeKind) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const obj = createShapeObject(type, canvasWidth, canvasHeight);
      if (!obj) return;
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  const placeIconObject = useCallback(
    (obj: fabric.FabricObject, left: number, top: number, target = 120) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const w = Math.max(1, obj.width || 24);
      const h = Math.max(1, obj.height || 24);
      const scale = target / Math.max(w, h);
      obj.set({
        originX: "center",
        originY: "center",
        left,
        top,
        scaleX: scale,
        scaleY: scale,
        uniformScaling: true,
        lockScalingFlip: true,
      });
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
    },
    [getActiveCanvas]
  );

  const addIcon = useCallback(
    async (pick: IconPick, at?: { left?: number; top?: number }) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const obj = await createIconFromPick(pick, SHAPE_DEFAULTS.fill);
      if (!obj) return;
      placeIconObject(obj, at?.left ?? canvasWidth / 2, at?.top ?? canvasHeight / 2);
    },
    [getActiveCanvas, canvasWidth, canvasHeight, placeIconObject]
  );

  const replaceSelectedIcon = useCallback(
    async (pick: IconPick) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId || !isIconObject(selectedObject)) return;
      if (sameIconPick(pick, selectedObject._iconName)) return;
      const style = captureObjectStyle(selectedObject);
      const next = await createIconFromPick(pick, style.fill || SHAPE_DEFAULTS.fill);
      if (!next) return;
      applyObjectStyle(next, style);
      swapCanvasObject(canvas, selectedObject, next);
      next.set({ uniformScaling: true, lockScalingFlip: true });
      ensureStyleRenderer(next);
      canvas.setActiveObject(next);
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(next);
      setSelectionEpoch((n) => n + 1);
    },
    [getActiveCanvas, selectedObject, saveHistory]
  );

  // ── Images ──────────────────────────────────────────────────────────

  const addImage = useCallback(
    async (url: string, opts?: { fit?: number; left?: number; top?: number }) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const left = opts?.left ?? canvasWidth / 2;
      const top = opts?.top ?? canvasHeight / 2;
      if (isSvgUrl(url)) {
        try {
          const svg = await (await fetch(url)).text();
          const name = decodeURIComponent(url.split("/").pop() || "icon").replace(/\.svg$/i, "");
          const obj = await createIconObjectFromSvg(svg, name, SHAPE_DEFAULTS.fill, url);
          if (obj) placeIconObject(obj, left, top);
        } catch (e) {
          console.error("Failed to load SVG icon:", e);
        }
        return;
      }
      try {
        const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
        const { width: nw, height: nh } = await normalizeFabricImageSize(img);
        const maxFit = opts?.fit ?? 0.6;
        const scale = Math.min((canvasWidth * maxFit) / nw, (canvasHeight * maxFit) / nh, 1);
        const displayW = nw * scale;
        const displayH = nh * scale;
        img.set({
          originX: "left",
          originY: "top",
          left: left - displayW / 2,
          top: top - displayH / 2,
          scaleX: scale,
          scaleY: scale,
          uniformScaling: true,
          lockScalingFlip: true,
        });
        applyImageCornerRadius(img, IMAGE_CORNER_RADIUS_DEFAULT);
        img.setCoords();
        canvas.add(img);
        ensureObjectIdentity(img, canvas);
        syncImageNodeInIr(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        const pageId = activeCanvasIdRef.current;
        if (pageId) saveHistory(pageId);
      } catch (e) {
        console.error("Failed to load image:", e);
      }
    },
    [getActiveCanvas, canvasWidth, canvasHeight, placeIconObject, saveHistory]
  );

  const addDroppedImages = useCallback(
    async (files: File[], at?: { pageId?: string; left?: number; top?: number }) => {
      if (at?.pageId) setActiveCanvas(at.pageId);
      let i = 0;
      for (const file of files) {
        const left = at?.left != null ? at.left + i * 28 : undefined;
        const top = at?.top != null ? at.top + i * 28 : undefined;
        if (isSvgFile(file)) {
          const svg = await file.text();
          const url = await uploadImageFile(file, "images");
          const obj = await createIconObjectFromSvg(
            svg,
            file.name.replace(/\.svg$/i, ""),
            SHAPE_DEFAULTS.fill,
            url || undefined
          );
          if (obj) {
            placeIconObject(obj, left ?? canvasWidth / 2, top ?? canvasHeight / 2);
            i += 1;
          }
          continue;
        }
        const url = await uploadImageFile(file, "images");
        if (!url) continue;
        await addImage(url, { fit: 0.6, left, top });
        i += 1;
      }
    },
    [addImage, setActiveCanvas, placeIconObject, canvasWidth, canvasHeight]
  );

  const replaceSelectedImage = useCallback(
    async (url: string) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      if (!(selectedObject instanceof fabric.FabricImage) || isBgImage(selectedObject)) return;
      try {
        const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
        await normalizeFabricImageSize(img);
        const style = captureObjectStyle(selectedObject);
        const radius = readImageCornerRadius(selectedObject);
        applyObjectStyle(img, style);
        const id = readObjectId(selectedObject);
        swapCanvasObject(canvas, selectedObject, img);
        if (id) (img as { _id?: string })._id = id;
        applyImageCornerRadius(img, radius);
        ensureStyleRenderer(img);
        syncImageNodeInIr(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        saveHistory(pageId);
        setSelectedObject(img);
        setSelectionEpoch((n) => n + 1);
      } catch (e) {
        console.error("Failed to replace image:", e);
      }
    },
    [getActiveCanvas, selectedObject, saveHistory]
  );

  const addImageFromClipboard = useCallback(
    async (event?: ClipboardEvent, replace = false) => {
      const blob = await imageBlobFromClipboard(event);
      if (!blob) return false;
      const url = await saveClipboardImageToUploads(blob);
      if (!url) return false;
      if (replace) await replaceSelectedImage(url);
      else await addImage(url, { fit: 0.92 });
      return true;
    },
    [addImage, replaceSelectedImage]
  );

  // ── Background ──────────────────────────────────────────────────────

  const setBackground = useCallback(
    (type: "color" | "gradient" | "image", value: string) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;

      const finish = () => {
        invalidateGlassBackdrop(canvas);
        canvas.requestRenderAll();
        saveHistory(pageId);
        if (selectedObject && isBgImage(selectedObject)) {
          canvas.discardActiveObject();
          setSelectedObject(null);
          setSelectionEpoch((n) => n + 1);
        }
      };

      if (type === "color") {
        removePagePhoto(canvas);
        patchPageBackgroundInIr({ clear: true });
        setPageThemeFill(canvas, value);
        canvas.backgroundColor = value;
        finish();
        return;
      }

      if (type === "gradient") {
        removePagePhoto(canvas);
        patchPageBackgroundInIr({ clear: true });
        setPageThemeFill(canvas, "transparent");
        canvas.backgroundColor = cssLinearToFabricGradient(value, canvasWidth, canvasHeight);
        finish();
        return;
      }

      fabric.FabricImage.fromURL(value, { crossOrigin: "anonymous" }).then((img) => {
        const scaleX = canvasWidth / (img.width || 1);
        const scaleY = canvasHeight / (img.height || 1);
        img.set({
          left: 0,
          top: 0,
          originX: "left",
          originY: "top",
          scaleX,
          scaleY,
          _id: "canvas.photo",
        });
        removePagePhoto(canvas);
        patchPageBackgroundInIr({ src: value });
        lockBackgroundImage(img);
        canvas.add(img);
        stackPageBackgroundLayers(canvas);
        canvas.discardActiveObject();
        finish();
        setSelectedObject(null);
        setSelectionEpoch((n) => n + 1);
      });
    },
    [getActiveCanvas, canvasWidth, canvasHeight, saveHistory, selectedObject]
  );

  const lockSelectedAsBackground = useCallback(() => {
    const canvas = getActiveCanvas();
    const pageId = activeCanvasIdRef.current;
    const obj = selectedObject;
    if (!canvas || !pageId || !(obj instanceof fabric.FabricImage) || isBgImage(obj)) return;
    removePagePhoto(canvas);
    obj.set({
      originX: "left",
      originY: "top",
      left: 0,
      top: 0,
      scaleX: canvasWidth / (obj.width || 1),
      scaleY: canvasHeight / (obj.height || 1),
      angle: 0,
      flipX: false,
      flipY: false,
      _id: "canvas.photo",
    });
    const src =
      (typeof obj.getSrc === "function" ? obj.getSrc() : "") ||
      ((obj.getElement() as { src?: string } | null)?.src ?? "");
    if (src) patchPageBackgroundInIr({ src });
    lockBackgroundImage(obj);
    stackPageBackgroundLayers(canvas);
    canvas.discardActiveObject();
    invalidateGlassBackdrop(canvas);
    canvas.requestRenderAll();
    saveHistory(pageId);
    setSelectedObject(null);
    setSelectionEpoch((n) => n + 1);
  }, [getActiveCanvas, selectedObject, canvasWidth, canvasHeight, saveHistory]);

  // ── Object manipulation ─────────────────────────────────────────────

  const updateSelectedObject = useCallback(
    (props: Record<string, unknown>) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      const targets = isInsideElementGroup(selectedObject)
        ? selectedObject
          ? [selectedObject]
          : []
        : selectedCanvasObjects(canvas, selectedObject);
      if (!canvas || !pageId || targets.length === 0) return;
      for (const obj of targets) {
        applyObjectPatch(obj, props);
        syncObjectStyleInIr(obj);
      }
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(targets[0]);
      setSelectionEpoch((n) => n + 1);
      if ("_elementName" in props || "_id" in props) setLayersEpoch((n) => n + 1);
    },
    [getActiveCanvas, selectedObject, saveHistory]
  );

  const nudgeSelected = useCallback(
    (canvasDx: number, canvasDy: number) => {
      const canvas = getActiveCanvas();
      if (!canvas || (canvasDx === 0 && canvasDy === 0)) return;
      const active = canvas.getActiveObject();
      if (!active || isBgImage(active)) return;
      const moved = nudgeFabricObject(active, canvasDx, canvasDy);
      if (!moved) return;
      noteGlassBackdropSourceChange(active);
      canvas.requestRenderAll();
      nudgeDirtyRef.current = true;
    },
    [getActiveCanvas]
  );

  const commitNudgeHistory = useCallback(() => {
    if (!nudgeDirtyRef.current) return;
    nudgeDirtyRef.current = false;
    const pageId = activeCanvasIdRef.current;
    if (pageId) saveHistory(pageId);
  }, [saveHistory]);

  const duplicateSelected = useCallback(async () => {
    const canvas = getActiveCanvas();
    const pageId = activeCanvasIdRef.current;
    const targets = selectedCanvasObjects(canvas, selectedObject);
    if (!canvas || !pageId || targets.length === 0) return;
    const clones = await cloneLiveObjects(canvas, targets);
    if (clones.length === 0) return;
    if (clones.length === 1) {
      canvas.setActiveObject(clones[0]);
      setSelectedObject(clones[0]);
    } else {
      const sel = new fabric.ActiveSelection(clones, { canvas });
      canvas.setActiveObject(sel);
      setSelectedObject(clones[0]);
    }
    setSelectionEpoch((n) => n + 1);
    setLayersEpoch((n) => n + 1);
  }, [getActiveCanvas, selectedObject]);

  const copySelectedObjects = useCallback(() => {
    const canvas = getActiveCanvas();
    const targets = selectedCanvasObjects(canvas, selectedObject);
    if (!canvas || targets.length === 0) return false;
    const payload = captureCopiedObjects(canvas, targets);
    if (!payload) return false;
    void writeCopiedObjectsToClipboard(payload);
    return true;
  }, [getActiveCanvas, selectedObject]);

  const pasteCopiedCanvasObjects = useCallback(async (raw?: string | null) => {
    const canvas = getActiveCanvas();
    if (!canvas) return false;
    const payload = parseCopiedObjects(raw) ?? readRememberedCopiedObjects();
    if (!payload) return false;
    const clones = await pasteCopiedObjects(canvas, payload);
    if (clones.length === 0) return false;
    if (clones.length === 1) {
      canvas.setActiveObject(clones[0]);
      setSelectedObject(clones[0]);
    } else {
      const sel = new fabric.ActiveSelection(clones, { canvas });
      canvas.setActiveObject(sel);
      setSelectedObject(clones[0]);
    }
    setSelectionEpoch((n) => n + 1);
    setLayersEpoch((n) => n + 1);
    return true;
  }, [getActiveCanvas]);

  const copySelectedStyle = useCallback(() => {
    const canvas = getActiveCanvas();
    const source = isInsideElementGroup(selectedObject)
      ? selectedObject
      : selectedCanvasObjects(canvas, selectedObject)[0];
    if (!source) return;
    styleClipboardRef.current = captureObjectStyle(source);
    setHasCopiedStyle(true);
  }, [getActiveCanvas, selectedObject]);

  const pasteSelectedStyle = useCallback(() => {
    const style = styleClipboardRef.current;
    const canvas = getActiveCanvas();
    const pageId = activeCanvasIdRef.current;
    const targets = isInsideElementGroup(selectedObject)
      ? selectedObject
        ? [selectedObject]
        : []
      : selectedCanvasObjects(canvas, selectedObject);
    if (!style || !canvas || !pageId || targets.length === 0) return;
    for (const obj of targets) {
      applyObjectStyle(obj, style);
      syncObjectStyleInIr(obj);
      obj.setCoords();
    }
    canvas.requestRenderAll();
    saveHistory(pageId);
    setSelectedObject(targets[0]);
    setSelectionEpoch((n) => n + 1);
  }, [getActiveCanvas, selectedObject, saveHistory]);

  const groupSelected = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const group = groupSelectedObjects(canvas);
    if (!group) return;
    setSelectedObject(group);
    setSelectionEpoch((n) => n + 1);
  }, [getActiveCanvas]);

  const ungroupSelected = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!isElementGroup(active)) return;
    const items = ungroupElement(canvas, active);
    setSelectedObject(items[0] ?? null);
    setSelectionEpoch((n) => n + 1);
  }, [getActiveCanvas]);

  const saveSelectionAsElement = useCallback(async () => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    let obj = canvas.getActiveObject();
    if (!obj) return;
    if (obj instanceof fabric.ActiveSelection || selectedCanvasObjects(canvas).length >= 2) {
      obj = groupSelectedObjects(canvas) ?? obj;
    }
    if (!obj || obj instanceof fabric.ActiveSelection) return;
    if (isElementGroup(obj)) configureElementGroup(obj);
    const payload = serializeAsElement(obj);
    const name = elementDisplayName(obj, "Element");
    try {
      const row = await api<LibraryElement>("POST", "/api/elements", {
        name,
        canvas_json: JSON.stringify({ objects: [payload.object] }),
        width: payload.width,
        height: payload.height,
      });
      if (row?.id) (obj as IdentifiedObject)._elementSource = String(row.id);
      window.dispatchEvent(new Event("opend-elements-changed"));
      setSelectedObject(obj);
      setSelectionEpoch((n) => n + 1);
    } catch (e) {
      console.error("Failed to save element:", e);
    }
  }, [getActiveCanvas]);

  const addLibraryElement = useCallback(
    async (canvasJson: string, name?: string, sourceId?: string) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const obj = await enlivenLibraryElement(canvasJson);
      if (!obj) return;
      obj.set({
        originX: "center",
        originY: "center",
        left: canvasWidth / 2,
        top: canvasHeight / 2,
      });
      if (sourceId) (obj as IdentifiedObject)._elementSource = sourceId;
      if (isElementGroup(obj)) {
        configureElementGroup(obj, obj._elementName || name);
      } else if (name) {
        (obj as { _elementName?: string })._elementName = name;
      }
      retargetCloneTree(obj, canvas);
      const restoreDeep = (node: fabric.FabricObject) => {
        ensureStyleRenderer(node);
        if (node instanceof fabric.Group) node.getObjects().forEach(restoreDeep);
      };
      restoreDeep(obj);
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      setSelectedObject(obj);
      setSelectionEpoch((n) => n + 1);
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  const deleteSelected = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    if (selectedObject && isInsideElementGroup(selectedObject)) {
      const group = selectedObject.group as fabric.Group;
      group.remove(selectedObject);
      if (group.size() < 2) {
        ungroupElement(canvas, group);
      } else {
        group.dirty = true;
        canvas.setActiveObject(group);
        canvas.requestRenderAll();
      }
      setSelectedObject(canvas.getActiveObject() ?? null);
      setSelectionEpoch((n) => n + 1);
      return;
    }
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [getActiveCanvas, selectedObject]);

  // ── Undo / Redo ─────────────────────────────────────────────────────

  const restoreFromHistory = useCallback(
    (index: number) => {
      const pageId = activeCanvasIdRef.current;
      const canvas = getActiveCanvas();
      if (!canvas || !pageId) return;
      const hist = historyMapRef.current.get(pageId);
      if (!hist || index < 0 || index >= hist.entries.length) return;
      isRestoringRef.current.add(pageId);
      hist.index = index;
      const json = hist.entries[index];
      void loadFabricJSON(canvas, json).then(() => {
        canvas.requestRenderAll();
        isRestoringRef.current.delete(pageId);
        setActiveDocument(documentFromCanvasJson(json));
        updateUndoRedoState(pageId);
        setLayersEpoch((n) => n + 1);
      });
    },
    [getActiveCanvas, updateUndoRedoState]
  );

  const undo = useCallback(() => {
    const pageId = activeCanvasIdRef.current;
    if (!pageId) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) return;
    restoreFromHistory(hist.index - 1);
  }, [restoreFromHistory]);

  const redo = useCallback(() => {
    const pageId = activeCanvasIdRef.current;
    if (!pageId) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) return;
    restoreFromHistory(hist.index + 1);
  }, [restoreFromHistory]);

  // ── Canvas size ─────────────────────────────────────────────────────

  const setCanvasSize = useCallback(
    (width: number, height: number) => {
      setCanvasWidth(width);
      setCanvasHeight(height);
      // Resize all canvases
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of canvasMapRef.current.values()) {
        canvas.setDimensions({ width: width * dpr, height: height * dpr }, { cssOnly: false });
        canvas.setDimensions({ width, height }, { cssOnly: true });
        canvas.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);
        invalidateGlassBackdrop(canvas);
        canvas.requestRenderAll();
      }
    },
    []
  );

  // ── Zoom ────────────────────────────────────────────────────────────

  const zoomToFit = useCallback(() => {
    setZoom(fitScale);
  }, [fitScale]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.2, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.2, 0.05));
  }, []);

  // ── Export ──────────────────────────────────────────────────────────

  const captureCanvasScreenshot = useCallback((): string | null => {
    const canvas = getActiveCanvas();
    if (!canvas) return null;
    const activeObj = canvas.getActiveObject();
    canvas.discardActiveObject();
    const dataURL = canvasToScreenshotDataUrl(canvas);
    if (activeObj) {
      canvas.setActiveObject(activeObj);
      canvas.requestRenderAll();
    }
    return dataURL;
  }, [getActiveCanvas]);

  const exportPNG = useCallback(
    async (opts?: { toProject?: boolean; name?: string }) => {
      const canvas = getActiveCanvas();
      if (!canvas) return null;
      const activeObj = canvas.getActiveObject();
      canvas.discardActiveObject();
      const dataURL = canvasToPngDataUrl(canvas, 2);
      if (activeObj) {
        canvas.setActiveObject(activeObj);
        canvas.requestRenderAll();
      }
      if (opts?.toProject) {
        return api<{ path: string; filename: string; relative: string }>("POST", "/api/export/png", {
          name: opts.name || "design",
          image: dataURL,
        });
      }
      const slug = (opts?.name || "design")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "design";
      const link = document.createElement("a");
      link.download = `${slug}.png`;
      link.href = dataURL;
      link.click();
      return null;
    },
    [getActiveCanvas]
  );

  const copyDesignToClipboard = useCallback(async (): Promise<boolean> => {
    const canvas = getActiveCanvas();
    if (!canvas) return false;
    const activeObj = canvas.getActiveObject();
    canvas.discardActiveObject();
    try {
      await copyCanvasPngToClipboard(canvas);
      return true;
    } catch {
      return false;
    } finally {
      if (activeObj) {
        canvas.setActiveObject(activeObj);
        canvas.requestRenderAll();
      }
    }
  }, [getActiveCanvas]);

  // ── Serialization ───────────────────────────────────────────────────

  const getCanvasJSON = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return "{}";
    return canvasHistoryJSON(canvas);
  }, [getActiveCanvas, canvasHistoryJSON]);

  const getCanvasJSONForPage = useCallback(
    (pageId: string) => {
      const canvas = canvasMapRef.current.get(pageId);
      if (!canvas) return "{}";
      return canvasHistoryJSON(canvas);
    },
    [canvasHistoryJSON],
  );

  const patchDesignOnCanvas = useCallback(
    async (doc: DesignDocument, plan: CanvasPatchPlan): Promise<boolean> => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId || plan.mode !== "patch") return false;
      setActiveDocument(doc);
      let changed = false;
      for (const row of plan.images ?? []) {
        const next = await patchFabricImageSrc(canvas, row.id, row.url);
        if (next) changed = true;
      }
      if (plan.pageBackground !== undefined) {
        if (plan.pageBackground === null) {
          removePagePhoto(canvas);
          changed = true;
        } else {
          const ok = await patchPageBackgroundSrc(canvas, plan.pageBackground, canvasWidth, canvasHeight);
          if (!ok) return false;
          changed = true;
        }
      }
      if (plan.styleNodeIds?.length) {
        const ok = await syncDesignNodesToCanvas(canvas, doc, plan.styleNodeIds);
        if (!ok) return false;
        changed = true;
      }
      if (changed) {
        invalidateGlassBackdrop(canvas);
        canvas.requestRenderAll();
        saveHistory(pageId);
      }
      return true;
    },
    [getActiveCanvas, saveHistory, canvasWidth, canvasHeight],
  );

  const applyDesignDocument = useCallback(
    async (doc: DesignDocument) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) {
        console.warn("[design] applyDesignDocument skipped — no active canvas", { pageId });
        return;
      }
      setActiveDocument(doc);
      const fabricJson = projectToFabricJSON(doc);
      const projection = validateFabricProjection(doc, fabricJson);
      if (!projection.ok) {
        console.warn("[design] applyDesignDocument projection mismatch", projection);
      } else if (projection.offCanvas.length) {
        console.info("[design] applyDesignDocument — instances off canvas", projection);
      } else {
        console.log("[design] applyDesignDocument", {
          instances: projection.instances.length,
          objects: JSON.parse(fabricJson).objects?.length,
        });
      }
      isRestoringRef.current.add(pageId);
      try {
        await loadFabricJSON(canvas, fabricJson);
        await hydratePageBackground(canvas, canvasWidth, canvasHeight);
        canvas.getObjects().forEach((o) => {
          if (o.shadow) {
            o.objectCaching = false;
            o.dirty = true;
          }
        });
        await hydrateDesignIconFills(canvas, doc);
        await hydrateDesignImages(canvas, doc);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setSelectedObject(null);
        setSelectionEpoch((n) => n + 1);
        setLayersEpoch((n) => n + 1);
      } finally {
        isRestoringRef.current.delete(pageId);
      }
      saveHistory(pageId);
    },
    [getActiveCanvas, saveHistory, canvasWidth, canvasHeight],
  );

  /** Keep editor groups: patch the live Fabric JSON from IR (create / delete / use_widget). */
  const applyPatchedDocument = useCallback(
    async (doc: DesignDocument): Promise<boolean> => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) {
        console.warn("[design] applyPatchedDocument skipped — no active canvas", { pageId });
        return false;
      }
      setActiveDocument(doc);
      const fabricJson = writeCliCanvasJson(canvasHistoryJSON(canvas), doc, { source: "agent" });
      isRestoringRef.current.add(pageId);
      try {
        await loadFabricJSON(canvas, fabricJson);
        await hydratePageBackground(canvas, canvasWidth, canvasHeight);
        canvas.getObjects().forEach((o) => {
          if (o.shadow) {
            o.objectCaching = false;
            o.dirty = true;
          }
        });
        await hydrateDesignIconFills(canvas, doc);
        await hydrateDesignImages(canvas, doc);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setSelectedObject(null);
        setSelectionEpoch((n) => n + 1);
        setLayersEpoch((n) => n + 1);
      } finally {
        isRestoringRef.current.delete(pageId);
      }
      saveHistory(pageId);
      return true;
    },
    [getActiveCanvas, canvasHistoryJSON, saveHistory, canvasWidth, canvasHeight],
  );

  const loadTemplate = useCallback(
    (template: Template) => {
      setCanvasWidth(template.width);
      setCanvasHeight(template.height);
      // Template loading — resize all canvases to new dimensions
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of canvasMapRef.current.values()) {
        canvas.setDimensions(
          { width: template.width * dpr, height: template.height * dpr },
          { cssOnly: false }
        );
        canvas.setDimensions({ width: template.width, height: template.height }, { cssOnly: true });
        canvas.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);
      }
      // Load template JSON onto active canvas
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (canvas && pageId) {
        isRestoringRef.current.add(pageId);
        void loadFabricJSON(canvas, template.canvas_json).then(() => {
          canvas.getObjects().forEach((o) => {
            if (o.shadow) {
              o.objectCaching = false;
              o.dirty = true;
            }
            if (!(o as { _layerId?: string })._layerId) {
              (o as { _layerId?: string })._layerId = crypto.randomUUID();
            }
          });
          canvas.requestRenderAll();
          isRestoringRef.current.delete(pageId);
          setActiveDocument(documentFromCanvasJson(template.canvas_json));
          historyMapRef.current.set(pageId, {
            entries: [canvasHistoryJSON(canvas)],
            index: 0,
          });
          updateUndoRedoState(pageId);
          setLayersEpoch((n) => n + 1);
        });
      }
    },
    [getActiveCanvas, canvasHistoryJSON, updateUndoRedoState]
  );

  const restackSelected = useCallback(
    (direction: StackDirection) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      const next = restackSelection(canvas, selectedObject, direction);
      if (!next) return;
      syncStackOrderInIr(canvas.getObjects().filter((obj) => !isBgImage(obj)));
      saveHistory(pageId);
      setLayersEpoch((n) => n + 1);
      setSelectionEpoch((n) => n + 1);
    },
    [getActiveCanvas, selectedObject, saveHistory]
  );

  const bringSelectionToFront = useCallback(() => restackSelected("front"), [restackSelected]);
  const sendSelectionToBack = useCallback(() => restackSelected("back"), [restackSelected]);

  const alignSelected = useCallback(
    (edge: AlignEdge) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      const moved = alignSelectionToFirst(canvas, selectedObject, edge);
      if (!moved) return;
      const active = canvas.getActiveObject();
      if (active) noteGlassBackdropSourceChange(active);
      saveHistory(pageId);
      setSelectionEpoch((n) => n + 1);
    },
    [getActiveCanvas, selectedObject, saveHistory]
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta) setAllCanvasesCtrlPick(true);
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !isTextEditing()) {
        e.preventDefault();
        deleteSelected();
      } else if (meta && e.key.toLowerCase() === "g" && !isTextEditing()) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
      } else if (meta && e.key.toLowerCase() === "c" && !e.shiftKey && !isTextEditing()) {
        if (copySelectedObjects()) e.preventDefault();
      } else if (meta && e.key.toLowerCase() === "d" && !isTextEditing()) {
        e.preventDefault();
        void duplicateSelected();
      } else if (meta && (e.key === "]" || e.key === "[") && !isTextEditing()) {
        e.preventDefault();
        if (e.key === "]") bringSelectionToFront();
        else sendSelectionToBack();
      } else if (
        !meta &&
        (e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown") &&
        !isTextEditing()
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_SHIFT_STEP : NUDGE_STEP;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudgeSelected(dx, dy);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) setAllCanvasesCtrlPick(false);
      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        commitNudgeHistory();
      }
    };
    const onBlur = () => {
      setAllCanvasesCtrlPick(false);
      commitNudgeHistory();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTextEditing()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const objectPayload = parseCopiedObjects(text) ?? (text ? null : readRememberedCopiedObjects());
      const hasImage = Array.from(e.clipboardData?.items ?? []).some((item) =>
        item.type.startsWith("image/")
      );
      if (objectPayload && !hasImage) {
        e.preventDefault();
        void pasteCopiedCanvasObjects(text);
        return;
      }
      if (hasImage) {
        e.preventDefault();
        void addImageFromClipboard(e);
        return;
      }
      if (readRememberedCopiedObjects()) {
        e.preventDefault();
        void pasteCopiedCanvasObjects();
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("paste", onPaste);
    };
  }, [undo, redo, deleteSelected, addImageFromClipboard, groupSelected, ungroupSelected, setAllCanvasesCtrlPick, nudgeSelected, commitNudgeHistory, copySelectedObjects, pasteCopiedCanvasObjects, duplicateSelected, bringSelectionToFront, sendSelectionToBack]);

  function isTextEditing(): boolean {
    const el = document.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    ) {
      return true;
    }
    const canvas = getActiveCanvas();
    if (!canvas) return false;
    const obj = canvas.getActiveObject();
    return obj instanceof fabric.IText && obj.isEditing === true;
  }

  const getLayers = useCallback((): LayerItem[] => {
    const canvas = getActiveCanvas();
    if (!canvas) return [];
    return contentObjects(canvas)
      .map((obj) => ({
        id: (obj as { _layerId?: string })._layerId || String(contentObjects(canvas).indexOf(obj)),
        name: layerName(obj),
        kind: obj.type || "object",
      }))
      .reverse();
  }, [getActiveCanvas, layersEpoch, activeCanvasId]);

  const selectLayer = useCallback(
    (id: string) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const obj = contentObjects(canvas).find((o) => (o as { _layerId?: string })._layerId === id);
      if (!obj) return;
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      setSelectedObject(obj);
      setSelectionEpoch((n) => n + 1);
    },
    [getActiveCanvas]
  );

  const reorderLayers = useCallback(
    (fromDisplayIndex: number, toDisplayIndex: number) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      const display = [...contentObjects(canvas)].reverse();
      if (
        fromDisplayIndex < 0 ||
        toDisplayIndex < 0 ||
        fromDisplayIndex >= display.length ||
        toDisplayIndex >= display.length ||
        fromDisplayIndex === toDisplayIndex
      ) {
        return;
      }
      const [moved] = display.splice(fromDisplayIndex, 1);
      display.splice(toDisplayIndex, 0, moved);
      const bg = canvas.getObjects().find(isBgImage);
      let index = 0;
      if (bg) {
        canvas.moveObjectTo(bg, 0);
        index = 1;
      }
      for (const obj of display.slice().reverse()) {
        canvas.moveObjectTo(obj, index++);
      }
      canvas.requestRenderAll();
      saveHistory(pageId);
      setLayersEpoch((n) => n + 1);
    },
    [getActiveCanvas, saveHistory]
  );

  return {
    // Canvas map management
    registerCanvas,
    unregisterCanvas,
    setActiveCanvas,
    activeCanvasId,
    canvasMap: canvasMapRef,
    // For backward compat (right-sidebar uses canvas directly)
    get canvas() {
      return getActiveCanvas();
    },
    selectedObject,
    selectionEpoch,
    canvasWidth,
    canvasHeight,
    zoom,
    setZoomRaw: setZoom,
    fitScale,
    setFitScale,
    addText,
    addShape,
    addIcon,
    replaceSelectedIcon,
    addImage,
    addDroppedImages,
    addImageFromClipboard,
    replaceSelectedImage,
    setBackground,
    lockSelectedAsBackground,
    updateSelectedObject,
    duplicateSelected,
    copySelectedStyle,
    pasteSelectedStyle,
    hasCopiedStyle,
    groupSelected,
    ungroupSelected,
    saveSelectionAsElement,
    addLibraryElement,
    deleteSelected,
    undo,
    redo,
    canUndo,
    canRedo,
    setCanvasSize,
    zoomToFit,
    zoomIn,
    zoomOut,
    captureCanvasScreenshot,
    exportPNG,
    copyDesignToClipboard,
    getCanvasJSON,
    getCanvasJSONForPage,
    applyDesignDocument,
    applyPatchedDocument,
    patchDesignOnCanvas,
    loadTemplate,
    layersEpoch,
    getLayers,
    selectLayer,
    reorderLayers,
    bringSelectionToFront,
    sendSelectionToBack,
    alignSelected,
  };
}
