import { useCallback, useEffect, useState } from "preact/hooks";
import { Trash2 } from "lucide-preact";
import * as fabric from "fabric";
import { loadFabricJSON } from "../lib/fabric-json";
import type { LibraryElement } from "../types";
import { api } from "../api";

function ElementPreview({ item }: { item: LibraryElement }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const w = Math.max(40, item.width || 120);
    const h = Math.max(40, item.height || 120);
    const el = document.createElement("canvas");
    const canvas = new fabric.StaticCanvas(el, { width: w, height: h, backgroundColor: "#f8fafc" });
    void loadFabricJSON(canvas, item.canvas_json)
      .then(() => {
        if (disposed) {
          canvas.dispose();
          return;
        }
        const objects = canvas.getObjects();
        if (objects.length === 1) {
          objects[0].set({ originX: "center", originY: "center", left: w / 2, top: h / 2 });
        }
        canvas.renderAll();
        const multiplier = Math.min(160 / w, 160 / h, 2);
        setSrc(canvas.toDataURL({ format: "png", multiplier }));
        canvas.dispose();
      })
      .catch(() => {
        canvas.dispose();
      });
    return () => {
      disposed = true;
    };
  }, [item.id, item.canvas_json, item.width, item.height]);

  return src ? (
    <img src={src} alt={item.name} class="w-full h-full object-contain" />
  ) : (
    <span class="text-[10px] text-fg-muted">…</span>
  );
}

export function ElementsLibrary({
  onPick,
}: {
  onPick: (canvasJson: string, name: string, sourceId: string) => void;
}) {
  const [items, setItems] = useState<LibraryElement[]>([]);

  const refresh = useCallback(async () => {
    try {
      const rows = await api<LibraryElement[]>("GET", "/api/elements");
      setItems(rows ?? []);
    } catch (e) {
      console.error("Failed to load elements:", e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("opend-elements-changed", onChanged);
    return () => window.removeEventListener("opend-elements-changed", onChanged);
  }, [refresh]);

  const remove = useCallback(
    async (item: LibraryElement, e: Event) => {
      e.stopPropagation();
      await api("DELETE", `/api/elements/${item.id}`);
      await refresh();
    },
    [refresh]
  );

  if (items.length === 0) {
    return (
      <p class="text-fg-muted text-[11px] m-0">
        Saved groups show up here. Name a group in the right panel, then As Element.
      </p>
    );
  }

  return (
    <div class="grid grid-cols-2 gap-1.5">
      {items.map((item) => (
        <div key={item.id} class="group relative rounded-md overflow-hidden border border-border-dim bg-surface-muted">
          <button
            class="block w-full aspect-square p-1.5 border-none cursor-pointer bg-surface-muted"
            title={item.name}
            onClick={() => onPick(item.canvas_json, item.name, item.id)}
          >
            <ElementPreview item={item} />
          </button>
          <p class="px-1.5 pb-1.5 text-[10px] text-fg-muted truncate m-0">{item.name}</p>
          <button
            class="absolute top-1 right-1 p-0.5 rounded bg-surface-card/90 border border-border-dim text-fg-muted hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove from library"
            onClick={(e) => void remove(item, e)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
