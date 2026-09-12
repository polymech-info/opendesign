import { useState } from "preact/hooks";
import { History, Trash2 } from "lucide-preact";
import { useEditor } from "../context";
import type { DesignVersion } from "../types";

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function VersionRow({
  version,
  active,
  onOpen,
  onDelete,
}: {
  version: DesignVersion;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      class={`rounded-lg border px-2.5 py-2 cursor-pointer transition-all ${
        active ? "border-accent bg-accent/10" : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
      onClick={onOpen}
    >
      <div class="flex items-start gap-1.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[10px] font-mono text-zinc-400 shrink-0">#{version.rev}</span>
            <span
              class={`text-[9px] uppercase tracking-wide px-1 py-px rounded shrink-0 ${
                version.kind === "manual" ? "bg-accent/15 text-accent" : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {version.kind}
            </span>
            {version.title ? (
              <span class="text-[11px] font-medium text-zinc-700 truncate">{version.title}</span>
            ) : null}
          </div>
          {version.description ? (
            <p class="text-[10px] text-zinc-500 m-0 mt-0.5 line-clamp-2">{version.description}</p>
          ) : null}
          <p class="text-[10px] text-zinc-400 m-0 mt-0.5">{formatWhen(version.created_at)}</p>
        </div>
        <button
          class="p-1 rounded text-zinc-400 bg-transparent border-none cursor-pointer hover:text-red-400 shrink-0"
          title="Delete version"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export function VersionsPanel() {
  const {
    activeDesign,
    versions,
    activeVersionRev,
    saveVersion,
    deleteVersion,
    switchVersion,
    saving,
  } = useEditor();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  if (!activeDesign) {
    return <p class="text-zinc-400 text-[11px]">Open a design to save versions.</p>;
  }

  const submit = async () => {
    setBusy(true);
    try {
      await saveVersion(description.trim());
      setDescription("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flex flex-col gap-3">
      <p class="text-zinc-400 text-[11px] m-0">
        Click to switch. Copy on one, paste on another — Current stays separate.
      </p>
      <div class="flex flex-col gap-1.5">
        <textarea
          class="w-full min-h-[56px] resize-y bg-white border border-zinc-200 rounded-md px-2 py-1.5 text-xs text-zinc-800 outline-none focus:border-accent"
          placeholder="Description (optional)"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        />
        <button
          class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer bg-accent text-zinc-900 hover:bg-accent-hover disabled:opacity-50"
          disabled={busy || saving}
          onClick={() => void submit()}
        >
          <History size={13} />
          {busy || saving ? "Saving…" : "Save version"}
        </button>
      </div>

      <button
        class={`w-full text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-all ${
          activeVersionRev == null ? "border-accent bg-accent/10" : "border-zinc-200 bg-white hover:border-zinc-400"
        }`}
        onClick={() => void switchVersion(null)}
      >
        <span class="text-[11px] font-medium text-zinc-800">Current</span>
        <span class="block text-[10px] text-zinc-400 mt-0.5">Live working copy</span>
      </button>

      {versions.length === 0 ? (
        <p class="text-zinc-400 text-[11px] text-center py-2 m-0">No snapshots yet</p>
      ) : (
        <div class="flex flex-col gap-1.5">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              active={activeVersionRev === version.rev}
              onOpen={() => void switchVersion(version.rev)}
              onDelete={() => void deleteVersion(version.rev)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
