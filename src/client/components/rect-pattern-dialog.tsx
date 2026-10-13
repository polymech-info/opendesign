import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { GripVertical } from "lucide-preact";
import * as fabric from "fabric";
import {
  MEASURE_UNITS,
  formatDesignLength,
  parseDesignLength,
  type MeasureUnit,
} from "../lib/canvas-rulers";
import {
  convertPatternDistance,
  PATTERN_MAX_COPIES,
  PATTERN_MAX_COUNT,
  patternOffsets,
  patternRefDir,
  patternRefLabel,
  unionSize,
  type PatternAxis,
  type PatternDir,
  type PatternDistribution,
  type PatternDirection,
  type PatternRef,
} from "../lib/rect-pattern";

type AxisDraft = {
  ref: PatternRef | null;
  quantity: number;
  distancePx: number;
  direction: PatternDirection;
  distanceTouched: boolean;
  quantityTouched: boolean;
};

function emptyAxis(): AxisDraft {
  return {
    ref: null,
    quantity: 1,
    distancePx: 0,
    direction: "one",
    distanceTouched: false,
    quantityTouched: false,
  };
}

function seededAxis(
  ref: PatternRef,
  bounds: { width: number; height: number },
  distribution: PatternDistribution
): AxisDraft {
  const size = patternRefDir(ref) === "x" ? bounds.width : bounds.height;
  const quantity = 3;
  const gaps = Math.max(1, quantity - 1);
  return {
    ref,
    quantity,
    distancePx: distribution === "extent" ? size * gaps : size,
    direction: "one",
    distanceTouched: false,
    quantityTouched: false,
  };
}

function defaultDialogPos() {
  if (typeof window === "undefined") return { x: 80, y: 72 };
  return { x: Math.max(16, window.innerWidth - 380 - 280), y: 96 };
}

function axisModel(axis: AxisDraft, distribution: PatternDistribution): PatternAxis | null {
  if (!axis.ref || axis.quantity < 2) return null;
  return {
    quantity: axis.quantity,
    distancePx: axis.distancePx,
    distribution,
    direction: axis.direction,
  };
}

function resolvedAxes(axes: AxisDraft[], distribution: PatternDistribution) {
  let x: PatternAxis | null = null;
  let y: PatternAxis | null = null;
  for (const axis of axes) {
    if (!axis.ref) continue;
    const model = axisModel(axis, distribution);
    if (!model) continue;
    if (patternRefDir(axis.ref) === "x") x = model;
    else y = model;
  }
  return { x, y };
}

export function RectPatternDialog({
  objects,
  canvasWidth,
  canvasHeight,
  initialUnit,
  initialRef,
  pickBridge,
  onPickSlot,
  onMarkedLines,
  onApply,
  onClose,
}: {
  objects: fabric.FabricObject[];
  canvasWidth: number;
  canvasHeight: number;
  initialUnit: MeasureUnit;
  initialRef: PatternRef | null;
  pickBridge: { current: (ref: PatternRef) => void };
  onPickSlot: (slot: 0 | 1 | null) => void;
  onMarkedLines: (ids: string[]) => void;
  onApply: (offsets: { dx: number; dy: number }[]) => void;
  onClose: () => void;
}) {
  const bounds = unionSize(objects);
  const [axes, setAxes] = useState<[AxisDraft, AxisDraft]>(() => [
    initialRef ? seededAxis(initialRef, bounds, "spacing") : emptyAxis(),
    emptyAxis(),
  ]);
  const [distribution, setDistribution] = useState<PatternDistribution>("spacing");
  const [unit, setUnit] = useState<MeasureUnit>(initialUnit);
  const [pickSlot, setPickSlot] = useState<0 | 1 | null>(initialRef ? 1 : 0);
  const [pos, setPos] = useState(defaultDialogPos);
  const moveRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const pickSlotRef = useRef(pickSlot);
  const distributionRef = useRef(distribution);
  pickSlotRef.current = pickSlot;
  distributionRef.current = distribution;

  pickBridge.current = (ref) => {
    const slot = pickSlotRef.current;
    if (slot == null) return;
    const seeded = seededAxis(ref, bounds, distributionRef.current);
    setAxes((prev) => {
      const next = prev.map((axis, index) => {
        if (index !== slot) return axis;
        if (!axis.quantityTouched && !axis.distanceTouched) return { ...seeded, direction: axis.direction };
        const quantity = axis.quantityTouched ? axis.quantity : seeded.quantity;
        const gaps = Math.max(1, quantity - 1);
        const size = patternRefDir(ref) === "x" ? bounds.width : bounds.height;
        const distancePx = axis.distanceTouched
          ? axis.distancePx
          : distributionRef.current === "extent"
            ? size * gaps
            : size;
        return { ...axis, ref, quantity, distancePx };
      }) as [AxisDraft, AxisDraft];
      return next;
    });
  };

  const markedKey = axes.map((axis) => (axis.ref?.kind === "line" ? axis.ref.id : "")).join("|");
  const onMarkedRef = useRef(onMarkedLines);
  onMarkedRef.current = onMarkedLines;
  useEffect(() => {
    onMarkedRef.current(markedKey ? markedKey.split("|").filter(Boolean) : []);
  }, [markedKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const moving = moveRef.current;
      if (!moving) return;
      const maxX = Math.max(16, window.innerWidth - 80);
      const maxY = Math.max(16, window.innerHeight - 48);
      setPos({
        x: Math.min(maxX, Math.max(8, moving.x + e.clientX - moving.ox)),
        y: Math.min(maxY, Math.max(8, moving.y + e.clientY - moving.oy)),
      });
    };
    const up = () => {
      moveRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const sameDir =
    axes[0].ref != null &&
    axes[1].ref != null &&
    axes[0].quantity >= 2 &&
    axes[1].quantity >= 2 &&
    patternRefDir(axes[0].ref) === patternRefDir(axes[1].ref);
  const resolved = resolvedAxes(axes, distribution);
  const copyCount = patternOffsets(resolved.x, resolved.y).length;

  const setDistributionMode = (next: PatternDistribution) => {
    if (next === distribution) return;
    setAxes(
      (prev) =>
        prev.map((axis) => ({
          ...axis,
          distancePx: convertPatternDistance(axis.distancePx, distribution, next, axis.quantity),
        })) as [AxisDraft, AxisDraft]
    );
    setDistribution(next);
  };

  const patchAxis = (index: 0 | 1, partial: Partial<AxisDraft>) => {
    setAxes((prev) => prev.map((axis, i) => (i === index ? { ...axis, ...partial } : axis)) as [AxisDraft, AxisDraft]);
  };

  return (
    <div
      class="fixed z-[80] bg-surface-card border border-border-dim rounded-xl shadow-2xl w-[min(360px,calc(100vw-32px))] max-h-[min(90vh,720px)] flex flex-col"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-modal="false"
      aria-label="Rectangular pattern"
    >
      <div
        class="px-4 py-3 border-b border-border-dim flex items-center gap-1.5 cursor-grab select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          moveRef.current = { ox: e.clientX, oy: e.clientY, x: pos.x, y: pos.y };
        }}
      >
        <GripVertical size={14} class="text-fg-muted" />
        <h2 class="text-sm font-semibold m-0">Rectangular pattern</h2>
      </div>

      <div class="px-4 py-3 overflow-y-auto flex flex-col gap-3">
        <Row label="Objects">
          <span class="text-[11px] text-fg-secondary">
            {objects.length} selected
          </span>
        </Row>

        <Row label="Distribution">
          <div class="inline-flex gap-1" role="group" aria-label="Distribution">
            <Chip active={distribution === "extent"} onClick={() => setDistributionMode("extent")}>
              Extent
            </Chip>
            <Chip active={distribution === "spacing"} onClick={() => setDistributionMode("spacing")}>
              Spacing
            </Chip>
          </div>
        </Row>

        <Row label="Unit">
          <div class="inline-flex overflow-hidden rounded-md border border-border-dim divide-x divide-border-dim" role="group" aria-label="Distance unit">
            {MEASURE_UNITS.map((item) => (
              <button
                key={item}
                type="button"
                class={`px-1.5 py-1 text-[11px] font-medium cursor-pointer ${
                  unit === item ? "bg-accent/10 text-accent" : "bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg"
                }`}
                aria-pressed={unit === item}
                onClick={() => setUnit(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </Row>

        {([0, 1] as const).map((index) => {
          const axis = axes[index];
          const dir: PatternDir | null = axis.ref ? patternRefDir(axis.ref) : null;
          const span = dir === "y" ? canvasHeight : canvasWidth;
          return (
            <section key={index} class="flex flex-col gap-2 pt-1 border-t border-border-dim">
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] font-medium text-fg">Axis {index + 1}</span>
                <button
                  type="button"
                  class={`px-2 py-1 rounded-md text-[11px] border cursor-pointer ${
                    pickSlot === index
                      ? "border-accent bg-accent/10 text-fg"
                      : "border-border-dim bg-surface-muted text-fg-muted hover:border-accent"
                  }`}
                  aria-pressed={pickSlot === index}
                  onClick={() => {
                    const next = pickSlot === index ? null : index;
                    setPickSlot(next);
                    onPickSlot(next);
                  }}
                >
                  {axis.ref ? patternRefLabel(axis.ref) : "Pick"}
                </button>
                {axis.ref && (
                  <button
                    type="button"
                    class="px-1.5 py-1 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
                    aria-label={`Clear axis ${index + 1}`}
                    onClick={() => patchAxis(index, emptyAxis())}
                  >
                    ×
                  </button>
                )}
              </div>
              <p class="m-0 text-[10px] text-fg-muted">
                {dir == null
                  ? "Pick a construction line or a shape edge."
                  : dir === "x"
                    ? "Copies move horizontally, across this reference."
                    : "Copies move vertically, across this reference."}
              </p>
              <Row label="Quantity">
                <CommitField
                  text={String(axis.quantity)}
                  disabled={!axis.ref}
                  parse={(raw) => {
                    const n = Number(raw.trim());
                    if (!Number.isInteger(n) || n < 1) return null;
                    return Math.min(PATTERN_MAX_COUNT, n);
                  }}
                  format={(n) => String(n)}
                  onCommit={(quantity) => patchAxis(index, { quantity, quantityTouched: true })}
                />
              </Row>
              <Row label="Distance">
                <CommitField
                  text={formatDesignLength(axis.distancePx, unit, span)}
                  suffix={unit}
                  title={
                    unit === "%"
                      ? dir === "y"
                        ? "Percent of the canvas height. Applies when the field loses focus."
                        : "Percent of the canvas width. Applies when the field loses focus."
                      : "Applies when the field loses focus."
                  }
                  disabled={!axis.ref}
                  parse={(raw) => parseDesignLength(raw, unit, span)}
                  format={(px) => formatDesignLength(px, unit, span)}
                  onCommit={(distancePx) => patchAxis(index, { distancePx, distanceTouched: true })}
                />
              </Row>
              <Row label="Direction">
                <div class="inline-flex gap-1" role="group" aria-label={`Axis ${index + 1} direction`}>
                  <Chip
                    active={axis.direction === "one"}
                    onClick={() => patchAxis(index, { direction: "one" })}
                  >
                    One direction
                  </Chip>
                  <Chip
                    active={axis.direction === "symmetric"}
                    onClick={() => patchAxis(index, { direction: "symmetric" })}
                  >
                    Symmetric
                  </Chip>
                </div>
              </Row>
            </section>
          );
        })}

        {pickSlot != null && (
          <p class="m-0 text-[10px] text-fg-muted">Click a construction line or a shape edge.</p>
        )}
        {sameDir && (
          <p class="m-0 text-[10px] text-fg-muted">Both axes run the same way, so the latest one is used.</p>
        )}
        <p class="m-0 text-[10px] text-fg-muted">
          {distribution === "spacing"
            ? "Spacing is the distance between copies."
            : "Extent is the distance from the first copy to the last."}{" "}
          Distance applies when the field loses focus. A minus sign flips one direction.
        </p>
      </div>

      <div class="px-4 py-3 border-t border-border-dim flex items-center gap-2">
        <span class="text-[10px] text-fg-muted">
          {copyCount === 0 ? "No copies" : copyCount > PATTERN_MAX_COPIES ? "Too many copies" : `${copyCount} copies`}
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="px-2 py-1.5 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-[11px] font-medium border border-accent bg-accent/15 text-fg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={copyCount === 0 || copyCount > PATTERN_MAX_COPIES}
          onClick={() => onApply(patternOffsets(resolved.x, resolved.y))}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="grid grid-cols-[5.75rem_1fr] items-center gap-2">
      <span class="text-[11px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={`px-2 py-1 rounded-md text-[11px] border cursor-pointer ${
        active
          ? "border-accent bg-accent/10 text-fg"
          : "border-border-dim bg-surface-muted text-fg-muted hover:border-accent"
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CommitField<T>({
  text,
  suffix,
  title,
  disabled,
  parse,
  format,
  onCommit,
}: {
  text: string;
  suffix?: string;
  title?: string;
  disabled?: boolean;
  parse: (raw: string) => T | null;
  format: (value: T) => string;
  onCommit: (value: T) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(text);
  }, [text, focused]);
  return (
    <label class={`flex items-center gap-1 ${disabled ? "opacity-40" : ""}`}>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        class="w-full min-w-0 bg-surface-muted border border-border-mid rounded-md text-[11px] text-fg-secondary px-2 py-1.5 outline-none focus:border-accent disabled:cursor-not-allowed"
        title={title}
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const next = parse(draft);
          if (next == null) {
            setDraft(text);
            return;
          }
          onCommit(next);
          setDraft(format(next));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      {suffix && <span class="text-[10px] text-fg-muted shrink-0">{suffix}</span>}
    </label>
  );
}
