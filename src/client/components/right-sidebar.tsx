import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  FlipHorizontal,
  FlipVertical,
  Trash2,
  Copy,
  ClipboardPaste,
  ClipboardCopy,
  Lock,
} from "lucide-preact";
import * as fabric from "fabric";
import { useEditor } from "../context";
import { readImageCornerRadius, readCornerRadius } from "../lib/image-radius";
import { readStylePreset, readGlassOptions, STYLE_PRESETS } from "../lib/style-presets";
import type { GlassOptions } from "../lib/style-presets";
import { isIconObject, readIconFill, readIconStroke, readIconStrokeWidth, iconPreviewUrl } from "../lib/tabler-icons";
import { selectedCanvasObjects } from "../lib/object-style";
import { isElementGroup, isInsideElementGroup, elementDisplayName } from "../lib/element-group";
import { isBgImage } from "../lib/background-image";
import { readElementSource, readObjectId } from "../lib/object-identity";
import { FILL_COLORS, GRADIENT_PRESETS, OPACITY_PRESETS, PATTERN_PRESETS, gradientFillForObject, patternFillFromSvg } from "../lib/fill-presets";
import { IconsPanel } from "./icons-panel";
import { MediaLibrary } from "./media-library";

const FONT_FAMILIES = [
  "Inter",
  "Playfair Display",
  "Montserrat",
  "Poppins",
  "Roboto",
  "Open Sans",
  "Lora",
  "Raleway",
  "Source Sans Pro",
  "Merriweather",
];

const SHADOW_PRESETS = [
  { id: "none", label: "None", blur: 0, offsetX: 0, offsetY: 0, opacity: 0 },
  { id: "soft", label: "Soft", blur: 32, offsetX: 0, offsetY: 12, opacity: 0.22 },
  { id: "medium", label: "Medium", blur: 24, offsetX: 0, offsetY: 16, opacity: 0.32 },
  { id: "hard", label: "Hard", blur: 8, offsetX: 0, offsetY: 6, opacity: 0.4 },
] as const;

function hexToRgba(hex: string, opacity: number) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const n = parseInt(full.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function parseCssColor(color: string | undefined): { hex: string; opacity: number } {
  if (!color) return { hex: "#0f172a", opacity: 0.25 };
  if (color.startsWith("#")) return { hex: color.slice(0, 7), opacity: 1 };
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return { hex: "#0f172a", opacity: 0.25 };
  const hex =
    "#" +
    [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("");
  return { hex, opacity: m[4] !== undefined ? Number(m[4]) : 1 };
}

function readShadow(obj: fabric.FabricObject) {
  const raw = obj.shadow;
  const shadow = !raw ? null : typeof raw === "string" ? new fabric.Shadow(raw) : raw;
  const parsed = parseCssColor(shadow?.color);
  return {
    enabled: !!shadow && ((shadow.blur ?? 0) > 0 || shadow.offsetX !== 0 || shadow.offsetY !== 0),
    color: parsed.hex,
    opacity: parsed.opacity,
    blur: shadow?.blur ?? 24,
    offsetX: shadow?.offsetX ?? 0,
    offsetY: shadow?.offsetY ?? 12,
  };
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pretty = step < 1 ? value.toFixed(2) : String(Math.round(value));
  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
        {label}
        <span class="font-mono text-zinc-400">
          {pretty}
          {suffix ?? ""}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        class="w-full accent-accent"
        value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

function GlassOptionsFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const opts = readGlassOptions(obj);
  const isImage = obj instanceof fabric.FabricImage;
  const patch = (partial: Partial<GlassOptions>) => onChange({ _glassOptions: partial });

  return (
    <div class="flex flex-col gap-3 pt-2">
      {!isImage && (
        <>
          <SliderField
            label="Frost"
            value={opts.blur}
            min={0}
            max={40}
            step={1}
            suffix="px"
            onChange={(blur) => patch({ blur })}
          />
          <div>
            <label class="text-[11px] text-zinc-400 mb-1 block">Tint</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                value={opts.tint}
                onInput={(e) => patch({ tint: (e.target as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none font-mono"
                value={opts.tint}
                onInput={(e) => patch({ tint: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <SliderField
            label="Tint opacity"
            value={opts.tintOpacity}
            min={0}
            max={0.8}
            step={0.01}
            onChange={(tintOpacity) => patch({ tintOpacity })}
          />
          <SliderField
            label="Sheen"
            value={opts.sheen}
            min={0}
            max={2}
            step={0.05}
            onChange={(sheen) => patch({ sheen })}
          />
        </>
      )}
      <SliderField
        label="Rim"
        value={opts.rim}
        min={0}
        max={4}
        step={0.05}
        suffix="px"
        onChange={(rim) => patch({ rim })}
      />
      <SliderField
        label="Bloom"
        value={opts.bloom}
        min={0}
        max={28}
        step={1}
        suffix="px"
        onChange={(bloom) => patch({ bloom })}
      />
      <SliderField
        label="Bloom opacity"
        value={opts.bloomOpacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(bloomOpacity) => patch({ bloomOpacity })}
      />
      <SliderField
        label="Flares"
        value={opts.flares}
        min={0}
        max={2}
        step={0.05}
        onChange={(flares) => patch({ flares })}
      />
    </div>
  );
}

function StylePresetFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const current = readStylePreset(obj);
  return (
    <div>
      <label class="text-[11px] text-zinc-400 mb-1.5 block">Style preset</label>
      <div class="grid grid-cols-2 gap-1.5">
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.id}
            class={`relative overflow-hidden rounded-lg border cursor-pointer px-2 py-2 text-left transition-all ${
              current === p.id
                ? "border-accent bg-accent/10"
                : "border-zinc-200 bg-white hover:border-zinc-400"
            }`}
            onClick={() => onChange({ _stylePreset: p.id })}
          >
            {p.id === "glass" ? (
              <span
                class="block h-7 rounded-md mb-1.5"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(160,200,255,0.12))",
                  boxShadow:
                    "inset 0 0 0 1px rgba(180,230,255,0.8), 0 0 10px rgba(80,180,255,0.45), -4px 6px 12px rgba(255,120,70,0.25)",
                }}
              />
            ) : (
              <span class="block h-7 rounded-md mb-1.5 bg-zinc-100 border border-zinc-200" />
            )}
            <span class={`text-[11px] font-medium ${current === p.id ? "text-accent" : "text-zinc-600"}`}>
              {p.label}
            </span>
          </button>
        ))}
      </div>
      {current === "glass" && <GlassOptionsFields obj={obj} onChange={onChange} />}
    </div>
  );
}

function ShadowFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const current = readShadow(obj);

  const apply = (next: Partial<typeof current> & { enabled?: boolean }) => {
    const merged = { ...current, ...next };
    if (merged.enabled === false || (merged.blur <= 0 && merged.offsetX === 0 && merged.offsetY === 0 && next.enabled !== true)) {
      onChange({ shadow: null });
      return;
    }
    onChange({
      shadow: new fabric.Shadow({
        color: hexToRgba(merged.color, merged.opacity),
        blur: merged.blur,
        offsetX: merged.offsetX,
        offsetY: merged.offsetY,
        affectStroke: false,
      }),
    });
  };

  return (
    <div class="flex flex-col gap-3 pt-1 border-t border-zinc-200">
      <div class="flex items-center justify-between">
        <label class="text-[11px] text-zinc-400">Shadow</label>
        <button
          class={`text-[10px] font-semibold border-none cursor-pointer rounded px-2 py-0.5 ${
            current.enabled ? "bg-accent/15 text-accent" : "bg-zinc-100 text-zinc-400"
          }`}
          onClick={() => apply(current.enabled ? { enabled: false } : { enabled: true, blur: 24, offsetY: 12, opacity: 0.25 })}
        >
          {current.enabled ? "On" : "Off"}
        </button>
      </div>
      <div class="flex gap-1">
        {SHADOW_PRESETS.map((p) => (
          <button
            key={p.id}
            class="flex-1 py-1 rounded-md border text-[10px] cursor-pointer bg-transparent text-zinc-500 hover:text-zinc-800 hover:border-zinc-400"
            onClick={() =>
              apply(
                p.id === "none"
                  ? { enabled: false }
                  : { enabled: true, blur: p.blur, offsetX: p.offsetX, offsetY: p.offsetY, opacity: p.opacity, color: "#0f172a" }
              )
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      {current.enabled && (
        <>
          <div>
            <label class="text-[11px] text-zinc-400 mb-1 block">Color</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                value={current.color}
                onInput={(e) => apply({ color: (e.target as HTMLInputElement).value, enabled: true })}
              />
              <input
                type="text"
                class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none font-mono"
                value={current.color}
                onInput={(e) => apply({ color: (e.target as HTMLInputElement).value, enabled: true })}
              />
            </div>
          </div>
          <div>
            <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
              Opacity
              <span class="font-mono text-zinc-400">{Math.round(current.opacity * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              class="w-full accent-accent"
              value={current.opacity}
              onInput={(e) => apply({ opacity: parseFloat((e.target as HTMLInputElement).value), enabled: true })}
            />
          </div>
          <div>
            <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
              Blur
              <span class="font-mono text-zinc-400">{Math.round(current.blur)}px</span>
            </label>
            <input
              type="range"
              min="0"
              max="80"
              class="w-full accent-accent"
              value={current.blur}
              onInput={(e) => apply({ blur: parseInt((e.target as HTMLInputElement).value, 10), enabled: true })}
            />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                X
                <span class="font-mono text-zinc-400">{Math.round(current.offsetX)}</span>
              </label>
              <input
                type="range"
                min="-40"
                max="40"
                class="w-full accent-accent"
                value={current.offsetX}
                onInput={(e) => apply({ offsetX: parseInt((e.target as HTMLInputElement).value, 10), enabled: true })}
              />
            </div>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Y
                <span class="font-mono text-zinc-400">{Math.round(current.offsetY)}</span>
              </label>
              <input
                type="range"
                min="-40"
                max="40"
                class="w-full accent-accent"
                value={current.offsetY}
                onInput={(e) => apply({ offsetY: parseInt((e.target as HTMLInputElement).value, 10), enabled: true })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function RightSidebar() {
  const {
    selectedObject,
    selectionEpoch,
    updateSelectedObject,
    duplicateSelected,
    copySelectedStyle,
    pasteSelectedStyle,
    hasCopiedStyle,
    deleteSelected,
    groupSelected,
    ungroupSelected,
    saveSelectionAsElement,
    canvas,
    setBackground,
    canvasWidth,
    canvasHeight,
    addImageFromClipboard,
    lockSelectedAsBackground,
    replaceSelectedIcon,
    replaceSelectedImage,
  } =
    useEditor();
  void selectionEpoch;

  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isBg = isBgImage(selectedObject);
  const isImage = selectedObject instanceof fabric.FabricImage && !isBg;
  const isIcon = isIconObject(selectedObject);
  const isGroup = isElementGroup(selectedObject);
  const isInner = isInsideElementGroup(selectedObject);
  const isShape = selectedObject && !isText && !isImage && !isGroup && !isBg;
  const isGlass = selectedObject ? readStylePreset(selectedObject) === "glass" : false;
  const selectedCount = selectedCanvasObjects(canvas, selectedObject).length;
  const canGroup = selectedCount >= 2;
  const canUngroup = isElementGroup(canvas?.getActiveObject() ?? null);

  if (!selectedObject || isBg) {
    return (
      <aside class="w-[280px] bg-white border-l border-zinc-200 flex flex-col shrink-0">
        <div class="p-4 border-b border-zinc-200">
          <h2 class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Canvas</h2>
        </div>
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-zinc-400">Dimensions</span>
            <span class="text-[11px] text-zinc-600 font-mono">{canvasWidth} x {canvasHeight}</span>
          </div>
          <label class="text-[11px] text-zinc-400">Background color</label>
          <input
            type="color"
            class="w-full h-8 rounded-md border border-zinc-300 cursor-pointer bg-transparent"
            onChange={(e) => setBackground("color", (e.target as HTMLInputElement).value)}
          />
          <button
            class="mt-1 w-full flex items-center justify-center gap-2 p-2.5 rounded-lg bg-white border border-zinc-200 cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
            onClick={() => void addImageFromClipboard()}
            title="Paste image from clipboard (Ctrl+V)"
          >
            <ClipboardPaste size={14} class="text-zinc-400" />
            <span class="text-[11px] text-zinc-600">Paste image from clipboard</span>
          </button>
          <p class="text-[10px] text-zinc-400 m-0">Auto-resized to the canvas and saved under uploads/</p>
        </div>
      </aside>
    );
  }

  return (
    <aside class="w-[280px] bg-white border-l border-zinc-200 flex flex-col shrink-0 overflow-y-auto">
      {/* Header */}
      <div class="p-4 border-b border-zinc-200 flex items-center justify-between">
        <h2
          class={`text-xs font-semibold text-zinc-400 tracking-wider ${
            isGroup && (selectedObject as { _elementName?: string })._elementName ? "normal-case" : "uppercase"
          }`}
        >
          {selectedCount > 1
            ? `${selectedCount} selected`
            : isInner
              ? `${isText ? "Text" : isImage ? "Image" : isIcon ? "Icon" : "Shape"} · in group`
              : isGroup
                ? elementDisplayName(selectedObject)
                : isText
                  ? "Text"
                  : isImage
                    ? "Image"
                    : isIcon
                      ? "Icon"
                      : "Shape"}
        </h2>
        <div class="flex gap-1">
          <button
            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-zinc-800 hover:bg-zinc-100 transition-all"
            onClick={() => void duplicateSelected()}
            title={selectedCount > 1 ? "Duplicate selected" : "Duplicate"}
          >
            <Copy size={14} />
          </button>
          <button
            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-zinc-800 hover:bg-zinc-100 transition-all"
            onClick={copySelectedStyle}
            title={selectedCount > 1 ? "Copy style from first selected" : "Copy style"}
          >
            <ClipboardCopy size={14} />
          </button>
          <button
            class={`p-1 rounded bg-transparent border-none cursor-pointer transition-all ${
              hasCopiedStyle
                ? "text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                : "text-zinc-300 cursor-not-allowed"
            }`}
            onClick={pasteSelectedStyle}
            disabled={!hasCopiedStyle}
            title={
              !hasCopiedStyle
                ? "Paste style"
                : selectedCount > 1
                  ? "Paste style onto selected"
                  : "Paste style"
            }
          >
            <ClipboardPaste size={14} />
          </button>
          <button
            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-red-400 hover:bg-red-500/10 transition-all"
            onClick={deleteSelected}
            title={selectedCount > 1 ? "Delete selected" : "Delete"}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div class="p-4 flex flex-col gap-4">
        {(canGroup || canUngroup || selectedObject) && (
          <div class="flex flex-col gap-2">
            <div class="flex gap-1">
              <button
                class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-zinc-200 bg-white cursor-pointer hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!canGroup}
                onClick={groupSelected}
                title="Group selected (Ctrl+G)"
              >
                Group
              </button>
              <button
                class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-zinc-200 bg-white cursor-pointer hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!canUngroup}
                onClick={ungroupSelected}
                title="Ungroup (Ctrl+Shift+G)"
              >
                Ungroup
              </button>
              <button
                class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-zinc-200 bg-white cursor-pointer hover:border-accent"
                onClick={() => void saveSelectionAsElement()}
                title="Save to Elements library"
              >
                As Element
              </button>
            </div>
            {isGroup && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 block">Name</label>
                <input
                  type="text"
                  class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
                  placeholder="Group"
                  value={(selectedObject as { _elementName?: string })._elementName ?? ""}
                  onInput={(e) =>
                    updateSelectedObject({ _elementName: (e.target as HTMLInputElement).value })
                  }
                />
              </div>
            )}
            {selectedCount === 1 && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 block">Id</label>
                <input
                  key={(selectedObject as { _layerId?: string })._layerId || "id"}
                  type="text"
                  class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
                  placeholder="rect_1"
                  defaultValue={readObjectId(selectedObject)}
                  onBlur={(e) =>
                    updateSelectedObject({ _id: (e.target as HTMLInputElement).value })
                  }
                />
                {readElementSource(selectedObject) ? (
                  <p class="text-[10px] text-zinc-400 mt-1 mb-0">From element library</p>
                ) : null}
              </div>
            )}
            {isGroup && (
              <p class="text-[10px] text-zinc-400 m-0">Ctrl+click a part to edit it. Drag the group to move everything.</p>
            )}
            {isInner && (
              <p class="text-[10px] text-zinc-400 m-0">Editing inside the group. Click the group to go back.</p>
            )}
          </div>
        )}

        {/* ── Text properties ───────────────────────────────────────── */}
        {isText && (
          <>
            {/* Font family */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Font family</label>
              <select
                class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none cursor-pointer focus:border-accent"
                value={(selectedObject as any).fontFamily || "Inter"}
                onChange={(e) =>
                  updateSelectedObject({ fontFamily: (e.target as HTMLSelectElement).value })
                }
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Font size */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Font size</label>
              <input
                type="number"
                class="w-full bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
                value={(selectedObject as any).fontSize || 18}
                onInput={(e) =>
                  updateSelectedObject({
                    fontSize: parseInt((e.target as HTMLInputElement).value) || 18,
                  })
                }
              />
            </div>

            {/* Bold / Italic / Underline */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Style</label>
              <div class="flex gap-1">
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontWeight:
                        (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                          ? "400"
                          : "700",
                    })
                  }
                >
                  <Bold size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontStyle === "italic"
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontStyle: (selectedObject as any).fontStyle === "italic" ? "normal" : "italic",
                    })
                  }
                >
                  <Italic size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).underline
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() =>
                    updateSelectedObject({ underline: !(selectedObject as any).underline })
                  }
                >
                  <Underline size={14} />
                </button>
              </div>
            </div>

            {/* Text alignment */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Alignment</label>
              <div class="flex gap-1">
                {[
                  { align: "left", icon: AlignLeft },
                  { align: "center", icon: AlignCenter },
                  { align: "right", icon: AlignRight },
                ].map(({ align, icon: Icon }) => (
                  <button
                    key={align}
                    class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                      (selectedObject as any).textAlign === align
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                    }`}
                    onClick={() => updateSelectedObject({ textAlign: align })}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>

            {/* Text color */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                  value={((selectedObject as any).fill as string) || "#ffffff"}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="text"
                  class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
                  value={((selectedObject as any).fill as string) || "#ffffff"}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
              </div>
            </div>

            {/* Line height */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Line height
                <span class="text-zinc-400 font-mono">{((selectedObject as any).lineHeight || 1.2).toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="0.8"
                max="3"
                step="0.1"
                class="w-full accent-accent"
                value={(selectedObject as any).lineHeight || 1.2}
                onInput={(e) =>
                  updateSelectedObject({
                    lineHeight: parseFloat((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>

            {/* Letter spacing */}
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Letter spacing
                <span class="text-zinc-400 font-mono">{(selectedObject as any).charSpacing || 0}</span>
              </label>
              <input
                type="range"
                min="-200"
                max="800"
                step="10"
                class="w-full accent-accent"
                value={(selectedObject as any).charSpacing || 0}
                onInput={(e) =>
                  updateSelectedObject({
                    charSpacing: parseInt((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>
          </>
        )}

        {/* ── Shape properties ──────────────────────────────────────── */}
        {isShape && (
          <>
            {isIcon && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 block">Icon</label>
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="w-8 h-8 rounded-md border border-zinc-200 shrink-0"
                    style={{
                      WebkitMaskImage: `url(${iconPreviewUrl(selectedObject)})`,
                      WebkitMaskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      WebkitMaskSize: "18px",
                      maskImage: `url(${iconPreviewUrl(selectedObject)})`,
                      maskRepeat: "no-repeat",
                      maskPosition: "center",
                      maskSize: "18px",
                      backgroundColor: readIconFill(selectedObject),
                    }}
                  />
                  <span class="text-xs text-zinc-600 truncate">
                    {((selectedObject as { _iconName?: string })._iconName || "icon").replace(/-/g, " ")}
                  </span>
                </div>
                <div class="max-h-[240px] overflow-y-auto border border-zinc-200 rounded-md p-1.5">
                  <IconsPanel
                    compact
                    current={(selectedObject as { _iconName?: string })._iconName}
                    onPick={(pick) => void replaceSelectedIcon(pick)}
                  />
                </div>
              </div>
            )}
            <StylePresetFields obj={selectedObject} onChange={updateSelectedObject} />
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-white border border-zinc-200 cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={() => void addImageFromClipboard()}
              title="Paste image from clipboard (Ctrl+V)"
            >
              <ClipboardPaste size={14} class="text-zinc-400" />
              <span class="text-[11px] text-zinc-600">Paste image from clipboard</span>
            </button>
            {!isGlass && (
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Fill color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                  value={isIcon ? readIconFill(selectedObject) : ((typeof selectedObject.fill === "string" && selectedObject.fill) || "#6366f1")}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="text"
                  class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
                  value={isIcon ? readIconFill(selectedObject) : ((typeof selectedObject.fill === "string" && selectedObject.fill) || "#6366f1")}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
              </div>
              <div class="grid grid-cols-6 gap-1 mt-2">
                {FILL_COLORS.map((c) => (
                  <button
                    key={c}
                    class="aspect-square rounded border border-zinc-200 cursor-pointer hover:border-accent"
                    style={{ background: c }}
                    onClick={() => updateSelectedObject({ fill: c })}
                  />
                ))}
              </div>
              {!isIcon && (
                <>
                  <p class="text-[10px] text-zinc-400 mt-3 mb-1 m-0">Gradients</p>
                  <div class="grid grid-cols-7 gap-1">
                    {GRADIENT_PRESETS.map((g) => (
                      <button
                        key={g}
                        class="aspect-square rounded border border-zinc-200 cursor-pointer hover:border-accent"
                        style={{ background: g }}
                        onClick={() =>
                          updateSelectedObject({ fill: gradientFillForObject(selectedObject, g) })
                        }
                      />
                    ))}
                  </div>
                  <p class="text-[10px] text-zinc-400 mt-3 mb-1 m-0">Textures</p>
                  <div class="grid grid-cols-6 gap-1">
                    {PATTERN_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        class="aspect-square rounded border border-zinc-200 cursor-pointer hover:border-accent bg-cover"
                        style={{ backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(p.svg)}")` }}
                        title={p.label}
                        onClick={() => {
                          void patternFillFromSvg(p.svg).then((fill) => updateSelectedObject({ fill }));
                        }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            )}

            {isIcon ? (
              <>
                <div>
                  <label class="text-[11px] text-zinc-400 mb-1 block">Outline color</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                      value={readIconStroke(selectedObject)}
                      onInput={(e) => {
                        const stroke = (e.target as HTMLInputElement).value;
                        const width = Math.max(readIconStrokeWidth(selectedObject), 2);
                        updateSelectedObject({ stroke, strokeWidth: width });
                      }}
                    />
                    <input
                      type="text"
                      class="flex-1 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent font-mono"
                      value={readIconStroke(selectedObject)}
                      onInput={(e) => {
                        const stroke = (e.target as HTMLInputElement).value;
                        const width = Math.max(readIconStrokeWidth(selectedObject), 2);
                        updateSelectedObject({ stroke, strokeWidth: width });
                      }}
                    />
                  </div>
                </div>
                <SliderField
                  label="Outline thickness"
                  value={readIconStrokeWidth(selectedObject)}
                  min={0}
                  max={12}
                  step={0.25}
                  suffix="px"
                  onChange={(strokeWidth) =>
                    updateSelectedObject({
                      stroke: strokeWidth > 0 ? readIconStroke(selectedObject) : "",
                      strokeWidth,
                    })
                  }
                />
              </>
            ) : (
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Stroke color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-zinc-300 cursor-pointer bg-transparent shrink-0"
                  value={(selectedObject.stroke as string) || "#000000"}
                  onInput={(e) =>
                    updateSelectedObject({ stroke: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="number"
                  class="w-16 bg-white border border-zinc-300 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
                  value={selectedObject.strokeWidth || 0}
                  min={0}
                  placeholder="Width"
                  onInput={(e) =>
                    updateSelectedObject({
                      strokeWidth: parseInt((e.target as HTMLInputElement).value) || 0,
                    })
                  }
                />
              </div>
            </div>
            )}

            {/* Border radius (for rect) */}
            {selectedObject instanceof fabric.Rect && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                  Corner radius
                  <span class="text-zinc-400 font-mono">{Math.round(readCornerRadius(selectedObject))}px</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="120"
                  class="w-full accent-accent"
                  value={readCornerRadius(selectedObject)}
                  onInput={(e) =>
                    updateSelectedObject({
                      _cornerRadius: parseInt((e.target as HTMLInputElement).value, 10) || 0,
                    })
                  }
                />
              </div>
            )}

            {isIcon && (
              <div>
                <label class="text-[11px] text-zinc-400 mb-1 block">Flip</label>
                <div class="flex gap-1">
                  <button
                    class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                      selectedObject.flipX
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                    }`}
                    onClick={() => updateSelectedObject({ flipX: !selectedObject.flipX })}
                  >
                    <FlipHorizontal size={14} />
                  </button>
                  <button
                    class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                      selectedObject.flipY
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                    }`}
                    onClick={() => updateSelectedObject({ flipY: !selectedObject.flipY })}
                  >
                    <FlipVertical size={14} />
                  </button>
                </div>
              </div>
            )}

            <ShadowFields obj={selectedObject} onChange={updateSelectedObject} />
          </>
        )}

        {isGroup && (
          <>
            <StylePresetFields obj={selectedObject} onChange={updateSelectedObject} />
            <ShadowFields obj={selectedObject} onChange={updateSelectedObject} />
          </>
        )}

        {/* ── Image properties ──────────────────────────────────────── */}
        {isImage && (
          <>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Image</label>
              <div class="w-full h-16 rounded-md border border-zinc-200 bg-zinc-50 overflow-hidden mb-2">
                <img
                  src={typeof selectedObject.getSrc === "function" ? selectedObject.getSrc() : ""}
                  alt=""
                  class="w-full h-full object-contain"
                />
              </div>
              <div class="max-h-[280px] overflow-y-auto">
                <MediaLibrary compact kind="images" onPick={(url) => void replaceSelectedImage(url)} />
              </div>
            </div>
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-white border border-zinc-200 cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={lockSelectedAsBackground}
              title="Fit to canvas and lock as the page background"
            >
              <Lock size={14} class="text-zinc-400" />
              <span class="text-[11px] text-zinc-600">Lock as background</span>
            </button>
            <StylePresetFields obj={selectedObject} onChange={updateSelectedObject} />
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-white border border-zinc-200 cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={() => void addImageFromClipboard(undefined, true)}
              title="Paste image from clipboard to replace this one"
            >
              <ClipboardPaste size={14} class="text-zinc-400" />
              <span class="text-[11px] text-zinc-600">Paste to replace</span>
            </button>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
                Border radius
                <span class="text-zinc-400 font-mono">{Math.round(readImageCornerRadius(selectedObject))}px</span>
              </label>
              <input
                type="range"
                min="0"
                max="120"
                class="w-full accent-accent"
                value={readImageCornerRadius(selectedObject)}
                onInput={(e) =>
                  updateSelectedObject({
                    _cornerRadius: parseInt((e.target as HTMLInputElement).value, 10) || 0,
                  })
                }
              />
            </div>
            <div>
              <label class="text-[11px] text-zinc-400 mb-1 block">Flip</label>
              <div class="flex gap-1">
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    selectedObject.flipX
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() => updateSelectedObject({ flipX: !selectedObject.flipX })}
                >
                  <FlipHorizontal size={14} />
                </button>
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    selectedObject.flipY
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-zinc-300 text-zinc-400 hover:text-zinc-900"
                  }`}
                  onClick={() => updateSelectedObject({ flipY: !selectedObject.flipY })}
                >
                  <FlipVertical size={14} />
                </button>
              </div>
            </div>
            <ShadowFields obj={selectedObject} onChange={updateSelectedObject} />
          </>
        )}

        {/* ── Common: Opacity ───────────────────────────────────────── */}
        <div>
          <label class="text-[11px] text-zinc-400 mb-1 flex justify-between">
            Opacity
            <span class="text-zinc-400 font-mono">{Math.round((selectedObject.opacity ?? 1) * 100)}%</span>
          </label>
          <div class="flex gap-1 mb-1.5">
            {OPACITY_PRESETS.map((value) => (
              <button
                key={value}
                class={`flex-1 py-1 rounded border text-[10px] cursor-pointer ${
                  Math.abs((selectedObject.opacity ?? 1) - value) < 0.02
                    ? "border-accent bg-accent/10 text-zinc-800"
                    : "border-zinc-200 bg-white text-zinc-500 hover:border-accent"
                }`}
                onClick={() => updateSelectedObject({ opacity: value })}
              >
                {Math.round(value * 100)}
              </button>
            ))}
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="w-full accent-accent"
            value={selectedObject.opacity ?? 1}
            onInput={(e) =>
              updateSelectedObject({
                opacity: parseFloat((e.target as HTMLInputElement).value),
              })
            }
          />
        </div>
      </div>
    </aside>
  );
}
