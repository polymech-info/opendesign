import { useRef, useEffect, useState } from "preact/hooks";
import { Plus, Copy, Trash2 } from "lucide-preact";
import type * as fabric from "fabric";
import { useEditor } from "../context";
import { PageCanvas } from "./page-canvas";
import { ArtboardFrame, type RulerPaint } from "./canvas-rulers";
import { CanvasViewBar } from "./canvas-view-bar";
import { RectPatternDialog } from "./rect-pattern-dialog";
import { MirrorDialog } from "./mirror-dialog";
import { acceptFileDrag, imageFilesFromDataTransfer } from "../lib/file-drop";
import { isBgImage } from "../lib/background-image";
import { selectedCanvasObjects } from "../lib/object-style";
import {
  RECT_PATTERN_EVENT,
  nearestPatternEdge,
  patternRefDir,
  restorePatternSources,
  type PatternRef,
} from "../lib/rect-pattern";
import { MIRROR_EVENT } from "../lib/mirror";
import { RULER_SIZE, publishMeasureUnit, snapDesignLength, type MeasureUnit } from "../lib/canvas-rulers";
import {
  pageConstructionLines,
  publishConstructionSnap,
  readConstructionLines,
  setPageConstructionLines,
  type ConstructionLine,
} from "../lib/construction-lines";
import {
  CANVAS_SCROLL_ID,
  CANVAS_VIEW_PAD_X,
  CANVAS_VIEW_PAD_Y,
  computeFitScale,
  revealPageInScroller,
  zoomIsAtFit,
} from "../lib/canvas-viewport";

function readRulerTheme(): Omit<RulerPaint, "fonts"> {
  const s = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  const label = pick("--opend-fg-secondary", "#52525b");
  return {
    major: label,
    minor: pick("--opend-border-mid", "#D1D5DB"),
    label,
  };
}

function useRulerPaint(): RulerPaint {
  const [paint, setPaint] = useState<RulerPaint>(() => ({ ...readRulerTheme(), fonts: 0 }));
  useEffect(() => {
    const sync = () => setPaint((prev) => ({ ...readRulerTheme(), fonts: prev.fonts }));
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      setPaint((prev) => ({ ...readRulerTheme(), fonts: prev.fonts + 1 }));
    });
    return () => {
      alive = false;
      obs.disconnect();
    };
  }, []);
  return paint;
}

export function CanvasArea() {
  const {
    pages, activePageId, setActiveCanvas, canvas, selectedObject, selectionEpoch, canvasWidth, canvasHeight,
    zoom, fitScale, setZoomRaw, setFitScale, addPage, duplicatePage, deletePage, renamePage,
    scheduleSave, diskReloadEpoch,
    addDroppedImages,
    readImageDropTarget,
    openContextMenuAt,
    applyRectangularPattern,
    applyMirror,
    setSelectionOrigin,
  } = useEditor();
  const [dropHint, setDropHint] = useState<{
    pageId: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rulerPaint = useRulerPaint();
  const [showRulers, setShowRulers] = useState(true);
  const [showLines, setShowLines] = useState(true);
  const [unit, setUnit] = useState<MeasureUnit>("px");
  useEffect(() => {
    publishMeasureUnit(unit);
  }, [unit]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [patternObjects, setPatternObjects] = useState<fabric.FabricObject[] | null>(null);
  const [patternMode, setPatternMode] = useState<"pattern" | "mirror" | null>(null);
  const [patternRef, setPatternRef] = useState<PatternRef | null>(null);
  const [patternPick, setPatternPick] = useState<0 | 1 | null>(null);
  const [markedLineIds, setMarkedLineIds] = useState<string[]>([]);
  const patternSourcesRef = useRef<fabric.FabricObject[]>([]);
  const pickBridge = useRef<(ref: PatternRef) => void>(() => {});
  const [linesByPage, setLinesByPage] = useState<Record<string, ConstructionLine[]>>({});
  const linesEpochRef = useRef<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const fitScaleRef = useRef(0);
  const zoomRef = useRef(zoom);
  const showRulersRef = useRef(showRulers);
  const applyFitRef = useRef<(seedZoom: boolean) => void>(() => {});
  showRulersRef.current = showRulers;
  const revealAfterFitRef = useRef(false);
  const pagesRef = useRef(pages);
  const sizeRef = useRef({ canvasWidth, canvasHeight, activePageId });
  pagesRef.current = pages;
  sizeRef.current = { canvasWidth, canvasHeight, activePageId };
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Fit the artboard to the scroller. Sidebar hide/show shrinks this box — if the
  // user was at fit zoom, follow the new size so the page is not clipped.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let raf = 0;
    const apply = (seedZoom: boolean) => {
      raf = 0;
      const rulerPad = showRulersRef.current ? RULER_SIZE : 0;
      const fit = computeFitScale(
        wrapper.clientWidth,
        wrapper.clientHeight,
        canvasWidth,
        canvasHeight,
        CANVAS_VIEW_PAD_X + rulerPad,
        CANVAS_VIEW_PAD_Y + rulerPad,
      );
      const prevFit = fitScaleRef.current;
      const sized = wrapper.clientWidth > 40 && wrapper.clientHeight > 40;
      const fitChanged = Math.abs(fit - prevFit) >= 0.001;
      if (fitChanged || seedZoom) {
        fitScaleRef.current = fit;
        setFitScale(fit);
      }
      if (seedZoom) {
        if (sized) setZoomRaw(fit);
        return;
      }
      if (!fitChanged) return;
      const atFit = prevFit < 0.05 || zoomIsAtFit(zoomRef.current, prevFit || fit);
      if (atFit) {
        revealAfterFitRef.current = true;
        setZoomRaw(fit);
      } else {
        revealPageInScroller(sizeRef.current.activePageId, "auto");
      }
    };
    applyFitRef.current = apply;
    apply(true);
    const obs = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => apply(false));
    });
    obs.observe(wrapper);
    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [canvasWidth, canvasHeight, setFitScale, setZoomRaw]);

  useEffect(() => {
    applyFitRef.current(false);
  }, [showRulers]);

  useEffect(() => {
    if (!revealAfterFitRef.current) return;
    revealAfterFitRef.current = false;
    revealPageInScroller(activePageId, "auto");
  }, [zoom, fitScale, activePageId]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const prevZoom = zoomRef.current;
      const factor = e.deltaY > 0 ? 0.95 : 1.05;
      const newZoom = Math.min(Math.max(prevZoom * factor, 0.05), 3);

      // Mouse position relative to scroll container
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + wrapper.scrollLeft;
      const mouseY = e.clientY - rect.top + wrapper.scrollTop;

      // Adjust scroll to keep point under mouse stable
      const scale = newZoom / prevZoom;
      wrapper.scrollLeft = mouseX * scale - (e.clientX - rect.left);
      wrapper.scrollTop = mouseY * scale - (e.clientY - rect.top);

      setZoomRaw(newZoom);
    };
    wrapper.addEventListener("wheel", handler, { passive: false });
    return () => wrapper.removeEventListener("wheel", handler);
  }, [setZoomRaw]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const hit = (clientX: number, clientY: number) => {
      const { canvasWidth: w, canvasHeight: h, activePageId: active } = sizeRef.current;
      for (const page of pagesRef.current) {
        const el = wrapper.querySelector(`[data-page-canvas="${page.id}"]`);
        if (!(el instanceof HTMLElement)) continue;
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
          continue;
        }
        return {
          pageId: page.id,
          left: ((clientX - rect.left) / Math.max(rect.width, 1)) * w,
          top: ((clientY - rect.top) / Math.max(rect.height, 1)) * h,
        };
      }
      return active ? { pageId: active } : undefined;
    };
    const over = (e: DragEvent) => {
      if (!acceptFileDrag(e)) {
        setDropHint(null);
        return;
      }
      const at = hit(e.clientX, e.clientY);
      if (!at?.pageId || at.left == null || at.top == null) {
        setDropHint(null);
        return;
      }
      const next = readImageDropTarget(at.pageId, at.left, at.top);
      setDropHint((prev) => {
        if (
          prev &&
          next &&
          prev.pageId === next.pageId &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget && wrapper.contains(e.relatedTarget as Node)) return;
      setDropHint(null);
    };
    const drop = (e: DragEvent) => {
      setDropHint(null);
      if (!acceptFileDrag(e)) return;
      const files = imageFilesFromDataTransfer(e.dataTransfer);
      if (!files.length) return;
      void addDroppedImages(files, hit(e.clientX, e.clientY));
    };
    const context = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const at = hit(e.clientX, e.clientY);
      openContextMenuAt({
        pageId: at?.pageId,
        left: at?.left,
        top: at?.top,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };
    wrapper.addEventListener("dragenter", over);
    wrapper.addEventListener("dragover", over);
    wrapper.addEventListener("dragleave", leave);
    wrapper.addEventListener("drop", drop);
    wrapper.addEventListener("contextmenu", context, true);
    return () => {
      wrapper.removeEventListener("dragenter", over);
      wrapper.removeEventListener("dragover", over);
      wrapper.removeEventListener("dragleave", leave);
      wrapper.removeEventListener("drop", drop);
      wrapper.removeEventListener("contextmenu", context, true);
    };
  }, [addDroppedImages, readImageDropTarget, openContextMenuAt]);

  // Auto-activate first page if none active
  useEffect(() => {
    if (!activePageId && pages.length > 0) {
      setActiveCanvas(pages[0].id);
    }
  }, [pages, activePageId, setActiveCanvas]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const startRename = (pageId: string, currentTitle: string) => {
    setRenamingId(pageId);
    setRenameValue(currentTitle);
  };

  const finishRename = () => {
    if (renamingId && renameValue.trim()) {
      renamePage(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const pageW = canvasWidth * zoom;
  const pageH = canvasHeight * zoom;

  const reloaded = linesEpochRef.current !== diskReloadEpoch;
  if (reloaded) linesEpochRef.current = diskReloadEpoch;
  for (const page of pages) {
    if (reloaded || pageConstructionLines(page.id) == null) {
      setPageConstructionLines(page.id, readConstructionLines(page.canvas_json));
    }
  }

  useEffect(() => {
    setLinesByPage(() => {
      const next: Record<string, ConstructionLine[]> = {};
      for (const page of pages) {
        next[page.id] = pageConstructionLines(page.id) ?? readConstructionLines(page.canvas_json);
      }
      return next;
    });
  }, [pages, diskReloadEpoch]);

  useEffect(() => {
    const lines = showLines && activePageId ? linesByPage[activePageId] ?? [] : [];
    publishConstructionSnap(lines);
    return () => publishConstructionSnap([]);
  }, [showLines, activePageId, linesByPage]);

  useEffect(() => {
    if (!canvas) return;
    const clear = (opt: { target?: fabric.FabricObject }) => {
      if (opt.target) return;
      setSelectedLineId(null);
    };
    canvas.on("mouse:down", clear);
    return () => {
      canvas.off("mouse:down", clear);
    };
  }, [canvas]);

  useEffect(() => {
    const open = (mode: "pattern" | "mirror") => {
      if (patternObjects) return;
      const objects = selectedCanvasObjects(canvas, selectedObject).filter((obj) => !isBgImage(obj));
      if (objects.length === 0) return;
      const line = (activePageId ? linesByPage[activePageId] ?? [] : []).find((item) => item.id === selectedLineId);
      const ref: PatternRef | null = line ? { kind: "line", id: line.id, axis: line.axis } : null;
      patternSourcesRef.current = objects;
      setPatternRef(ref);
      setPatternPick(mode === "mirror" ? (ref ? null : 0) : ref ? 1 : 0);
      setMarkedLineIds(line ? [line.id] : []);
      setPatternMode(mode);
      setPatternObjects(objects);
    };
    const onPattern = () => open("pattern");
    const onMirror = () => open("mirror");
    window.addEventListener(RECT_PATTERN_EVENT, onPattern);
    window.addEventListener(MIRROR_EVENT, onMirror);
    return () => {
      window.removeEventListener(RECT_PATTERN_EVENT, onPattern);
      window.removeEventListener(MIRROR_EVENT, onMirror);
    };
  }, [canvas, selectedObject, patternObjects, activePageId, linesByPage, selectedLineId]);

  useEffect(() => {
    if (!canvas || patternPick == null) return;
    const onDown = (opt: { e: Event }) => {
      if ((opt.e as MouseEvent).button !== 0) return;
      let point: { x: number; y: number };
      try {
        point = canvas.getScenePoint(opt.e as MouseEvent);
      } catch {
        return;
      }
      const edge = nearestPatternEdge([...canvas.getObjects(), ...canvas.getActiveObjects()], point, zoom);
      if (edge) pickBridge.current(edge);
      const sources = patternSourcesRef.current;
      requestAnimationFrame(() => {
        if (patternSourcesRef.current !== sources) return;
        restorePatternSources(canvas, sources);
      });
    };
    canvas.on("mouse:down", onDown);
    return () => {
      canvas.off("mouse:down", onDown);
    };
  }, [canvas, patternPick, zoom]);

  const closePattern = () => {
    patternSourcesRef.current = [];
    setPatternObjects(null);
    setPatternMode(null);
    setPatternRef(null);
    setPatternPick(null);
    setMarkedLineIds([]);
  };

  const selectLine = (id: string) => {
    setSelectedLineId(id);
  };

  const snapLine = (axis: ConstructionLine["axis"], raw: number, others: number[]) => {
    const span = axis === "v" ? canvasWidth : canvasHeight;
    return snapDesignLength(raw, span, zoom, others, unit);
  };

  const createLine = (pageId: string, axis: ConstructionLine["axis"], raw: number) => {
    if (!showLines) setShowLines(true);
    const id = crypto.randomUUID();
    setLinesByPage((prev) => {
      const list = prev[pageId] ?? [];
      if (list.some((line) => line.id === id)) return prev;
      const others = list.filter((line) => line.axis === axis).map((line) => line.at);
      const at = snapLine(axis, raw, others);
      const existing = list.find((line) => line.axis === axis && Math.abs(line.at - at) < 0.51);
      const next = existing
        ? list.filter((line) => line.id !== existing.id)
        : [...list, { id, axis, at }];
      if (existing) setSelectedLineId((cur) => (cur === existing.id ? null : cur));
      else selectLine(id);
      setPageConstructionLines(pageId, next);
      scheduleSave();
      return { ...prev, [pageId]: next };
    });
  };

  const moveLine = (pageId: string, id: string, raw: number) => {
    setLinesByPage((prev) => {
      const list = prev[pageId] ?? [];
      const current = list.find((line) => line.id === id);
      if (!current) return prev;
      const others = list.filter((line) => line.axis === current.axis && line.id !== id).map((line) => line.at);
      const at = snapLine(current.axis, raw, others);
      const next = list.map((line) => (line.id === id ? { ...line, at } : line));
      setPageConstructionLines(pageId, next);
      scheduleSave();
      return { ...prev, [pageId]: next };
    });
  };

  const removeLine = (pageId: string, id: string) => {
    setSelectedLineId((cur) => (cur === id ? null : cur));
    setLinesByPage((prev) => {
      const next = (prev[pageId] ?? []).filter((line) => line.id !== id);
      setPageConstructionLines(pageId, next);
      scheduleSave();
      return { ...prev, [pageId]: next };
    });
  };

  return (
    <div class="flex flex-1 flex-col min-h-0 min-w-0">
    <div
      id={CANVAS_SCROLL_ID}
      ref={wrapperRef}
      class="flex-1 overflow-auto bg-surface"
    >
      <div
        class="flex flex-col items-center"
        style={{
          minWidth: "100%",
          minHeight: "100%",
          padding: "40px 40px 80px",
          boxSizing: "border-box",
        }}
      >
        {pages.map((page) => (
          <ArtboardFrame
            key={page.id}
            pageId={page.id}
            designWidth={canvasWidth}
            designHeight={canvasHeight}
            zoom={zoom}
            unit={unit}
            paint={rulerPaint}
            showRulers={showRulers}
            showLines={showLines}
            lines={linesByPage[page.id] ?? []}
            selectedLineId={selectedLineId}
            markedLineIds={markedLineIds}
            onSelectLine={selectLine}
            onAxisPick={
              patternPick == null
                ? undefined
                : (line) => pickBridge.current({ kind: "line", id: line.id, axis: line.axis })
            }
            onCreateLine={(axis, at) => createLine(page.id, axis, at)}
            onMoveLine={(id, at) => moveLine(page.id, id, at)}
            onRemoveLine={(id) => removeLine(page.id, id)}
            title={
            <div
              class="group/header flex items-center justify-between py-1.5"
              style={{ width: pageW, height: 32 }}
            >
              <div class="flex items-center gap-1.5">
                {renamingId === page.id ? (
                  <input
                    ref={renameRef}
                    class="text-[11px] text-fg-secondary bg-surface-card border border-accent rounded px-1.5 py-0.5 outline-none font-medium"
                    style={{ width: 140 }}
                    value={renameValue}
                    onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
                    onBlur={finishRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span
                    class="text-[11px] text-fg-muted font-medium cursor-pointer hover:text-fg-secondary transition-colors"
                    onClick={() => startRename(page.id, page.title)}
                  >
                    {page.title}
                  </span>
                )}
              </div>

              <div class="flex items-center gap-0.5">
                <button
                  class="p-1 rounded bg-transparent border-none cursor-pointer text-fg-muted hover:text-accent hover:bg-accent/10 transition-all"
                  onClick={() => addPage(page.id)}
                  title="Add page below"
                >
                  <Plus size={14} />
                </button>
                <button
                  class="p-1 rounded bg-transparent border-none cursor-pointer text-fg-muted hover:text-accent hover:bg-accent/10 transition-all"
                  onClick={() => duplicatePage(page.id)}
                  title="Duplicate page"
                >
                  <Copy size={14} />
                </button>
                {pages.length > 1 && (
                  <button
                    class="p-1 rounded bg-transparent border-none cursor-pointer text-fg-muted hover:text-red-500 hover:bg-red-500/10 transition-all"
                    onClick={() => deletePage(page.id)}
                    title="Delete page"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            }
          >
            <div class="relative overflow-hidden" style={{ width: pageW, height: pageH }}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: canvasWidth,
                  height: canvasHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <PageCanvas
                  page={page}
                  isActive={page.id === activePageId}
                  width={canvasWidth}
                  height={canvasHeight}
                />
                {dropHint?.pageId === page.id && (
                  <div
                    class="absolute pointer-events-none z-10 rounded-md"
                    style={{
                      left: dropHint.left,
                      top: dropHint.top,
                      width: dropHint.width,
                      height: dropHint.height,
                      boxShadow: "inset 0 0 0 2px #6366f1, 0 0 0 2px #6366f1",
                    }}
                  >
                    <span class="absolute left-1/2 top-2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-semibold tracking-wide shadow-sm whitespace-nowrap">
                      Replace
                    </span>
                  </div>
                )}
              </div>
            </div>
          </ArtboardFrame>
        ))}

        <button
          class="flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 border-dashed border-border-mid bg-transparent cursor-pointer text-xs text-fg-muted font-medium transition-all hover:border-accent hover:text-accent hover:bg-accent/5"
          onClick={() => addPage()}
        >
          <Plus size={14} />
          Add page
        </button>
      </div>
    </div>
    <CanvasViewBar
      showRulers={showRulers}
      showLines={showLines}
      unit={unit}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
      canvas={canvas}
      selectionEpoch={selectionEpoch}
      selectedLine={
        Object.values(linesByPage).flat().find((line) => line.id === selectedLineId) ?? null
      }
      canPattern={selectedCanvasObjects(canvas, selectedObject).some((obj) => !isBgImage(obj))}
      onPattern={() => window.dispatchEvent(new Event(RECT_PATTERN_EVENT))}
      onMirror={() => window.dispatchEvent(new Event(MIRROR_EVENT))}
      onCommitPosition={(axis, px) => {
        const active = canvas?.getActiveObject();
        if (active && !isBgImage(active)) {
          setSelectionOrigin(axis === "x" ? { x: px } : { y: px });
          return;
        }
        if (!activePageId || !selectedLineId) return;
        const line = (linesByPage[activePageId] ?? []).find((item) => item.id === selectedLineId);
        if (!line) return;
        if (axis === "x" && line.axis !== "v") return;
        if (axis === "y" && line.axis !== "h") return;
        setLinesByPage((prev) => {
          const list = prev[activePageId] ?? [];
          const next = list.map((item) => (item.id === line.id ? { ...item, at: px } : item));
          setPageConstructionLines(activePageId, next);
          scheduleSave();
          return { ...prev, [activePageId]: next };
        });
      }}
      onUnit={setUnit}
      onToggleRulers={() => setShowRulers((open) => !open)}
      onToggleLines={() => setShowLines((open) => !open)}
    />
    {patternObjects && patternMode === "pattern" && (
      <RectPatternDialog
        objects={patternObjects}
        canvasWidth={canvasWidth}
        canvasHeight={canvasHeight}
        initialUnit={unit}
        initialRef={patternRef}
        pickBridge={pickBridge}
        onPickSlot={setPatternPick}
        onMarkedLines={setMarkedLineIds}
        onApply={(offsets) => {
          const sources = patternSourcesRef.current;
          closePattern();
          void applyRectangularPattern(sources, offsets);
        }}
        onClose={closePattern}
      />
    )}
    {patternObjects && patternMode === "mirror" && (
      <MirrorDialog
        objects={patternObjects}
        initialRef={patternRef}
        pickBridge={pickBridge}
        onPickSlot={setPatternPick}
        onMarkedLines={setMarkedLineIds}
        onApply={(ref, preserveOrientation) => {
          const sources = patternSourcesRef.current;
          const at =
            ref.kind === "line"
              ? (activePageId ? linesByPage[activePageId] ?? [] : []).find((line) => line.id === ref.id)?.at
              : ref.at;
          if (at == null || !Number.isFinite(at)) return;
          closePattern();
          void applyMirror(sources, patternRefDir(ref), at, preserveOrientation);
        }}
        onClose={closePattern}
      />
    )}
    </div>
  );
}
