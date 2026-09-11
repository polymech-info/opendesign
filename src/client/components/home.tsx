import { useState, useCallback } from "preact/hooks";
import { Plus, Trash2, Edit3, Sparkles, ChevronDown } from "lucide-preact";
import type { Design, Template } from "../types";
import { TemplateCard } from "./template-card";
import { CANVAS_SIZES } from "../context";

interface HomeProps {
  designs: Design[];
  templates: Template[];
  navigate: (to: string) => void;
  createDesign: (size?: { width: number; height: number }) => Promise<string | undefined>;
  deleteDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  createFromTemplate: (template: Template) => Promise<string | undefined>;
}

export function Home({
  designs,
  templates,
  navigate,
  createDesign,
  deleteDesign,
  renameDesign,
  createFromTemplate,
}: HomeProps) {
  const [showSizes, setShowSizes] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleCreate = useCallback(
    async (size?: { width: number; height: number }) => {
      setShowSizes(false);
      const id = await createDesign(size);
      if (id) navigate(`/design/${id}`);
    },
    [createDesign, navigate]
  );

  const handleTemplateClick = useCallback(
    async (t: Template) => {
      const id = await createFromTemplate(t);
      if (id) navigate(`/design/${id}`);
    },
    [createFromTemplate, navigate]
  );

  const startRename = (id: string, name: string, e: Event) => {
    e.stopPropagation();
    setEditingId(id);
    setEditName(name);
  };

  const finishRename = () => {
    if (editingId && editName.trim()) renameDesign(editingId, editName.trim());
    setEditingId(null);
  };

  return (
    <div class="min-h-full bg-[#F3F4F7]">
      {/* Header */}
      <div class="bg-white border-b border-zinc-200">
        <div class="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 class="text-lg font-bold text-zinc-800 m-0">My Designs</h1>
            <p class="text-xs text-zinc-400 mt-0.5 m-0">
              {designs.length} design{designs.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div class="relative">
            <button
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer bg-[#6366f1] text-white hover:bg-[#5558e6] transition-all shadow-sm"
              onClick={() => setShowSizes((open) => !open)}
            >
              <Plus size={15} />
              Blank design
              <ChevronDown size={12} />
            </button>
            {showSizes && (
              <>
                <div class="fixed inset-0 z-10" onClick={() => setShowSizes(false)} />
                <div class="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-xl z-20 min-w-[220px] py-1">
                  <p class="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    Canvas size
                  </p>
                  {CANVAS_SIZES.map((s) => (
                    <button
                      key={s.label}
                      class="w-full text-left px-3 py-1.5 text-xs cursor-pointer border-none bg-transparent text-zinc-700 hover:bg-zinc-100"
                      onClick={() => handleCreate({ width: s.width, height: s.height })}
                    >
                      <span class="font-medium">{s.label}</span>
                      <span class="text-zinc-400 ml-2">
                        {s.width} × {s.height}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div class="max-w-6xl mx-auto px-6 py-6">
        {/* Templates section */}
        {templates.length > 0 && (
          <div class="mb-8">
            <div class="flex items-center gap-2 mb-3">
              <Sparkles size={14} class="text-[#6366f1]" />
              <h2 class="text-sm font-semibold text-zinc-700 m-0">Start from a template</h2>
              <span class="text-[11px] text-zinc-400">Creates a new design at that size</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {templates.map((t) => (
                <TemplateCard key={t.id} template={t} onClick={() => handleTemplateClick(t)} />
              ))}
            </div>
          </div>
        )}

        {/* Designs grid */}
        {designs.length === 0 ? (
          <div class="text-center py-20">
            <div class="w-16 h-16 rounded-2xl bg-zinc-200 flex items-center justify-center mx-auto mb-4">
              <Plus size={24} class="text-zinc-400" />
            </div>
            <p class="text-sm text-zinc-500 mb-1">No designs yet</p>
            <p class="text-xs text-zinc-400 mb-4">Pick a template above, or start from a blank canvas</p>
            <button
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer bg-[#6366f1] text-white hover:bg-[#5558e6] transition-all"
              onClick={() => setShowSizes(true)}
            >
              <Plus size={14} />
              Create Design
            </button>
          </div>
        ) : (
          <>
            <h2 class="text-sm font-semibold text-zinc-700 mb-3 m-0">Recent designs</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {designs.map((d) => (
                <div
                  key={d.id}
                  class="bg-white rounded-xl border border-zinc-200 overflow-hidden cursor-pointer transition-all hover:border-[#6366f1] hover:shadow-md group"
                  onClick={() => navigate(`/design/${d.id}`)}
                >
                  {/* Preview area */}
                  <div class="aspect-[4/3] bg-zinc-100 flex items-center justify-center">
                    {d.thumbnail_url ? (
                      <img
                        src={d.thumbnail_url}
                        alt={d.name}
                        class="w-full h-full object-cover"
                      />
                    ) : (
                      <div class="text-zinc-300 text-[10px] font-medium">
                        {d.width} x {d.height}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div class="p-3">
                    {editingId === d.id ? (
                      <input
                        class="w-full bg-zinc-100 border border-[#6366f1] rounded text-zinc-800 text-xs px-2 py-1 outline-none"
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
                      <div class="flex items-start justify-between">
                        <div class="min-w-0 flex-1">
                          <p class="text-xs font-semibold text-zinc-700 truncate m-0">
                            {d.name}
                          </p>
                          <p class="text-[10px] text-zinc-400 mt-0.5 m-0">
                            {d.width} x {d.height} &middot;{" "}
                            {new Date(d.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                          <button
                            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-zinc-700 transition-colors"
                            onClick={(e) => startRename(d.id, d.name, e)}
                          >
                            <Edit3 size={12} />
                          </button>
                          <button
                            class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-red-400 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteDesign(d.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
