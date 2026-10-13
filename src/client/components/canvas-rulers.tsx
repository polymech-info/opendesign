import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { drawRuler, RULER_SIZE, type MeasureUnit, type RulerTheme } from "../lib/canvas-rulers";
import { reportCursor, type ConstructionLine } from "../lib/construction-lines";

export type RulerPaint = RulerTheme & { fonts: number };

function RulerCanvas({
  axis,
  span,
  zoom,
  unit,
  paint,
}: {
  axis: "h" | "v";
  span: number;
  zoom: number;
  unit: MeasureUnit;
  paint: RulerPaint;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = axis === "h" ? Math.max(1, span * zoom) : RULER_SIZE;
    const cssH = axis === "h" ? RULER_SIZE : Math.max(1, span * zoom);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRuler(ctx, {
      axis,
      span,
      zoom,
      unit,
      theme: { major: paint.major, minor: paint.minor, label: paint.label },
    });
  }, [axis, span, zoom, unit, paint.major, paint.minor, paint.label, paint.fonts]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      class="block pointer-events-none"
      style={{
        width: axis === "h" ? span * zoom : RULER_SIZE,
        height: axis === "h" ? RULER_SIZE : span * zoom,
      }}
    />
  );
}

function designAlong(client: number, origin: number, size: number, span: number): number | null {
  if (size <= 0) return null;
  const v = ((client - origin) / size) * span;
  if (v < -0.5 || v > span + 0.5) return null;
  return Math.min(span, Math.max(0, v));
}

function inside(el: Element, x: number, y: number) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function ArtboardFrame({
  pageId,
  designWidth,
  designHeight,
  zoom,
  unit,
  paint,
  showRulers,
  showLines,
  lines,
  selectedLineId,
  markedLineIds,
  onSelectLine,
  onAxisPick,
  onCreateLine,
  onMoveLine,
  onRemoveLine,
  title,
  children,
}: {
  pageId: string;
  designWidth: number;
  designHeight: number;
  zoom: number;
  unit: MeasureUnit;
  paint: RulerPaint;
  showRulers: boolean;
  showLines: boolean;
  lines: ConstructionLine[];
  selectedLineId: string | null;
  markedLineIds?: string[];
  onSelectLine: (id: string) => void;
  onAxisPick?: (line: ConstructionLine) => void;
  onCreateLine: (axis: ConstructionLine["axis"], at: number) => void;
  onMoveLine: (id: string, at: number) => void;
  onRemoveLine: (id: string) => void;
  title: ComponentChildren;
  children: ComponentChildren;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hMark = useRef<HTMLDivElement>(null);
  const vMark = useRef<HTMLDivElement>(null);
  const cursor = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const zoomRef = useRef(zoom);
  const metrics = useRef({ designWidth, designHeight, pageId, showRulers });
  const linesApi = useRef({ onCreateLine, onMoveLine, onRemoveLine, onSelectLine, showLines });
  zoomRef.current = zoom;
  metrics.current = { designWidth, designHeight, pageId, showRulers };
  linesApi.current = { onCreateLine, onMoveLine, onRemoveLine, onSelectLine, showLines };

  const place = (report: boolean) => {
    const z = zoomRef.current;
    const { x, y } = cursor.current;
    if (hMark.current) {
      if (x == null) hMark.current.style.opacity = "0";
      else {
        hMark.current.style.opacity = "1";
        hMark.current.style.transform = `translateX(${x * z}px)`;
      }
    }
    if (vMark.current) {
      if (y == null) vMark.current.style.opacity = "0";
      else {
        vMark.current.style.opacity = "1";
        vMark.current.style.transform = `translateY(${y * z}px)`;
      }
    }
    if (report) reportCursor(x, y);
  };

  useLayoutEffect(() => {
    place(false);
  }, [zoom]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const move = (e: PointerEvent) => {
      const { designWidth: dw, designHeight: dh, pageId: id } = metrics.current;
      const art = root.querySelector(`[data-page-canvas="${id}"]`);
      const h = root.querySelector("[data-ruler-h]");
      const v = root.querySelector("[data-ruler-v]");
      let x: number | null = null;
      let y: number | null = null;
      if (art && inside(art, e.clientX, e.clientY)) {
        const r = art.getBoundingClientRect();
        x = designAlong(e.clientX, r.left, r.width, dw);
        y = designAlong(e.clientY, r.top, r.height, dh);
      } else {
        if (h && inside(h, e.clientX, e.clientY)) {
          const r = h.getBoundingClientRect();
          x = designAlong(e.clientX, r.left, r.width, dw);
        }
        if (v && inside(v, e.clientX, e.clientY)) {
          const r = v.getBoundingClientRect();
          y = designAlong(e.clientY, r.top, r.height, dh);
        }
      }
      cursor.current = { x, y };
      place(true);
    };
    const leave = () => {
      cursor.current = { x: null, y: null };
      place(true);
    };
    const dbl = (e: MouseEvent) => {
      if (!metrics.current.showRulers) return;
      const h = root.querySelector("[data-ruler-h]");
      const v = root.querySelector("[data-ruler-v]");
      const { designWidth: dw, designHeight: dh } = metrics.current;
      if (h && inside(h, e.clientX, e.clientY)) {
        const r = h.getBoundingClientRect();
        const x = designAlong(e.clientX, r.left, r.width, dw);
        if (x == null) return;
        e.preventDefault();
        e.stopPropagation();
        linesApi.current.onCreateLine("v", x);
        return;
      }
      if (v && inside(v, e.clientX, e.clientY)) {
        const r = v.getBoundingClientRect();
        const y = designAlong(e.clientY, r.top, r.height, dh);
        if (y == null) return;
        e.preventDefault();
        e.stopPropagation();
        linesApi.current.onCreateLine("h", y);
      }
    };
    root.addEventListener("pointermove", move, true);
    root.addEventListener("pointerleave", leave);
    root.addEventListener("dblclick", dbl);
    return () => {
      root.removeEventListener("pointermove", move, true);
      root.removeEventListener("pointerleave", leave);
      root.removeEventListener("dblclick", dbl);
    };
  }, []);

  const screenW = designWidth * zoom;
  const screenH = designHeight * zoom;
  const gutter = showRulers ? RULER_SIZE : 0;

  const beginLineDrag = (e: PointerEvent, line: ConstructionLine) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    linesApi.current.onSelectLine(line.id);
    const move = (ev: PointerEvent) => {
      if (overSourceRuler(rootRef.current, line.axis, ev.clientX, ev.clientY)) return;
      const raw = designOnArtboard(rootRef.current, metrics.current, line.axis, ev.clientX, ev.clientY);
      if (raw == null) return;
      linesApi.current.onMoveLine(line.id, raw);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (overSourceRuler(rootRef.current, line.axis, ev.clientX, ev.clientY)) {
        linesApi.current.onRemoveLine(line.id);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={rootRef}
      data-page-id={pageId}
      class="mb-10"
      style={{ width: screenW + gutter }}
    >
      <div style={{ marginLeft: gutter, width: screenW }}>{title}</div>
      <div class="flex items-start">
        {showRulers && (
          <div class="shrink-0" style={{ width: RULER_SIZE }} aria-hidden="true">
            <div
              class="bg-surface-secondary border-r border-b border-border-dim"
              style={{ width: RULER_SIZE, height: RULER_SIZE }}
            />
            <div
              data-ruler-v=""
              title="Double-click to add a construction line"
              class="relative overflow-hidden bg-surface-secondary border-r border-border-dim"
              style={{ width: RULER_SIZE, height: screenH }}
            >
              <RulerCanvas axis="v" span={designHeight} zoom={zoom} unit={unit} paint={paint} />
              <div
                ref={vMark}
                class="absolute left-0 right-0 top-0 h-px bg-accent pointer-events-none opacity-0"
              />
            </div>
          </div>
        )}
        <div>
          {showRulers && (
            <div
              data-ruler-h=""
              title="Double-click to add a construction line"
              aria-hidden="true"
              class="relative overflow-hidden bg-surface-secondary border-b border-border-dim"
              style={{ width: screenW, height: RULER_SIZE }}
            >
              <RulerCanvas axis="h" span={designWidth} zoom={zoom} unit={unit} paint={paint} />
              <div
                ref={hMark}
                class="absolute left-0 top-0 bottom-0 w-px bg-accent pointer-events-none opacity-0"
              />
            </div>
          )}
          <div class="relative" style={{ width: screenW, height: screenH }}>
            {children}
            {showLines && lines.length > 0 && (
              <div class="absolute inset-0 z-20 pointer-events-none">
                {lines.map((line) => {
                  const span = line.axis === "v" ? designWidth : designHeight;
                  const atHalf = unit === "%" && Math.abs(line.at - span / 2) <= 0.5;
                  const selected = line.id === selectedLineId || !!markedLineIds?.includes(line.id);
                  const guide = atHalf || selected ? "opend-guide-half" : "opend-guide";
                  const pickLine = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
                    if (!onAxisPick) return false;
                    e.preventDefault();
                    e.stopPropagation();
                    onAxisPick(line);
                    return true;
                  };
                  return line.axis === "v" ? (
                    <div
                      key={line.id}
                      title={onAxisPick ? "Use as a pattern axis" : "Drag to move. Drag onto the top ruler to remove."}
                      class={`absolute top-0 bottom-0 pointer-events-auto ${onAxisPick ? "cursor-crosshair" : "cursor-col-resize"}`}
                      style={{ left: line.at * zoom, width: 8, transform: "translateX(-4px)", touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (pickLine(e)) return;
                        beginLineDrag(e as unknown as PointerEvent, line);
                      }}
                      onDblClick={(e) => {
                        if (pickLine(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveLine(line.id);
                      }}
                    >
                      <div class={`${guide} absolute inset-y-0 left-1/2 -translate-x-1/2 pointer-events-none ${atHalf || selected ? "w-0.5" : "w-px"}`} />
                    </div>
                  ) : (
                    <div
                      key={line.id}
                      title={onAxisPick ? "Use as a pattern axis" : "Drag to move. Drag onto the left ruler to remove."}
                      class={`absolute left-0 right-0 pointer-events-auto ${onAxisPick ? "cursor-crosshair" : "cursor-row-resize"}`}
                      style={{ top: line.at * zoom, height: 8, transform: "translateY(-4px)", touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (pickLine(e)) return;
                        beginLineDrag(e as unknown as PointerEvent, line);
                      }}
                      onDblClick={(e) => {
                        if (pickLine(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveLine(line.id);
                      }}
                    >
                      <div class={`${guide} absolute inset-x-0 top-1/2 -translate-y-1/2 pointer-events-none ${atHalf || selected ? "h-0.5" : "h-px"}`} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function designOnArtboard(
  root: HTMLDivElement | null,
  metrics: { pageId: string; designWidth: number; designHeight: number },
  axis: ConstructionLine["axis"],
  clientX: number,
  clientY: number,
): number | null {
  if (!root) return null;
  const art = root.querySelector(`[data-page-canvas="${metrics.pageId}"]`);
  if (!art) return null;
  const r = art.getBoundingClientRect();
  if (axis === "v") return designAlong(clientX, r.left, r.width, metrics.designWidth);
  return designAlong(clientY, r.top, r.height, metrics.designHeight);
}

function overSourceRuler(
  root: HTMLDivElement | null,
  axis: ConstructionLine["axis"],
  clientX: number,
  clientY: number,
) {
  if (!root) return false;
  const el = root.querySelector(axis === "v" ? "[data-ruler-h]" : "[data-ruler-v]");
  return !!el && inside(el, clientX, clientY);
}
