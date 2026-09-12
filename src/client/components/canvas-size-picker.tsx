import { useEffect, useState } from "preact/hooks";
import { ArrowLeftRight } from "lucide-preact";
import {
  CANVAS_SIZE_MAX,
  CANVAS_SIZE_MIN,
  CANVAS_SIZES,
  normalizeCanvasSize,
} from "../lib/canvas-size";

const inputClass =
  "w-full min-w-0 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono";

function CustomSizeFields({
  width,
  height,
  onSelect,
  applyLabel = "Apply",
}: {
  width?: number;
  height?: number;
  onSelect: (width: number, height: number) => void;
  applyLabel?: string;
}) {
  const [w, setW] = useState(width != null ? String(width) : "1920");
  const [h, setH] = useState(height != null ? String(height) : "1080");

  useEffect(() => {
    if (width != null) setW(String(width));
    if (height != null) setH(String(height));
  }, [width, height]);

  const parsed = normalizeCanvasSize(Number(w), Number(h));
  const unchanged = parsed != null && parsed.width === width && parsed.height === height;

  const apply = () => {
    if (!parsed || unchanged) return;
    onSelect(parsed.width, parsed.height);
  };

  const swap = () => {
    const next = normalizeCanvasSize(Number(h), Number(w));
    if (!next) return;
    setW(String(next.width));
    setH(String(next.height));
    onSelect(next.width, next.height);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-1.5">
        <label class="flex-1 min-w-0">
          <span class="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">W</span>
          <input
            type="number"
            min={CANVAS_SIZE_MIN}
            max={CANVAS_SIZE_MAX}
            class={inputClass}
            value={w}
            onInput={(e) => setW((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </label>
        <button
          type="button"
          class="mt-4 p-1.5 rounded-md text-zinc-400 bg-transparent border border-transparent cursor-pointer hover:bg-zinc-100 hover:text-zinc-700"
          title="Swap width and height"
          onClick={swap}
        >
          <ArrowLeftRight size={13} />
        </button>
        <label class="flex-1 min-w-0">
          <span class="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">H</span>
          <input
            type="number"
            min={CANVAS_SIZE_MIN}
            max={CANVAS_SIZE_MAX}
            class={inputClass}
            value={h}
            onInput={(e) => setH((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply();
            }}
          />
        </label>
      </div>
      <button
        type="button"
        class="w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border-none cursor-pointer bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={!parsed || unchanged}
        onClick={apply}
      >
        {applyLabel}
      </button>
    </div>
  );
}

function PresetList({
  width,
  height,
  onSelect,
}: {
  width?: number;
  height?: number;
  onSelect: (width: number, height: number) => void;
}) {
  return (
    <div>
      {CANVAS_SIZES.map((s) => {
        const active = s.width === width && s.height === height;
        return (
          <button
            key={s.label}
            type="button"
            class={`w-full text-left px-3 py-1.5 text-xs cursor-pointer border-none transition-colors ${
              active ? "bg-accent/20 text-accent" : "text-zinc-600 bg-transparent hover:bg-zinc-100"
            }`}
            onClick={() => onSelect(s.width, s.height)}
          >
            <span class="font-medium">{s.label}</span>
            <span class="text-zinc-400 ml-2">
              {s.width} × {s.height}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CanvasSizeMenu({
  width,
  height,
  onSelect,
  customLabel = "Apply size",
}: {
  width?: number;
  height?: number;
  onSelect: (width: number, height: number) => void;
  customLabel?: string;
}) {
  return (
    <div class="min-w-[240px] py-1">
      <p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        Presets
      </p>
      <PresetList width={width} height={height} onSelect={onSelect} />
      <div class="mx-3 my-2 border-t border-zinc-200" />
      <div class="px-3 pb-2">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Custom</p>
        <CustomSizeFields width={width} height={height} onSelect={onSelect} applyLabel={customLabel} />
      </div>
    </div>
  );
}

export function CanvasSizePanel({
  width,
  height,
  onSelect,
}: {
  width: number;
  height: number;
  onSelect: (width: number, height: number) => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <CustomSizeFields width={width} height={height} onSelect={onSelect} applyLabel="Resize canvas" />
      <div>
        <p class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Presets</p>
        <div class="max-h-48 overflow-y-auto -mx-1 rounded-md border border-zinc-200">
          <PresetList width={width} height={height} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}
