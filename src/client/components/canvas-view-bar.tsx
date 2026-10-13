import { useEffect, useState } from "preact/hooks";
import type * as fabric from "fabric";
import { FlipHorizontal2, LayoutGrid, Ruler } from "lucide-preact";
import { MEASURE_UNITS, formatDesignLength, type MeasureUnit } from "../lib/canvas-rulers";
import { DesignLengthInput } from "./design-length-input";
import { subscribeCursor, type ConstructionLine } from "../lib/construction-lines";
import { sceneBounds } from "../lib/snap-guides";

const UNIT_TITLE: Record<MeasureUnit, string> = {
  px: "Pixels",
  mm: "Millimeters",
  cm: "Centimeters",
  in: "Inches",
  "%": "Percent of the canvas",
};

function coord(axis: string, value: number | null, unit: MeasureUnit, span: number) {
  if (value == null) return `${axis} —`;
  return `${axis} ${formatDesignLength(value, unit, span)}`;
}

type Frame = { x: number; y: number; w: number | null; h: number | null };

function sameFrame(a: Frame | null, b: Frame | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  const r = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
  return r(a.x) === r(b.x) && r(a.y) === r(b.y) && r(a.w) === r(b.w) && r(a.h) === r(b.h);
}

function useSelectionFrame(canvas: fabric.Canvas | null, epoch: number): Frame | null {
  const [frame, setFrame] = useState<Frame | null>(null);
  useEffect(() => {
    const read = () => {
      const obj = canvas?.getActiveObject();
      if (!obj) {
        setFrame((prev) => (prev == null ? prev : null));
        return;
      }
      const box = sceneBounds(obj);
      const next = { x: box.left, y: box.top, w: box.right - box.left, h: box.bottom - box.top };
      setFrame((prev) => (sameFrame(prev, next) ? prev : next));
    };
    read();
    if (!canvas) return;
    const events = [
      "object:moving",
      "object:scaling",
      "object:rotating",
      "object:resizing",
      "object:modified",
      "selection:created",
      "selection:updated",
      "selection:cleared",
    ] as const;
    for (const name of events) canvas.on(name, read);
    return () => {
      for (const name of events) canvas.off(name, read);
    };
  }, [canvas, epoch]);
  return frame;
}

function lineFrame(line: ConstructionLine, width: number, height: number): Frame {
  if (line.axis === "v") return { x: line.at, y: 0, w: null, h: height };
  return { x: 0, y: line.at, w: width, h: null };
}

function toggleClass(on: boolean) {
  return `inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border-none cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
    on
      ? "bg-accent/10 text-accent"
      : "bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
  }`;
}

export function CanvasViewBar({
  showRulers,
  showLines,
  unit,
  canvasWidth,
  canvasHeight,
  canvas,
  selectionEpoch,
  selectedLine,
  canPattern,
  onPattern,
  onMirror,
  onCommitPosition,
  onUnit,
  onToggleRulers,
  onToggleLines,
}: {
  showRulers: boolean;
  showLines: boolean;
  unit: MeasureUnit;
  canvasWidth: number;
  canvasHeight: number;
  canvas: fabric.Canvas | null;
  selectionEpoch: number;
  selectedLine: ConstructionLine | null;
  canPattern: boolean;
  onPattern: () => void;
  onMirror: () => void;
  onCommitPosition: (axis: "x" | "y", px: number) => void;
  onUnit: (unit: MeasureUnit) => void;
  onToggleRulers: () => void;
  onToggleLines: () => void;
}) {
  const [cursor, setCursor] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const objectFrame = useSelectionFrame(canvas, selectionEpoch);
  const frame = objectFrame ?? (selectedLine ? lineFrame(selectedLine, canvasWidth, canvasHeight) : null);
  const editX = !!objectFrame || selectedLine?.axis === "v";
  const editY = !!objectFrame || selectedLine?.axis === "h";
  const fieldClass =
    "w-14 bg-transparent border border-transparent rounded px-0.5 py-0 font-mono tabular-nums text-[11px] text-fg-secondary outline-none focus:border-accent focus:bg-surface-muted";

  useEffect(() => subscribeCursor(setCursor), []);

  return (
    <div class="flex items-center gap-2 px-3 py-1 bg-surface-card border-t border-border-dim shrink-0">
      <p class="m-0 min-w-[9.5rem] font-mono tabular-nums text-[11px] text-fg-secondary">
        {coord("X", cursor.x, unit, canvasWidth)}
        <span class="inline-block w-3" />
        {coord("Y", cursor.y, unit, canvasHeight)}
      </p>
      <div class="inline-flex overflow-hidden rounded-md border border-border-dim divide-x divide-border-dim" role="group" aria-label="Units">
        {MEASURE_UNITS.map((item) => (
          <button
            key={item}
            type="button"
            class={`px-1.5 py-1 text-[11px] font-medium cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              unit === item
                ? "bg-accent/10 text-accent"
                : "bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
            }`}
            aria-pressed={unit === item}
            title={UNIT_TITLE[item]}
            onClick={() => onUnit(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div class="w-px h-4 bg-border-dim shrink-0" aria-hidden="true" />
      <div
        class="flex items-center gap-2 font-mono tabular-nums text-[11px] text-fg-secondary whitespace-nowrap"
        title={
          objectFrame
            ? "Selection, top left and size. X and Y apply when the field loses focus."
            : selectedLine
              ? "Construction line. The position applies when the field loses focus."
              : "Selection, top left and size"
        }
      >
        {editX && frame ? (
          <DesignLengthInput
            label="X"
            value={frame.x}
            unit={unit}
            span={canvasWidth}
            className={fieldClass}
            title="Top left X. Applies when the field loses focus."
            onCommit={(px) => onCommitPosition("x", px)}
          />
        ) : (
          <span>{coord("X", frame?.x ?? null, unit, canvasWidth)}</span>
        )}
        {editY && frame ? (
          <DesignLengthInput
            label="Y"
            value={frame.y}
            unit={unit}
            span={canvasHeight}
            className={fieldClass}
            title="Top left Y. Applies when the field loses focus."
            onCommit={(px) => onCommitPosition("y", px)}
          />
        ) : (
          <span>{coord("Y", frame?.y ?? null, unit, canvasHeight)}</span>
        )}
        <span>{coord("W", frame?.w ?? null, unit, canvasWidth)}</span>
        <span>{coord("H", frame?.h ?? null, unit, canvasHeight)}</span>
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border border-border-dim bg-transparent text-fg-secondary cursor-pointer hover:border-accent hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-dim disabled:hover:text-fg-secondary"
        disabled={!canPattern}
        title="Rectangular pattern. Duplicates the selection across a selected construction line, or a line or edge you pick."
        onClick={onPattern}
      >
        <LayoutGrid size={13} />
        Pattern
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border border-border-dim bg-transparent text-fg-secondary cursor-pointer hover:border-accent hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border-dim disabled:hover:text-fg-secondary"
        disabled={!canPattern}
        title="Mirror. Flips a copy of the selection across a selected construction line, or a line or edge you pick."
        onClick={onMirror}
      >
        <FlipHorizontal2 size={13} />
        Mirror
      </button>
      <div class="flex-1" />
      <button
        type="button"
        class={toggleClass(showRulers)}
        aria-pressed={showRulers}
        title={showRulers ? "Hide rulers" : "Show rulers"}
        onClick={onToggleRulers}
      >
        <Ruler size={13} />
        Rulers
      </button>
      <button
        type="button"
        class={toggleClass(showLines)}
        aria-pressed={showLines}
        title={showLines ? "Hide construction lines" : "Show construction lines"}
        onClick={onToggleLines}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true" fill="none">
          <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" stroke-width="1.25" stroke-linecap="square" />
        </svg>
        Construction lines
      </button>
    </div>
  );
}
