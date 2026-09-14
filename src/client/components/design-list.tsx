import { useState } from "preact/hooks";
import { Trash2, Edit3, Copy, Plus } from "lucide-preact";
import { useEditor } from "../context";
import { editorHref } from "../lib/editor-path";

export function DesignList() {
  const { designs, activeDesign, createDesign, loadDesign, deleteDesign, duplicateDesign, renameDesign, navigate } =
    useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const finishRename = () => {
    if (editingId && editName.trim()) renameDesign(editingId, editName.trim());
    setEditingId(null);
  };

  return (
    <div class="flex flex-col gap-2">
      <button
        class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer bg-accent text-white hover:bg-accent-hover transition-all"
        onClick={async () => {
          const id = await createDesign();
          if (id) navigate(editorHref(id, "designs"));
        }}
      >
        <Plus size={14} />
        New Design
      </button>

      {designs.length === 0 && (
        <p class="text-fg-muted text-[11px] text-center py-4">No saved designs yet</p>
      )}

      {designs.map((d) => (
        <div
          key={d.id}
          class={`flex items-center px-2.5 py-2 rounded-lg border transition-all group cursor-pointer ${
            activeDesign?.id === d.id
              ? "border-accent bg-accent/10"
              : "border-border-dim bg-surface-card hover:border-border-mid"
          }`}
          onClick={() => {
            navigate(editorHref(d.id, "designs"));
            loadDesign(d.id);
          }}
        >
          {editingId === d.id ? (
            <input
              class="flex-1 bg-surface-muted border border-accent rounded text-fg-secondary text-xs px-1.5 py-0.5 outline-none"
              value={editName}
              onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div class="flex-1 min-w-0">
              <span class="text-xs font-medium text-fg-secondary truncate block">{d.name}</span>
              <span class="text-[10px] text-fg-secondary">
                {d.width}x{d.height} &middot;{" "}
                {new Date(d.updated_at).toLocaleDateString()}
              </span>
            </div>
          )}
          <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            <button
              class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-fg transition-colors"
              title="Duplicate"
              onClick={(e) => {
                e.stopPropagation();
                void duplicateDesign(d.id);
              }}
            >
              <Copy size={12} />
            </button>
            <button
              class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-fg transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                startRename(d.id, d.name);
              }}
            >
              <Edit3 size={12} />
            </button>
            <button
              class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-red-400 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                deleteDesign(d.id);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
