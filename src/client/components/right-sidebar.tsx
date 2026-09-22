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
  BringToFront,
  SendToBack,
  RotateCcw,
  Shuffle,
  Square,
  AlignStartVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignEndHorizontal,
  Maximize2,
  UnfoldHorizontal,
  UnfoldVertical,
  Eye,
  EyeOff,
  BookmarkPlus,
  Pencil,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import * as fabric from "fabric";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEditor } from "../context";
import { readImageCornerRadius, readCornerRadius } from "../lib/image-radius";
import { readStylePreset, readGlassOptions, readBorderOptions, newGlassFlareSeed, STYLE_PRESETS, IMAGE_STYLE_PRESETS } from "../lib/style-presets";
import type { GlassOptions, BorderOptions, BorderKind } from "../lib/style-presets";
import { isIconObject, readIconFill, readIconStroke, readIconStrokeWidth, iconPreviewUrl } from "../lib/tabler-icons";
import { selectedCanvasObjects, captureObjectStyle, styleSwatchCss } from "../lib/object-style";
import { useSavedStyles, styleFromSaved, CREATE_STYLE_EVENT } from "../hooks/use-saved-styles";
import type { SavedStyle } from "../types";
import { stackTargetsFromSelection } from "../lib/layer-stack";
import { alignableSelection } from "../lib/align-objects";
import { isCroppableImage, readImageCrop, setImageCropOrigin, setImageCropZoom } from "../lib/image-crop";
import { isElementGroup, isInsideElementGroup, elementDisplayName } from "../lib/element-group";
import { isBgImage, pagePhotoSrc } from "../lib/background-image";
import { readElementSource, readObjectId } from "../lib/object-identity";
import { FILL_COLORS, GRADIENT_PRESETS, OPACITY_PRESETS, PATTERN_PRESETS, gradientFillForObject, patternFillFromSvg } from "../lib/fill-presets";
import { IconsPanel } from "./icons-panel";
import { ImagePickerField } from "./image-picker";
import { PropSlider } from "./prop-slider";

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

function SliderField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  displayScale?: number;
  onChange: (v: number) => void;
}) {
  return <PropSlider {...props} />;
}

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="flex flex-col gap-3">
      <h3 class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.14em] m-0">{title}</h3>
      {children}
    </section>
  );
}

function FlipFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  return (
    <div>
      <label class="text-[11px] text-fg-muted mb-1 block">Flip</label>
      <div class="flex gap-1">
        <button
          class={`p-1.5 rounded-md border cursor-pointer transition-all ${
            obj.flipX
              ? "bg-accent/20 border-accent text-accent"
              : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
          }`}
          onClick={() => onChange({ flipX: !obj.flipX })}
        >
          <FlipHorizontal size={14} />
        </button>
        <button
          class={`p-1.5 rounded-md border cursor-pointer transition-all ${
            obj.flipY
              ? "bg-accent/20 border-accent text-accent"
              : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
          }`}
          onClick={() => onChange({ flipY: !obj.flipY })}
        >
          <FlipVertical size={14} />
        </button>
      </div>
    </div>
  );
}

function nearZero(n: number) {
  return Math.abs(n) < 0.01;
}

function ResetIconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class="p-1.5 rounded-md border border-border-mid bg-transparent text-fg-muted cursor-pointer hover:text-fg hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RotateSkewFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const angle = obj.angle || 0;
  const skewX = obj.skewX || 0;
  const skewY = obj.skewY || 0;
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-1.5">
        <div class="flex-1 min-w-0">
          <PropSlider
            label="Rotation"
            value={angle}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(next) => onChange({ angle: next })}
          />
        </div>
        <ResetIconButton
          title="Reset rotation"
          disabled={nearZero(angle)}
          onClick={() => onChange({ angle: 0 })}
        >
          <RotateCcw size={14} />
        </ResetIconButton>
      </div>
      <div class="flex items-center gap-1.5">
        <div class="flex-1 min-w-0">
          <PropSlider
            label="Skew X"
            value={skewX}
            min={-70}
            max={70}
            step={0.5}
            suffix="°"
            onChange={(next) => onChange({ skewX: next })}
          />
        </div>
        <ResetIconButton
          title="Reset skew"
          disabled={nearZero(skewX) && nearZero(skewY)}
          onClick={() => onChange({ skewX: 0, skewY: 0 })}
        >
          <Square size={14} />
        </ResetIconButton>
      </div>
      <PropSlider
        label="Skew Y"
        value={skewY}
        min={-70}
        max={70}
        step={0.5}
        suffix="°"
        onChange={(next) => onChange({ skewY: next })}
      />
    </div>
  );
}

function ScaleFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const sx = Math.abs(obj.scaleX || 1);
  const sy = Math.abs(obj.scaleY || 1);
  const uniform = Math.abs(sx - sy) < 0.001;
  const signX = Math.sign(obj.scaleX || 1) || 1;
  const signY = Math.sign(obj.scaleY || 1) || 1;
  return (
    <div class="flex flex-col gap-2">
      <PropSlider
        label={uniform ? "Scale" : "Scale X"}
        value={sx}
        min={0.05}
        max={8}
        step={0.01}
        suffix="×"
        onChange={(scale) =>
          onChange(
            uniform
              ? { scaleX: signX * scale, scaleY: signY * scale }
              : { scaleX: signX * scale }
          )
        }
      />
      {!uniform && (
        <PropSlider
          label="Scale Y"
          value={sy}
          min={0.05}
          max={8}
          step={0.01}
          suffix="×"
          onChange={(scale) => onChange({ scaleY: signY * scale })}
        />
      )}
    </div>
  );
}

function ImageCropFields({
  obj,
  onCommit,
}: {
  obj: fabric.FabricImage;
  onCommit: () => void;
}) {
  const { resetSelectedImage } = useEditor();
  const crop = readImageCrop(obj);
  const apply = (fn: (img: fabric.FabricImage) => void) => {
    fn(obj);
    obj.canvas?.requestRenderAll();
    onCommit();
  };
  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <label class="text-[11px] text-fg-muted m-0">Crop</label>
        <button
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-border-dim bg-surface-card text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
          onClick={resetSelectedImage}
          title="Reset clip, origin, and size"
        >
          <RotateCcw size={11} />
          Reset
        </button>
      </div>
      <SliderField
        label="Zoom"
        value={crop.zoom}
        min={crop.minZoom}
        max={crop.maxZoom}
        step={0.01}
        suffix="×"
        onChange={(zoom) => apply((img) => setImageCropZoom(img, zoom))}
      />
      <SliderField
        label="Origin X"
        value={crop.cropX}
        min={0}
        max={Math.max(crop.maxX, 1)}
        step={1}
        onChange={(x) => apply((img) => setImageCropOrigin(img, x, crop.cropY))}
      />
      <SliderField
        label="Origin Y"
        value={crop.cropY}
        min={0}
        max={Math.max(crop.maxY, 1)}
        step={1}
        onChange={(y) => apply((img) => setImageCropOrigin(img, crop.cropX, y))}
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
      <SliderField
        label="Opacity"
        value={opts.opacity}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        suffix="%"
        onChange={(opacity) => patch({ opacity })}
      />
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
            <label class="text-[11px] text-fg-muted mb-1 block">Tint</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                value={opts.tint}
                onInput={(e) => patch({ tint: (e.target as HTMLInputElement).value })}
              />
              <input
                type="text"
                class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none font-mono"
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
      <div class="flex items-end gap-1.5">
        <div class="flex-1 min-w-0">
          <SliderField
            label="Flares"
            value={opts.flares}
            min={0}
            max={2}
            step={0.05}
            onChange={(flares) => patch({ flares })}
          />
        </div>
        <button
          type="button"
          class="mb-0.5 p-1.5 rounded-md border border-border-mid bg-transparent text-fg-muted cursor-pointer hover:text-fg hover:border-accent"
          title="Randomize glare and spark location"
          onClick={() => patch({ flareSeed: newGlassFlareSeed() })}
        >
          <Shuffle size={14} />
        </button>
      </div>
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
  const { applyCopiedObjectStyle } = useEditor();
  const { styles, createStyle, renameStyle, deleteStyle } = useSavedStyles();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const createTileRef = useRef<HTMLDivElement>(null);
  const current = readStylePreset(obj);
  const presets = obj instanceof fabric.FabricImage ? IMAGE_STYLE_PRESETS : STYLE_PRESETS;

  useEffect(() => {
    const onCreate = () => {
      setEditingId(null);
      setCreateName("");
      setCreating(true);
    };
    window.addEventListener(CREATE_STYLE_EVENT, onCreate);
    return () => window.removeEventListener(CREATE_STYLE_EVENT, onCreate);
  }, []);

  useEffect(() => {
    if (creating) createTileRef.current?.scrollIntoView({ block: "nearest" });
  }, [creating]);

  const commitRename = async (row: SavedStyle) => {
    const next = draftName.trim();
    setEditingId(null);
    if (!next || next === row.name) return;
    await renameStyle(row.id, next);
  };

  const saveCreated = async () => {
    const name = createName.trim() || "Style";
    setCreating(false);
    setCreateName("");
    await createStyle(name, captureObjectStyle(obj));
  };

  return (
    <div>
      <label class="text-[11px] text-fg-muted mb-1.5 block">Style</label>
      <div class="grid grid-cols-2 gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            class={`relative overflow-hidden rounded-lg border cursor-pointer px-2 py-2 text-left transition-all ${
              current === p.id
                ? "border-accent bg-accent/10"
                : "border-border-dim bg-surface-card hover:border-border-mid"
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
            ) : p.id === "border" ? (
              <span
                class="block h-7 rounded-md mb-1.5 bg-transparent"
                style={{
                  boxShadow: "inset 0 0 0 2px #fff, 0 0 0 1px rgba(255,255,255,0.35)",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.08), transparent)",
                }}
              />
            ) : "swatch" in p && p.swatch ? (
              <span class="block h-7 rounded-md mb-1.5" style={{ background: p.swatch }} />
            ) : (
              <span class="block h-7 rounded-md mb-1.5 bg-surface-muted border border-border-dim" />
            )}
            <span class={`text-[11px] font-medium ${current === p.id ? "text-accent" : "text-fg-secondary"}`}>
              {p.label}
            </span>
          </button>
        ))}
        {styles.map((row) => (
          <div
            key={row.id}
            class="relative overflow-hidden rounded-lg border border-border-dim bg-surface-card hover:border-border-mid px-2 py-2 text-left group"
          >
            <button
              class="block w-full bg-transparent border-none p-0 cursor-pointer text-left"
              title={row.name}
              onClick={() => {
                const style = styleFromSaved(row);
                if (style) applyCopiedObjectStyle(style);
              }}
            >
              <span
                class="block h-7 rounded-md mb-1.5 border border-border-dim"
                style={{ background: row.swatch || "#e2e8f0" }}
              />
              {editingId === row.id ? (
                <input
                  class="w-full bg-surface-card border border-accent rounded px-1 py-0.5 text-[11px] text-fg outline-none"
                  value={draftName}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onInput={(e) => setDraftName((e.target as HTMLInputElement).value)}
                  onBlur={() => void commitRename(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span class="text-[11px] font-medium text-fg-secondary truncate block">{row.name}</span>
              )}
            </button>
            {editingId !== row.id && (
              <div class="absolute top-1.5 right-1.5 hidden group-hover:flex gap-0.5">
                <button
                  class="p-0.5 rounded bg-surface-card/90 border border-border-dim text-fg-muted cursor-pointer hover:text-fg"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(row.id);
                    setDraftName(row.name);
                  }}
                >
                  <Pencil size={10} />
                </button>
                <button
                  class="p-0.5 rounded bg-surface-card/90 border border-border-dim text-fg-muted cursor-pointer hover:text-red-400"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteStyle(row.id);
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            )}
          </div>
        ))}
        {creating ? (
          <div
            ref={createTileRef}
            class="relative overflow-hidden rounded-lg border border-accent bg-accent/10 px-2 py-2 text-left"
          >
            <span
              class="block h-7 rounded-md mb-1.5 border border-border-dim"
              style={{ background: styleSwatchCss(captureObjectStyle(obj)) }}
            />
            <input
              class="w-full bg-surface-card border border-accent rounded px-1 py-0.5 text-[11px] text-fg outline-none"
              placeholder="Style name"
              value={createName}
              autoFocus
              onInput={(e) => setCreateName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setCreateName("");
                }
                if (e.key === "Enter") void saveCreated();
              }}
            />
            <div class="flex gap-1 mt-1.5">
              <button
                class="flex-1 py-0.5 rounded text-[10px] font-medium border border-accent bg-accent/10 text-accent cursor-pointer"
                onClick={() => void saveCreated()}
              >
                Save
              </button>
              <button
                class="px-2 py-0.5 rounded text-[10px] border border-border-dim bg-transparent text-fg-muted cursor-pointer"
                onClick={() => {
                  setCreating(false);
                  setCreateName("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            class="relative overflow-hidden rounded-lg border border-dashed border-border-mid bg-transparent px-2 py-2 text-left cursor-pointer hover:border-accent hover:bg-accent/5 transition-all"
            title="Create style from this object"
            onClick={() => {
              setEditingId(null);
              setCreateName("");
              setCreating(true);
            }}
          >
            <span class="h-7 rounded-md mb-1.5 border border-dashed border-border-dim flex items-center justify-center text-fg-muted">
              <BookmarkPlus size={14} />
            </span>
            <span class="text-[11px] font-medium text-fg-muted">Create style</span>
          </button>
        )}
      </div>
      {current === "glass" && <GlassOptionsFields obj={obj} onChange={onChange} />}
      {current === "border" && <BorderOptionsFields obj={obj} onChange={onChange} />}
    </div>
  );
}

function BorderOptionsFields({
  obj,
  onChange,
}: {
  obj: fabric.FabricObject;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const opts = readBorderOptions(obj);
  const patch = (partial: Partial<BorderOptions>) => onChange({ _borderOptions: partial });
  const kinds: { id: BorderKind; label: string }[] = [
    { id: "line", label: "Line" },
    { id: "rim", label: "Rim" },
  ];

  return (
    <div class="flex flex-col gap-3 pt-2">
      <div>
        <label class="text-[11px] text-fg-muted mb-1 block">Type</label>
        <div class="flex gap-1">
          {kinds.map((k) => (
            <button
              key={k.id}
              class={`flex-1 py-1 rounded-md border text-[10px] font-medium cursor-pointer ${
                opts.kind === k.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-dim bg-surface-card text-fg-muted hover:border-accent"
              }`}
              onClick={() => patch({ kind: k.id })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {opts.kind === "line" && (
        <div>
          <label class="text-[11px] text-fg-muted mb-1 block">Color</label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
              value={opts.color}
              onInput={(e) => patch({ color: (e.target as HTMLInputElement).value })}
            />
            <input
              type="text"
              class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none font-mono"
              value={opts.color}
              onInput={(e) => patch({ color: (e.target as HTMLInputElement).value })}
            />
          </div>
        </div>
      )}
      <SliderField
        label="Thickness"
        value={opts.width}
        min={0}
        max={opts.kind === "rim" ? 8 : 24}
        step={0.05}
        suffix="px"
        onChange={(width) => patch({ width })}
      />
      <SliderField
        label="Opacity"
        value={opts.opacity}
        min={0}
        max={1}
        step={0.01}
        displayScale={100}
        suffix="%"
        onChange={(opacity) => patch({ opacity })}
      />
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
    <div class="flex flex-col gap-3 pt-1 border-t border-border-dim">
      <div class="flex items-center justify-between">
        <label class="text-[11px] text-fg-muted">Shadow</label>
        <button
          class={`text-[10px] font-semibold border-none cursor-pointer rounded px-2 py-0.5 ${
            current.enabled ? "bg-accent/15 text-accent" : "bg-surface-muted text-fg-muted"
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
            class="flex-1 py-1 rounded-md border text-[10px] cursor-pointer bg-transparent text-fg-muted hover:text-fg hover:border-border-mid"
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
            <label class="text-[11px] text-fg-muted mb-1 block">Color</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                value={current.color}
                onInput={(e) => apply({ color: (e.target as HTMLInputElement).value, enabled: true })}
              />
              <input
                type="text"
                class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none font-mono"
                value={current.color}
                onInput={(e) => apply({ color: (e.target as HTMLInputElement).value, enabled: true })}
              />
            </div>
          </div>
          <PropSlider
            label="Opacity"
            value={current.opacity}
            min={0}
            max={1}
            step={0.01}
            displayScale={100}
            suffix="%"
            onChange={(opacity) => apply({ opacity, enabled: true })}
          />
          <PropSlider
            label="Blur"
            value={current.blur}
            min={0}
            max={80}
            step={1}
            suffix="px"
            onChange={(blur) => apply({ blur, enabled: true })}
          />
          <div class="grid grid-cols-2 gap-2">
            <PropSlider
              label="X"
              value={current.offsetX}
              min={-40}
              max={40}
              step={1}
              onChange={(offsetX) => apply({ offsetX, enabled: true })}
            />
            <PropSlider
              label="Y"
              value={current.offsetY}
              min={-40}
              max={40}
              step={1}
              onChange={(offsetY) => apply({ offsetY, enabled: true })}
            />
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
    bringSelectionToFront,
    sendSelectionToBack,
    alignSelected,
    matchSelectedSize,
    maximizeSelected,
    resetSelectedImage,
    canvas,
    setBackground,
    canvasWidth,
    canvasHeight,
    activeDesign,
    renameDesign,
    addImageFromClipboard,
    lockSelectedAsBackground,
    replaceSelectedIcon,
    replaceSelectedImage,
  } =
    useEditor();
  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isBg = isBgImage(selectedObject);
  const isImage = selectedObject instanceof fabric.FabricImage && !isBg;
  const isIcon = isIconObject(selectedObject);
  const isGroup = isElementGroup(selectedObject);
  const isInner = isInsideElementGroup(selectedObject);
  const isShape = selectedObject && !isText && !isImage && !isGroup && !isBg;
  const isGlass = selectedObject ? readStylePreset(selectedObject) === "glass" : false;
  const isBorder = selectedObject ? readStylePreset(selectedObject) === "border" : false;
  const selectedCount = selectedCanvasObjects(canvas, selectedObject).length;
  const canGroup = selectedCount >= 2;
  const canUngroup = isElementGroup(canvas?.getActiveObject() ?? null);
  const canRestack = !!stackTargetsFromSelection(canvas, selectedObject);
  const canAlign = alignableSelection(canvas, selectedObject).length >= 2;

  if (!selectedObject || isBg) {
    return (
      <aside class="w-[280px] bg-surface-card border-l border-border-dim flex flex-col shrink-0 overflow-y-auto">
        <div class="p-4 border-b border-border-dim">
          <h2 class="text-xs font-semibold text-fg-muted uppercase tracking-wider">Canvas</h2>
        </div>
        <div class="p-4 flex flex-col gap-3">
          <div>
            <label class="text-[11px] text-fg-muted mb-1 block">Title</label>
            <input
              key={activeDesign?.id ?? "title"}
              type="text"
              class="w-full bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent"
              defaultValue={activeDesign?.name ?? ""}
              placeholder="Untitled Design"
              disabled={!activeDesign}
              onBlur={(e) => {
                if (!activeDesign) return;
                const name = (e.target as HTMLInputElement).value.trim();
                if (name && name !== activeDesign.name) void renameDesign(activeDesign.id, name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-fg-muted">Dimensions</span>
            <span class="text-[11px] text-fg-secondary font-mono">{canvasWidth} x {canvasHeight}</span>
          </div>
          <label class="text-[11px] text-fg-muted">Background color</label>
          <input
            type="color"
            class="w-full h-8 rounded-md border border-border-mid cursor-pointer bg-transparent"
            onChange={(e) => setBackground("color", (e.target as HTMLInputElement).value)}
          />
          <ImagePickerField
            kind="backgrounds"
            currentUrl={pagePhotoSrc(canvas)}
            label="Background image"
            buttonLabel="Choose image"
            title="Choose canvas background"
            onPick={(url) => setBackground("image", url)}
          />
          <button
            class="mt-1 w-full flex items-center justify-center gap-2 p-2.5 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
            onClick={() => void addImageFromClipboard()}
            title="Paste image from clipboard (Ctrl+V)"
          >
            <ClipboardPaste size={14} class="text-fg-muted" />
            <span class="text-[11px] text-fg-secondary">Paste image from clipboard</span>
          </button>
          <p class="text-[10px] text-fg-muted m-0">Auto-resized to the canvas and saved under uploads/</p>
        </div>
      </aside>
    );
  }

  return (
    <aside class="w-[280px] bg-surface-card border-l border-border-dim flex flex-col shrink-0 overflow-y-auto">
      {/* Header */}
      <div class="p-4 border-b border-border-dim flex items-center justify-between">
        <h2
          class={`text-xs font-semibold text-fg-muted tracking-wider ${
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
            class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-fg hover:bg-surface-hover transition-all"
            onClick={() => void duplicateSelected()}
            title={selectedCount > 1 ? "Duplicate selected" : "Duplicate"}
          >
            <Copy size={14} />
          </button>
          <button
            class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-fg hover:bg-surface-hover transition-all"
            onClick={copySelectedStyle}
            title={selectedCount > 1 ? "Copy style from first selected" : "Copy style"}
          >
            <ClipboardCopy size={14} />
          </button>
          <button
            class={`p-1 rounded bg-transparent border-none cursor-pointer transition-all ${
              hasCopiedStyle
                ? "text-fg-muted hover:text-fg hover:bg-surface-hover"
                : "text-fg-muted cursor-not-allowed"
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
            class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-fg hover:bg-surface-hover transition-all"
            onClick={() => window.dispatchEvent(new Event(CREATE_STYLE_EVENT))}
            title="Create style"
          >
            <BookmarkPlus size={14} />
          </button>
          <button
            class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-red-400 hover:bg-red-500/100/10 transition-all"
            onClick={deleteSelected}
            title={selectedCount > 1 ? "Delete selected" : "Delete"}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div
        class="p-4 flex flex-col gap-5"
        data-selection-epoch={selectionEpoch}
        key={(selectedObject as { _layerId?: string })._layerId || readObjectId(selectedObject)}
      >
        <PanelSection title="General">
            {isGroup && (
              <div>
                <label class="text-[11px] text-fg-muted mb-1 block">Name</label>
                <input
                  type="text"
                  class="w-full bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent"
                  placeholder="Group"
                  value={(selectedObject as { _elementName?: string })._elementName ?? ""}
                  onInput={(e) =>
                    updateSelectedObject({ _elementName: (e.target as HTMLInputElement).value })
                  }
                />
              </div>
            )}
            {selectedCount === 1 ? (
              <div>
                <label class="text-[11px] text-fg-muted mb-1 block">Id</label>
                <div class="flex items-center gap-1.5">
                  <input
                    key={(selectedObject as { _layerId?: string })._layerId || "id"}
                    type="text"
                    class="min-w-0 flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
                    placeholder="rect_1"
                    defaultValue={readObjectId(selectedObject)}
                    onBlur={(e) =>
                      updateSelectedObject({ _id: (e.target as HTMLInputElement).value })
                    }
                  />
                  <button
                    type="button"
                    class={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md border cursor-pointer ${
                      selectedObject.visible !== false
                        ? "border-border-dim bg-surface-card text-fg-secondary hover:border-accent"
                        : "border-accent bg-accent/10 text-fg"
                    }`}
                    onClick={() => updateSelectedObject({ visible: selectedObject.visible === false })}
                    title={selectedObject.visible === false ? "Show" : "Hide"}
                    aria-pressed={selectedObject.visible !== false}
                  >
                    {selectedObject.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {readElementSource(selectedObject) ? (
                  <p class="text-[10px] text-fg-muted mt-1 mb-0">From element library</p>
                ) : null}
              </div>
            ) : (
              <div class="flex justify-end">
                <button
                  type="button"
                  class={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-md border cursor-pointer ${
                    selectedObject.visible !== false
                      ? "border-border-dim bg-surface-card text-fg-secondary hover:border-accent"
                      : "border-accent bg-accent/10 text-fg"
                  }`}
                  onClick={() => updateSelectedObject({ visible: selectedObject.visible === false })}
                  title={selectedObject.visible === false ? "Show" : "Hide"}
                  aria-pressed={selectedObject.visible !== false}
                >
                  {selectedObject.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            )}
            {isGroup && (
              <p class="text-[10px] text-fg-muted m-0">Ctrl+click a part to edit it. Drag the group to move everything.</p>
            )}
            {isInner && (
              <p class="text-[10px] text-fg-muted m-0">Editing inside the group. Click the group to go back.</p>
            )}
        </PanelSection>

        <PanelSection title="Transformation">
          <div>
            <label class="text-[11px] text-fg-muted mb-1 block">Reset</label>
            <div class="flex flex-wrap gap-1">
              <button
                class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!selectedObject || nearZero(selectedObject.angle || 0)}
                onClick={() => updateSelectedObject({ angle: 0 })}
                title="Reset rotation"
              >
                <RotateCcw size={14} />
              </button>
              <button
                class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={
                  !selectedObject ||
                  (nearZero(selectedObject.skewX || 0) && nearZero(selectedObject.skewY || 0))
                }
                onClick={() => updateSelectedObject({ skewX: 0, skewY: 0 })}
                title="Reset skew"
              >
                <Square size={14} />
              </button>
              <button
                class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!isCroppableImage(selectedObject)}
                onClick={resetSelectedImage}
                title="Reset clip, origin, and size"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canRestack}
              onClick={sendSelectionToBack}
              title="Send selected to back (Ctrl+[)"
            >
              <SendToBack size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canRestack}
              onClick={bringSelectionToFront}
              title="Bring selected to front (Ctrl+])"
            >
              <BringToFront size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => alignSelected("left")}
              title="Align left to first selected"
            >
              <AlignStartVertical size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => alignSelected("right")}
              title="Align right to first selected"
            >
              <AlignEndVertical size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => alignSelected("top")}
              title="Align top to first selected"
            >
              <AlignStartHorizontal size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => alignSelected("bottom")}
              title="Align bottom to first selected"
            >
              <AlignEndHorizontal size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => matchSelectedSize("width")}
              title="Same width as first selected"
            >
              <UnfoldHorizontal size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canAlign}
              onClick={() => matchSelectedSize("height")}
              title="Same height as first selected"
            >
              <UnfoldVertical size={14} />
            </button>
            <button
              class="p-1.5 rounded-md text-fg-muted bg-surface-card border border-border-dim cursor-pointer hover:border-accent hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!selectedObject}
              onClick={maximizeSelected}
              title="Maximize to canvas"
            >
              <Maximize2 size={14} />
            </button>
          </div>
          <div class="flex gap-1">
            <button
              class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-border-dim bg-surface-card cursor-pointer hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canGroup}
              onClick={groupSelected}
              title="Group selected (Ctrl+G)"
            >
              Group
            </button>
            <button
              class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-border-dim bg-surface-card cursor-pointer hover:border-accent disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={!canUngroup}
              onClick={ungroupSelected}
              title="Ungroup (Ctrl+Shift+G)"
            >
              Ungroup
            </button>
            <button
              class="flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium border border-border-dim bg-surface-card cursor-pointer hover:border-accent"
              onClick={() => void saveSelectionAsElement()}
              title="Save to Elements library"
            >
              As Element
            </button>
          </div>
          <ScaleFields obj={selectedObject} onChange={updateSelectedObject} />
          <RotateSkewFields obj={selectedObject} onChange={updateSelectedObject} />
          {isImage && (
            <p class="text-[10px] text-fg-muted m-0">
              Shift-drag to pan the crop. Shift-drag a corner to zoom inside the frame. Shift-drag a side handle to clip without stretching.
            </p>
          )}
          {isImage && isCroppableImage(selectedObject) && (
            <ImageCropFields obj={selectedObject} onCommit={() => updateSelectedObject({})} />
          )}
          {selectedObject instanceof fabric.Rect && (
            <PropSlider
              label="Corner radius"
              value={readCornerRadius(selectedObject)}
              min={0}
              max={120}
              step={1}
              suffix="px"
              onChange={(radius) => updateSelectedObject({ _cornerRadius: radius })}
            />
          )}
          {isImage && (
            <PropSlider
              label="Corner radius"
              value={readImageCornerRadius(selectedObject)}
              min={0}
              max={120}
              step={1}
              suffix="px"
              onChange={(radius) => updateSelectedObject({ _cornerRadius: radius })}
            />
          )}
          {(isImage || isIcon) && (
            <FlipFields obj={selectedObject} onChange={updateSelectedObject} />
          )}
        </PanelSection>

        {isText && (
          <PanelSection title="Text">
            {/* Font family */}
            <div>
              <label class="text-[11px] text-fg-muted mb-1 block">Font family</label>
              <select
                class="w-full bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none cursor-pointer focus:border-accent"
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

            <PropSlider
              label="Font size"
              value={(selectedObject as any).fontSize || 18}
              min={8}
              max={200}
              step={1}
              suffix="px"
              onChange={(fontSize) => updateSelectedObject({ fontSize })}
            />

            {/* Bold / Italic / Underline */}
            <div>
              <label class="text-[11px] text-fg-muted mb-1 block">Style</label>
              <div class="flex gap-1">
                <button
                  class={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                      ? "bg-accent/20 border-accent text-accent"
                      : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
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
                      : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
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
                      : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
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
              <label class="text-[11px] text-fg-muted mb-1 block">Alignment</label>
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
                        : "bg-transparent border-border-mid text-fg-muted hover:text-fg"
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
              <label class="text-[11px] text-fg-muted mb-1 block">Color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                  value={((selectedObject as any).fill as string) || "#ffffff"}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="text"
                  class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
                  value={((selectedObject as any).fill as string) || "#ffffff"}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
              </div>
            </div>

            <PropSlider
              label="Line height"
              value={(selectedObject as any).lineHeight || 1.2}
              min={0.8}
              max={3}
              step={0.1}
              onChange={(lineHeight) => updateSelectedObject({ lineHeight })}
            />
            <PropSlider
              label="Letter spacing"
              value={(selectedObject as any).charSpacing || 0}
              min={-200}
              max={800}
              step={10}
              onChange={(charSpacing) => updateSelectedObject({ charSpacing })}
            />
          </PanelSection>
        )}

        {isShape && (
          <PanelSection title={isIcon ? "Icon" : "Shape"}>
            {isIcon && (
              <div>
                <label class="text-[11px] text-fg-muted mb-1 block">Icon</label>
                <div class="flex items-center gap-2 mb-2">
                  <span
                    class="w-8 h-8 rounded-md border border-border-dim shrink-0"
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
                  <span class="text-xs text-fg-secondary truncate">
                    {((selectedObject as { _iconName?: string })._iconName || "icon").replace(/-/g, " ")}
                  </span>
                </div>
                <div class="max-h-[240px] overflow-y-auto border border-border-dim rounded-md p-1.5">
                  <IconsPanel
                    compact
                    current={(selectedObject as { _iconName?: string })._iconName}
                    onPick={(pick) => void replaceSelectedIcon(pick)}
                  />
                </div>
              </div>
            )}
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={() => void addImageFromClipboard()}
              title="Paste image from clipboard (Ctrl+V)"
            >
              <ClipboardPaste size={14} class="text-fg-muted" />
              <span class="text-[11px] text-fg-secondary">Paste image from clipboard</span>
            </button>
            {!isGlass && (
            <div>
              <label class="text-[11px] text-fg-muted mb-1 block">Fill color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                  value={isIcon ? readIconFill(selectedObject) : ((typeof selectedObject.fill === "string" && selectedObject.fill) || "#6366f1")}
                  onInput={(e) =>
                    updateSelectedObject({ fill: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="text"
                  class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
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
                    class="aspect-square rounded border border-border-dim cursor-pointer hover:border-accent"
                    style={{ background: c }}
                    onClick={() => updateSelectedObject({ fill: c })}
                  />
                ))}
              </div>
              {!isIcon && (
                <>
                  <p class="text-[10px] text-fg-muted mt-3 mb-1 m-0">Gradients</p>
                  <div class="grid grid-cols-7 gap-1">
                    {GRADIENT_PRESETS.map((g) => (
                      <button
                        key={g}
                        class="aspect-square rounded border border-border-dim cursor-pointer hover:border-accent"
                        style={{ background: g }}
                        onClick={() =>
                          updateSelectedObject({ fill: gradientFillForObject(selectedObject, g) })
                        }
                      />
                    ))}
                  </div>
                  <p class="text-[10px] text-fg-muted mt-3 mb-1 m-0">Textures</p>
                  <div class="grid grid-cols-6 gap-1">
                    {PATTERN_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        class="aspect-square rounded border border-border-dim cursor-pointer hover:border-accent bg-cover"
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
          </PanelSection>
        )}

        {isImage && (
          <PanelSection title="Image">
            <ImagePickerField
              kind="images"
              currentUrl={typeof selectedObject.getSrc === "function" ? selectedObject.getSrc() : ""}
              label="Image"
              buttonLabel="Choose image"
              title="Choose image"
              confirmLabel="Replace"
              onPick={(url) => void replaceSelectedImage(url)}
            />
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={lockSelectedAsBackground}
              title="Fit to canvas and lock as the page background"
            >
              <Lock size={14} class="text-fg-muted" />
              <span class="text-[11px] text-fg-secondary">Lock as background</span>
            </button>
            <button
              class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
              onClick={() => void addImageFromClipboard(undefined, true)}
              title="Paste image from clipboard to replace this one"
            >
              <ClipboardPaste size={14} class="text-fg-muted" />
              <span class="text-[11px] text-fg-secondary">Paste to replace</span>
            </button>
          </PanelSection>
        )}

        <PanelSection title="Effects">
          <div class="flex flex-col gap-1.5">
            <div class="flex gap-1">
              {OPACITY_PRESETS.map((value) => (
                <button
                  key={value}
                  class={`flex-1 py-1 rounded border text-[10px] cursor-pointer ${
                    Math.abs((selectedObject.opacity ?? 1) - value) < 0.02
                      ? "border-accent bg-accent/10 text-fg"
                      : "border-border-dim bg-surface-card text-fg-muted hover:border-accent"
                  }`}
                  onClick={() => updateSelectedObject({ opacity: value })}
                >
                  {Math.round(value * 100)}
                </button>
              ))}
            </div>
            <PropSlider
              label="Opacity"
              value={selectedObject.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              displayScale={100}
              suffix="%"
              onChange={(opacity) => updateSelectedObject({ opacity })}
            />
          </div>
          {(isShape || isGroup || isImage || isText) && (
            <StylePresetFields obj={selectedObject} onChange={updateSelectedObject} />
          )}
          {isShape && isIcon && !isBorder && (
            <>
              <div>
                <label class="text-[11px] text-fg-muted mb-1 block">Outline color</label>
                <div class="flex items-center gap-2">
                  <input
                    type="color"
                    class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                    value={readIconStroke(selectedObject)}
                    onInput={(e) => {
                      const stroke = (e.target as HTMLInputElement).value;
                      const width = Math.max(readIconStrokeWidth(selectedObject), 2);
                      updateSelectedObject({ stroke, strokeWidth: width });
                    }}
                  />
                  <input
                    type="text"
                    class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
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
          )}
          {isShape && !isIcon && !isBorder && (
            <div>
              <label class="text-[11px] text-fg-muted mb-1 block">Stroke color</label>
              <div class="flex items-center gap-2">
                <input
                  type="color"
                  class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
                  value={(selectedObject.stroke as string) || "#000000"}
                  onInput={(e) =>
                    updateSelectedObject({ stroke: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="number"
                  class="w-16 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent"
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
          <ShadowFields obj={selectedObject} onChange={updateSelectedObject} />
        </PanelSection>
      </div>
    </aside>
  );
}
