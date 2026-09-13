import { useCallback, useEffect, useState } from "preact/hooks";
import { Trash2, GripVertical, Eye, EyeOff } from "lucide-preact";
import { useEditor } from "../context";

export function LayersPanel() {
  const { getLayers, selectLayer, toggleLayerVisible, reorderLayers, selectedObject, layersEpoch, deleteSelected } =
    useEditor();
  const layers = getLayers();
  const selectedId = (selectedObject as { _layerId?: string } | null)?._layerId;
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    void layersEpoch;
  }, [layersEpoch]);

  const onDrop = useCallback(
    (to: number) => {
      if (dragFrom === null) return;
      reorderLayers(dragFrom, to);
      setDragFrom(null);
    },
    [dragFrom, reorderLayers]
  );

  if (layers.length === 0) {
    return <p class="text-zinc-400 text-[11px]">No layers yet. Add text, shapes, or images.</p>;
  }

  return (
    <div class="flex flex-col gap-1">
      <p class="text-zinc-400 text-[11px] mb-1">Drag to change order. Top is in front.</p>
      {layers.map((layer, index) => (
        <div
          key={layer.id}
          draggable
          onDragStart={() => setDragFrom(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(index)}
          onClick={() => selectLayer(layer.id)}
          class={`flex items-center gap-1.5 px-1.5 py-1.5 rounded-md border cursor-grab active:cursor-grabbing ${
            selectedId === layer.id
              ? "border-accent bg-accent/10"
              : "border-zinc-200 bg-white hover:border-zinc-300"
          } ${layer.visible === false ? "opacity-50" : ""}`}
        >
          <GripVertical size={12} class="text-zinc-300 shrink-0" />
          <div class="min-w-0 flex-1" title={layer.name}>
            <p class="text-[11px] text-zinc-700 truncate m-0">{layer.name}</p>
            <p class="text-[9px] text-zinc-400 m-0 capitalize">{layer.kind}</p>
          </div>
          <button
            class="p-0.5 rounded bg-transparent border-none text-zinc-300 hover:text-zinc-700 cursor-pointer shrink-0"
            title={layer.visible === false ? "Show" : "Hide"}
            onClick={(e) => {
              e.stopPropagation();
              toggleLayerVisible(layer.id);
            }}
          >
            {layer.visible === false ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
          <button
            class="p-0.5 rounded bg-transparent border-none text-zinc-300 hover:text-red-400 cursor-pointer shrink-0"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              selectLayer(layer.id);
              deleteSelected();
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
