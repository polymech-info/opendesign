import { useRef, useEffect, useState } from "preact/hooks";
import { Plus, Copy, Trash2 } from "lucide-preact";
import { useEditor } from "../context";
import { PageCanvas } from "./page-canvas";
import { acceptFileDrag, imageFilesFromDataTransfer } from "../lib/file-drop";
import {
  CANVAS_SCROLL_ID,
  computeFitScale,
  revealPageInScroller,
  zoomIsAtFit,
} from "../lib/canvas-viewport";

export function CanvasArea() {
  const {
    pages, activePageId, setActiveCanvas, canvasWidth, canvasHeight,
    zoom, fitScale, setZoomRaw, setFitScale, addPage, duplicatePage, deletePage, renamePage,
    addDroppedImages,
    readImageDropTarget,
    openContextMenuAt,
  } = useEditor();
  const [dropHint, setDropHint] = useState<{
    pageId: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const fitScaleRef = useRef(0);
  const zoomRef = useRef(zoom);
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
      const fit = computeFitScale(wrapper.clientWidth, wrapper.clientHeight, canvasWidth, canvasHeight);
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

  return (
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
          <div
            key={page.id}
            class="mb-10"
            data-page-id={page.id}
            style={{ width: pageW }}
            ref={(el) => {
              if (el) pageRefs.current.set(page.id, el);
            }}
          >
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
          </div>
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
  );
}
