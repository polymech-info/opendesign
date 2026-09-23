import { useEffect, useRef, useState } from "preact/hooks";
import { useEditor } from "../context";
import { pageThemeLayer } from "../lib/background-image";
import {
  GRADIENT_LIBRARY_EVENT,
  defaultGradient,
  editorStateForObject,
  loadGradientLibrary,
  parseCssLinear,
  readPageBackgroundGradient,
  withGradientRole,
  type GradientDef,
  type GradientRole,
} from "../lib/gradient";
import { GRADIENT_PRESETS } from "../lib/fill-presets";
import { GradientEditorDialog, GradientPalette } from "./gradient-editor";

const GRADIENT_SWATCHES = GRADIENT_PRESETS.map((css) => parseCssLinear(css));

const BG_COLORS = [
  "#1a1a2e",
  "#0f172a",
  "#18181b",
  "#1e1b4b",
  "#ffffff",
  "#f8fafc",
  "#fafaf9",
  "#fef3c7",
  "#2563eb",
  "#7c3aed",
  "#dc2626",
  "#059669",
];

function solidHex(value: string) {
  return value.startsWith("#") ? value.slice(0, 7) : "#ffffff";
}

export function BackgroundFillPanel() {
  const { setBackground, canvas } = useEditor();
  const [savedGradients, setSavedGradients] = useState(loadGradientLibrary);
  const [gradientEdit, setGradientEdit] = useState<{ def: GradientDef; role: GradientRole } | null>(null);
  const revertRef = useRef<{ gradient: GradientDef | null; color: string } | null>(null);
  const bgLayer = canvas ? pageThemeLayer(canvas) : null;
  const currentColor =
    (bgLayer && typeof bgLayer.fill === "string" && bgLayer.fill) ||
    (typeof canvas?.backgroundColor === "string" && canvas.backgroundColor) ||
    "#ffffff";

  useEffect(() => {
    const refresh = () => setSavedGradients(loadGradientLibrary());
    window.addEventListener(GRADIENT_LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(GRADIENT_LIBRARY_EVENT, refresh);
  }, []);

  const palette = [...savedGradients, ...GRADIENT_SWATCHES];
  const current = canvas ? readPageBackgroundGradient(canvas) : null;

  const openEdit = (state: { def: GradientDef; role: GradientRole }) => {
    revertRef.current = { gradient: current, color: solidHex(currentColor) };
    setGradientEdit({ def: current || state.def, role: "fill" });
  };

  return (
    <div class="flex flex-col gap-3">
      <div>
        <label class="text-[11px] text-fg-muted mb-1 block">Color</label>
        <div class="flex items-center gap-2">
          <input
            type="color"
            class="w-8 h-8 rounded border border-border-mid cursor-pointer bg-transparent shrink-0"
            value={solidHex(currentColor)}
            onInput={(e) => setBackground("color", (e.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            class="flex-1 bg-surface-card border border-border-mid rounded-md text-xs text-fg-secondary px-2 py-1.5 outline-none focus:border-accent font-mono"
            value={currentColor}
            onChange={(e) => setBackground("color", (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="grid grid-cols-6 gap-1 mt-2">
          {BG_COLORS.map((c) => (
            <button
              key={c}
              class="aspect-square rounded border border-border-dim cursor-pointer hover:border-accent"
              style={{ background: c }}
              onClick={() => setBackground("color", c)}
            />
          ))}
        </div>
      </div>
      <div>
        <p class="text-[10px] text-fg-muted mb-1 m-0">Gradients</p>
        <GradientPalette
          obj={bgLayer}
          palette={palette}
          defaultRole="fill"
          onPick={(def) => setBackground("gradient", withGradientRole(def, "fill"))}
          onEdit={openEdit}
        />
        <div class="flex items-center gap-2 mt-2">
          <button
            type="button"
            class="flex-1 px-2 py-1 rounded-md text-[11px] border border-border-dim bg-surface-card text-fg-secondary cursor-pointer hover:border-accent"
            onClick={() =>
              openEdit(editorStateForObject(bgLayer, current || defaultGradient(), "fill"))
            }
          >
            {current ? "Edit gradient" : "Custom gradient"}
          </button>
          {current ? (
            <button
              type="button"
              class="px-2 py-1 rounded-md text-[11px] border border-border-dim bg-surface-card text-fg-muted cursor-pointer hover:border-accent hover:text-fg"
              onClick={() => setBackground("color", solidHex(currentColor))}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {gradientEdit && (
        <GradientEditorDialog
          key={`${gradientEdit.def.id}:${gradientEdit.def.stops.map((s) => `${s.offset}${s.hex}${s.alpha}`).join("|")}`}
          initial={gradientEdit.def}
          role="fill"
          onPreview={(def) => setBackground("gradient", withGradientRole(def, "fill"), { history: false })}
          onCancel={() => {
            const snap = revertRef.current;
            if (snap?.gradient) setBackground("gradient", snap.gradient, { history: false });
            else setBackground("color", snap?.color || solidHex(currentColor), { history: false });
            revertRef.current = null;
            setGradientEdit(null);
          }}
          onApply={(def) => {
            revertRef.current = null;
            setBackground("gradient", withGradientRole(def, "fill"));
            setGradientEdit(null);
          }}
        />
      )}
    </div>
  );
}
