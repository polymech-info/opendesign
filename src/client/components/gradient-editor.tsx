import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ArrowLeftRight, GripVertical, Settings } from "lucide-preact";
import type { ComponentChildren } from "preact";
import {
  COLOR_SPACES,
  GRADIENT_KINDS,
  cloneGradient,
  defaultGradient,
  editorStateForObject,
  gradientCssPreview,
  loadGradientLibrary,
  newGradientId,
  parseCssLinear,
  reverseGradientStops,
  saveGradientToLibrary,
  suggestGradientName,
  withGradientRole,
  type GradientDef,
  type GradientKind,
  type GradientRole,
  type GradientStop,
} from "../lib/gradient";
import { GRADIENT_PRESETS } from "../lib/fill-presets";
import { PropSlider } from "./prop-slider";

const PRESET_DEFS = GRADIENT_PRESETS.map((css) => parseCssLinear(css));

type DragKind = "stop" | "origin" | "p0" | "c1" | "c2" | "p1";

export function GradientSwatch({
  def,
  title,
  onPick,
  onEdit,
}: {
  def: GradientDef;
  title?: string;
  onPick: () => void;
  onEdit: () => void;
}) {
  return (
    <div class="relative group aspect-square">
      <button
        type="button"
        class="w-full h-full rounded border border-border-dim cursor-pointer hover:border-accent"
        style={{ background: gradientCssPreview(def) }}
        title={title}
        onClick={onPick}
      />
      <button
        type="button"
        class="absolute top-0.5 right-0.5 w-4 h-4 rounded-sm border border-border-mid bg-surface-card/90 text-fg-muted opacity-0 group-hover:opacity-100 cursor-pointer flex items-center justify-center hover:border-accent hover:text-fg"
        title="Edit gradient"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <Settings size={9} />
      </button>
    </div>
  );
}

export function GradientPalette({
  obj,
  palette,
  defaultRole = "fill",
  onPick,
  onEdit,
}: {
  obj?: import("fabric").FabricObject | null;
  palette: GradientDef[];
  defaultRole?: GradientRole;
  onPick: (def: GradientDef, role: GradientRole) => void;
  onEdit: (state: { def: GradientDef; role: GradientRole }) => void;
}) {
  return (
    <div class="grid grid-cols-7 gap-1">
      {palette.map((g) => (
        <GradientSwatch
          key={g.id}
          def={g}
          title={g.name || undefined}
          onPick={() => onPick(withGradientRole(g, defaultRole), defaultRole)}
          onEdit={() => onEdit(editorStateForObject(obj ?? null, g, defaultRole))}
        />
      ))}
    </div>
  );
}

function defaultDialogPos() {
  if (typeof window === "undefined") return { x: 80, y: 72 };
  return { x: Math.max(16, window.innerWidth - 560 - 360), y: 72 };
}

export function GradientEditorDialog({
  initial,
  role = "fill",
  hasMask = false,
  onPreview,
  onApply,
  onClearMask,
  onCancel,
}: {
  initial: GradientDef;
  role?: GradientRole;
  hasMask?: boolean;
  onPreview?: (def: GradientDef, role: GradientRole) => void;
  onApply: (def: GradientDef, role: GradientRole) => void;
  onClearMask?: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => cloneGradient(initial));
  const [useAs, setUseAs] = useState<GradientRole>(role);
  const [active, setActive] = useState(0);
  const [library, setLibrary] = useState(loadGradientLibrary);
  const [saveName, setSaveName] = useState(() => suggestGradientName(initial));
  const [pos, setPos] = useState(defaultDialogPos);
  useEffect(() => {
    setDraft(cloneGradient(initial));
    setUseAs(role);
    setSaveName(suggestGradientName(initial));
    setActive(0);
  }, [initial, role]);
  const fieldRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind | null>(null);
  const moveRef = useRef<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;

  const stops = draft.stops;
  const selected = stops[Math.min(active, stops.length - 1)] ?? stops[0];
  const preview = useMemo(() => gradientCssPreview(draft), [draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  useEffect(() => {
    const id = requestAnimationFrame(() => previewRef.current?.(cloneGradient(draft), useAs));
    return () => cancelAnimationFrame(id);
  }, [draft, useAs]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const moving = moveRef.current;
      if (moving) {
        const maxX = Math.max(16, window.innerWidth - 80);
        const maxY = Math.max(16, window.innerHeight - 48);
        setPos({
          x: Math.min(maxX, Math.max(8, moving.x + e.clientX - moving.ox)),
          y: Math.min(maxY, Math.max(8, moving.y + e.clientY - moving.oy)),
        });
        return;
      }
      const kind = dragRef.current;
      if (!kind) return;
      if (kind === "stop") {
        const bar = barRef.current;
        if (!bar) return;
        const rect = bar.getBoundingClientRect();
        const offset = clamp01((e.clientX - rect.left) / Math.max(rect.width, 1));
        patchStop(active, { offset });
        return;
      }
      const field = fieldRef.current;
      if (!field) return;
      const rect = field.getBoundingClientRect();
      const next = {
        x: clamp01((e.clientX - rect.left) / Math.max(rect.width, 1)),
        y: clamp01((e.clientY - rect.top) / Math.max(rect.height, 1)),
      };
      if (kind === "origin") setDraft((d) => ({ ...d, origin: next }));
      else setDraft((d) => ({ ...d, curve: { ...d.curve, [kind]: next } }));
    };
    const up = () => {
      dragRef.current = null;
      moveRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [active]);

  const patch = (partial: Partial<GradientDef>) => setDraft((d) => ({ ...d, ...partial }));

  const patchStop = (index: number, partial: Partial<GradientStop>) => {
    setDraft((d) => {
      const next = d.stops.map((s, i) => (i === index ? { ...s, ...partial } : s));
      next.sort((a, b) => a.offset - b.offset);
      return { ...d, stops: next };
    });
  };

  const saveAsNew = () => {
    const list = saveGradientToLibrary(draft, saveName);
    setLibrary(list);
    if (list[0]?.name) setSaveName(list[0].name);
  };

  const addStop = (offset: number) => {
    const hex = selected?.hex ?? "#ffffff";
    const alpha = selected?.alpha ?? 1;
    setDraft((d) => {
      const next = [...d.stops, { offset: clamp01(offset), hex, alpha }];
      next.sort((a, b) => a.offset - b.offset);
      return { ...d, stops: next };
    });
    setActive(stops.length);
  };

  const removeStop = (index: number) => {
    if (stops.length <= 2) return;
    setDraft((d) => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }));
    setActive((n) => Math.max(0, Math.min(n, stops.length - 2)));
  };

  const reverseStops = () => {
    setDraft((d) => reverseGradientStops(d));
    setActive((n) => Math.max(0, stops.length - 1 - n));
  };

  return (
    <div
      class="fixed z-[80] bg-surface-card border border-border-dim rounded-xl shadow-2xl w-[min(560px,calc(100vw-32px))] max-h-[min(90vh,760px)] flex flex-col"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-modal="true"
      aria-label="Gradient"
    >
        <div
          class="px-4 py-3 border-b border-border-dim flex items-center justify-between cursor-grab select-none"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            moveRef.current = { ox: e.clientX, oy: e.clientY, x: pos.x, y: pos.y };
          }}
        >
          <div class="flex items-center gap-1.5 text-fg">
            <GripVertical size={14} class="text-fg-muted" />
            <h2 class="text-sm font-semibold m-0">Gradient</h2>
          </div>
          <div class="flex gap-1">
            {(["fill", "mask"] as GradientRole[]).map((roleId) => (
              <button
                key={roleId}
                type="button"
                class={`px-2 py-1 rounded-md text-[11px] border cursor-pointer ${
                  useAs === roleId
                    ? "border-accent bg-accent/10 text-fg"
                    : "border-border-dim bg-surface-muted text-fg-muted hover:border-accent"
                }`}
                onClick={() => setUseAs(roleId)}
              >
                {roleId === "fill" ? "Fill" : "Mask"}
              </button>
            ))}
          </div>
        </div>

        <div class="px-4 py-3 overflow-y-auto flex flex-col gap-3">
          <div
            ref={fieldRef}
            class="relative w-full aspect-[5/3] rounded-lg border border-border-dim overflow-hidden"
            style={{
              backgroundImage: `${preview}, linear-gradient(45deg,#cbd5e1 25%,transparent 25%), linear-gradient(-45deg,#cbd5e1 25%,transparent 25%), linear-gradient(45deg,transparent 75%,#cbd5e1 75%), linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)`,
              backgroundSize: "auto, 10px 10px, 10px 10px, 10px 10px, 10px 10px",
              backgroundPosition: "0 0, 0 0, 0 5px, 5px -5px, -5px 0",
            }}
          >
            {(draft.kind === "cycle" || draft.kind === "ripple") && (
              <Handle
                x={draft.origin.x}
                y={draft.origin.y}
                label="origin"
                onDown={() => {
                  dragRef.current = "origin";
                }}
              />
            )}
            {draft.kind === "bezier" && (
              <>
                <CurveLines curve={draft.curve} />
                {(["p0", "c1", "c2", "p1"] as const).map((key) => (
                  <Handle
                    key={key}
                    x={draft.curve[key].x}
                    y={draft.curve[key].y}
                    label={key}
                    onDown={() => {
                      dragRef.current = key;
                    }}
                  />
                ))}
              </>
            )}
          </div>

          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="text-[11px] text-fg-muted m-0">Stops</label>
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
                title="Reverse stops"
                onClick={reverseStops}
              >
                <ArrowLeftRight size={11} />
                Reverse
              </button>
            </div>
            <div
              ref={barRef}
              class="relative h-6 rounded-md border border-border-mid cursor-crosshair"
              style={{
                backgroundImage: `${preview.replace(/%/g, "%")}, linear-gradient(45deg,#cbd5e1 25%,transparent 25%), linear-gradient(-45deg,#cbd5e1 25%,transparent 25%)`,
                backgroundSize: "auto, 8px 8px, 8px 8px",
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).dataset.stop != null) return;
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                addStop((e.clientX - rect.left) / Math.max(rect.width, 1));
              }}
            >
              {stops.map((stop, i) => (
                <button
                  key={`${stop.offset}-${i}`}
                  type="button"
                  data-stop={i}
                  class={`absolute top-1/2 -translate-y-1/2 -ml-1.5 w-3 h-5 rounded-sm border cursor-grab ${
                    i === active ? "border-accent ring-2 ring-accent/40 z-10" : "border-black/50"
                  }`}
                  style={{ left: `${stop.offset * 100}%`, background: stopCssSolid(stop) }}
                  title={`${Math.round(stop.offset * 100)}%`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setActive(i);
                    dragRef.current = "stop";
                  }}
                  onDblClick={(e) => {
                    e.stopPropagation();
                    removeStop(i);
                  }}
                />
              ))}
            </div>
            <p class="text-[10px] text-fg-muted mt-1 mb-0">Click the bar to add a stop. Double-click a stop to remove it.</p>
          </div>

          {selected && (
            <div class="grid grid-cols-[auto_1fr_auto] items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent"
                value={selected.hex}
                onInput={(e) => patchStop(active, { hex: (e.target as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="bg-surface-muted border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
                value={selected.hex}
                onInput={(e) => patchStop(active, { hex: (e.target as HTMLInputElement).value })}
              />
              <span class="text-[10px] text-fg-muted">{Math.round(selected.offset * 100)}%</span>
              <div class="col-span-3">
                <PropSlider
                  label="Alpha"
                  value={selected.alpha}
                  min={0}
                  max={1}
                  step={0.01}
                  displayScale={100}
                  suffix="%"
                  onChange={(alpha) => patchStop(active, { alpha })}
                />
              </div>
            </div>
          )}

          <div class="flex flex-wrap gap-1">
            {GRADIENT_KINDS.map((kind) => (
              <Chip
                key={kind.id}
                active={draft.kind === kind.id}
                onClick={() => patch({ kind: kind.id })}
              >
                {kind.label}
              </Chip>
            ))}
          </div>
          <div class="flex flex-wrap gap-1">
            {COLOR_SPACES.map((space) => (
              <Chip
                key={space.id}
                active={draft.space === space.id}
                onClick={() => patch({ space: space.id })}
              >
                {space.label}
              </Chip>
            ))}
          </div>

          {draft.kind === "linear" && (
            <PropSlider
              label="Angle"
              value={draft.angle}
              min={0}
              max={360}
              step={1}
              suffix="°"
              onChange={(angle) => patch({ angle })}
            />
          )}
          {(draft.kind === "cycle" || draft.kind === "ripple") && (
            <PropSlider
              label="Radius"
              value={draft.scale}
              min={0.12}
              max={1.6}
              step={0.02}
              displayScale={100}
              suffix="%"
              onChange={(scale) => patch({ scale })}
            />
          )}
          {draft.kind === "ripple" && (
            <PropSlider
              label="Cycles"
              value={draft.cycles}
              min={1}
              max={8}
              step={0.25}
              onChange={(cycles) => patch({ cycles })}
            />
          )}

          <div>
            <p class="text-[10px] text-fg-muted mb-1 mt-0">Presets</p>
            <div class="grid grid-cols-8 gap-1">
              {PRESET_DEFS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  class="aspect-square rounded border border-border-dim cursor-pointer hover:border-accent"
                  style={{ background: gradientCssPreview({ ...preset, kind: draft.kind, origin: draft.origin, curve: draft.curve, scale: draft.scale, cycles: draft.cycles }) }}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      id: newGradientId(),
                      stops: preset.stops.map((s) => ({ ...s })),
                    }))
                  }
                />
              ))}
            </div>
          </div>

          {library.length > 0 && (
            <div>
              <p class="text-[10px] text-fg-muted mb-1 mt-0">Saved</p>
              <div class="grid grid-cols-4 gap-1.5">
                {library.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    class="rounded border border-border-dim cursor-pointer hover:border-accent p-1 text-left bg-transparent"
                    title={item.name}
                    onClick={() => {
                      const next = cloneGradient(item);
                      setDraft(next);
                      setSaveName(suggestGradientName(next));
                    }}
                  >
                    <span
                      class="block aspect-[5/3] rounded-sm border border-border-dim"
                      style={{ background: gradientCssPreview(item) }}
                    />
                    <span class="block mt-1 text-[10px] text-fg-secondary truncate">{item.name || "Untitled"}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div class="px-4 py-3 border-t border-border-dim flex items-center gap-2">
          {hasMask && useAs === "mask" && (
            <button
              type="button"
              class="px-2 py-1.5 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
              onClick={onClearMask}
            >
              Clear mask
            </button>
          )}
          <input
            type="text"
            class="w-[140px] bg-surface-muted border border-border-mid rounded-md text-[11px] text-fg-secondary px-2 py-1.5 outline-none focus:border-accent"
            placeholder="Name"
            value={saveName}
            onInput={(e) => setSaveName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveAsNew();
              }
            }}
          />
          <button
            type="button"
            class="px-2 py-1.5 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent hover:text-fg whitespace-nowrap"
            onClick={saveAsNew}
          >
            Save as new
          </button>
          <div class="flex-1" />
          <button
            type="button"
            class="px-2 py-1.5 rounded-md text-[11px] border border-border-dim bg-transparent text-fg-muted cursor-pointer hover:border-accent"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[11px] font-medium border border-accent bg-accent/15 text-fg cursor-pointer"
            onClick={() => onApply(cloneGradient({ ...draft, id: newGradientId() }), useAs)}
          >
            Apply
          </button>
        </div>
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
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Handle({
  x,
  y,
  label,
  onDown,
}: {
  x: number;
  y: number;
  label: string;
  onDown: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      class="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-white bg-accent shadow cursor-grab"
      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDown();
      }}
    />
  );
}

function CurveLines({ curve }: { curve: GradientDef["curve"] }) {
  const d = `M ${curve.p0.x * 100} ${curve.p0.y * 100} C ${curve.c1.x * 100} ${curve.c1.y * 100}, ${curve.c2.x * 100} ${curve.c2.y * 100}, ${curve.p1.x * 100} ${curve.p1.y * 100}`;
  return (
    <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path d={`M ${curve.p0.x * 100} ${curve.p0.y * 100} L ${curve.c1.x * 100} ${curve.c1.y * 100}`} stroke="rgba(255,255,255,0.45)" stroke-width="0.6" fill="none" />
      <path d={`M ${curve.p1.x * 100} ${curve.p1.y * 100} L ${curve.c2.x * 100} ${curve.c2.y * 100}`} stroke="rgba(255,255,255,0.45)" stroke-width="0.6" fill="none" />
      <path d={d} stroke="white" stroke-width="1.1" fill="none" />
    </svg>
  );
}

function stopCssSolid(stop: GradientStop) {
  return stop.hex;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function gradientFromCssOrDefault(css?: string, kind?: GradientKind): GradientDef {
  if (css) {
    const parsed = parseCssLinear(css);
    if (kind) parsed.kind = kind;
    return parsed;
  }
  return defaultGradient(kind);
}
