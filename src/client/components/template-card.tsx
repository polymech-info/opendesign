import { useState, useEffect, useRef } from "preact/hooks";
import * as fabric from "fabric";
import { loadFabricJSON } from "../lib/fabric-json";

interface Props {
  template: Template;
  onClick: () => void;
}

export function TemplateCard({ template, onClick }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (rendered.current) return;
    rendered.current = true;

    const el = document.createElement("canvas");
    const tempCanvas = new fabric.StaticCanvas(el, {
      width: template.width,
      height: template.height,
    });

    void loadFabricJSON(tempCanvas, template.canvas_json)
      .then(() => {
        tempCanvas.renderAll();
        const targetPx = 400;
        const multiplier = Math.min(targetPx / template.width, targetPx / template.height, 1);
        const dataUrl = tempCanvas.toDataURL({
          format: "png",
          multiplier,
        });
        setPreview(dataUrl);
        tempCanvas.dispose();
      })
      .catch(() => {
        tempCanvas.dispose();
      });
  }, [template]);

  return (
    <button
      class="group relative bg-surface-card border border-border-dim rounded-lg overflow-hidden cursor-pointer transition-all hover:border-accent hover:shadow-lg hover:shadow-accent/10 p-0"
      onClick={onClick}
    >
      {/* Preview area */}
      <div
        class="w-full flex items-center justify-center bg-surface-muted overflow-hidden"
        style={{ aspectRatio: `${template.width} / ${template.height}` }}
      >
        {preview ? (
          <img
            src={preview}
            alt={template.name}
            class="w-full h-full object-contain"
          />
        ) : (
          <span class="text-fg-muted text-[10px] font-medium">Loading...</span>
        )}
      </div>
      {/* Label */}
      <div class="px-2 py-1.5 border-t border-border-dim">
        <span class="text-[10px] text-fg-secondary font-medium truncate block">
          {template.name}
        </span>
        <span class="text-[9px] text-fg-muted">
          {template.width}&times;{template.height}
        </span>
      </div>
    </button>
  );
}
