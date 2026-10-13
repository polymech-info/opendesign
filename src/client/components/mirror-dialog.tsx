import { useEffect, useRef, useState } from "preact/hooks";
import { GripVertical } from "lucide-preact";
import * as fabric from "fabric";
import { patternRefDir, patternRefLabel, type PatternRef } from "../lib/rect-pattern";

function defaultDialogPos() {
  if (typeof window === "undefined") return { x: 80, y: 72 };
  return { x: Math.max(16, window.innerWidth - 380 - 280), y: 96 };
}

export function MirrorDialog({
  objects,
  initialRef,
  pickBridge,
  onPickSlot,
  onMarkedLines,
  onApply,
  onClose,
}: {
  objects: fabric.FabricObject[];
  initialRef: PatternRef | null;
  pickBridge: { current: (ref: PatternRef) => void };
  onPickSlot: (slot: 0 | null) => void;
  onMarkedLines: (ids: string[]) => void;
  onApply: (ref: PatternRef, preserveOrientation: boolean) => void;
  onClose: () => void;
}) {
  const [ref, setRef] = useState<PatternRef | null>(initialRef);
  const [armed, setArmed] = useState(initialRef == null);
  const [preserveOrientation, setPreserveOrientation] = useState(false);
  const [pos, setPos] = useState(defaultDialogPos);
  const moveRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const armedRef = useRef(armed);
  armedRef.current = armed;

  pickBridge.current = (next) => {
    if (!armedRef.current) return;
    setRef(next);
  };

  const markedKey = ref?.kind === "line" ? ref.id : "";
  const onMarkedRef = useRef(onMarkedLines);
  onMarkedRef.current = onMarkedLines;
  useEffect(() => {
    onMarkedRef.current(markedKey ? [markedKey] : []);
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

  const dir = ref ? patternRefDir(ref) : null;

  return (
    <div
      class="fixed z-[80] bg-surface-card border border-border-dim rounded-xl shadow-2xl w-[min(360px,calc(100vw-32px))] flex flex-col"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-modal="false"
      aria-label="Mirror"
    >
      <div
        class="px-4 py-3 border-b border-border-dim flex items-center gap-1.5 cursor-grab select-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          moveRef.current = { ox: e.clientX, oy: e.clientY, x: pos.x, y: pos.y };
        }}
      >
        <GripVertical size={14} class="text-fg-muted" />
        <h2 class="text-sm font-semibold m-0">Mirror</h2>
      </div>

      <div class="px-4 py-3 flex flex-col gap-3">
        <div class="grid grid-cols-[5.75rem_1fr] items-center gap-2">
          <span class="text-[11px] text-fg-muted">Objects</span>
          <span class="text-[11px] text-fg-secondary">{objects.length} selected</span>
        </div>
        <div class="flex items-center gap-1.5 pt-1 border-t border-border-dim">
          <span class="text-[11px] font-medium text-fg">Axis</span>
          <button
            type="button"
            class={`px-2 py-1 rounded-md text-[11px] border cursor-pointer ${
              armed
                ? "border-accent bg-accent/10 text-fg"
                : "border-border-dim bg-surface-muted text-fg-muted hover:border-accent"
            }`}
            aria-pressed={armed}
            onClick={() => {
              const next = !armed;
              setArmed(next);
              onPickSlot(next ? 0 : null);
            }}
          >
            {ref ? patternRefLabel(ref) : "Pick"}
          </button>
          {ref && (
            <button
              type="button"
              class="px-1.5 py-1 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
              aria-label="Clear mirror axis"
              onClick={() => {
                setRef(null);
                setArmed(true);
                onPickSlot(0);
              }}
            >
              ×
            </button>
          )}
        </div>
        <p class="m-0 text-[10px] text-fg-muted">
          {dir == null
            ? "Pick a construction line or a shape edge."
            : preserveOrientation
              ? dir === "x"
                ? "Copies move left and right across this reference and keep their facing."
                : "Copies move up and down across this reference and keep their facing."
              : dir === "x"
                ? "Copies flip left and right across this reference."
                : "Copies flip up and down across this reference."}
        </p>
        <label class="flex items-center gap-2 text-[11px] text-fg-secondary cursor-pointer">
          <input
            type="checkbox"
            class="accent-accent"
            checked={preserveOrientation}
            onChange={(e) => setPreserveOrientation((e.target as HTMLInputElement).checked)}
          />
          Keep orientation
        </label>
        {armed && <p class="m-0 text-[10px] text-fg-muted">Click a construction line or a shape edge.</p>}
      </div>

      <div class="px-4 py-3 border-t border-border-dim flex items-center gap-2">
        <span class="text-[10px] text-fg-muted">
          {ref ? `${objects.length} ${objects.length === 1 ? "copy" : "copies"}` : "No copies"}
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
          disabled={!ref}
          onClick={() => ref && onApply(ref, preserveOrientation)}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
