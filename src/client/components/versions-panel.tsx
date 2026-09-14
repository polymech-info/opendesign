import { useState } from "preact/hooks";
import { History, RotateCcw, Trash2 } from "lucide-preact";
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
  onRestore,
  onDelete,
}: {
  version: DesignVersion;
  active: boolean;
  onOpen: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      class={`rounded-lg border px-2.5 py-2 cursor-pointer transition-all ${
        active ? "border-accent bg-accent/10" : "border-border-dim bg-surface-card hover:border-border-mid"
      }`}
      onClick={onOpen}
    >
      <div class="flex items-start gap-1.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[10px] font-mono text-fg-muted shrink-0">#{version.rev}</span>
            <span
              class={`text-[9px] uppercase tracking-wide px-1 py-px rounded shrink-0 ${
                version.kind === "manual" ? "bg-accent/15 text-accent" : "bg-surface-muted text-fg-muted"
              }`}
            >
              {version.kind}
            </span>
            {version.title ? (
              <span class="text-[11px] font-medium text-fg-secondary truncate">{version.title}</span>
            ) : null}
          </div>
          {version.description ? (
            <p class="text-[10px] text-fg-muted m-0 mt-0.5 line-clamp-2">{version.description}</p>
          ) : null}
          <p class="text-[10px] text-fg-muted m-0 mt-0.5">{formatWhen(version.created_at)}</p>
        </div>
        <button
          class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-accent shrink-0"
          title="Restore onto Current"
          onClick={(e) => {
            e.stopPropagation();
            onRestore();
          }}
        >
          <RotateCcw size={12} />
        </button>
        <button
          class="p-1 rounded text-fg-muted bg-transparent border-none cursor-pointer hover:text-red-400 shrink-0"
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
    restoreVersion,
    deleteVersion,
    switchVersion,
    saving,
  } = useEditor();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  if (!activeDesign) {
    return <p class="text-fg-muted text-[11px]">Open a design to save versions.</p>;
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
      <p class="text-fg-muted text-[11px] m-0">
        Click to preview. Restore writes that snapshot onto Current.
      </p>
      <div class="flex flex-col gap-1.5">
        <textarea
          class="w-full min-h-[56px] resize-y bg-surface-card border border-border-dim rounded-md px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
          placeholder="Description (optional)"
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
        />
        <button
          class="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer bg-accent text-white hover:bg-accent-hover disabled:opacity-50"
          disabled={busy || saving}
          onClick={() => void submit()}
        >
          <History size={13} />
          {busy || saving ? "Saving…" : "Save version"}
        </button>
      </div>

      <button
        class={`w-full text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-all ${
          activeVersionRev == null ? "border-accent bg-accent/10" : "border-border-dim bg-surface-card hover:border-border-mid"
        }`}
        onClick={() => void switchVersion(null)}
      >
        <span class="text-[11px] font-medium text-fg">Current</span>
        <span class="block text-[10px] text-fg-muted mt-0.5">Live working copy</span>
      </button>

      {versions.length === 0 ? (
        <p class="text-fg-muted text-[11px] text-center py-2 m-0">No snapshots yet</p>
      ) : (
        <div class="flex flex-col gap-1.5">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              active={activeVersionRev === version.rev}
              onOpen={() => void switchVersion(version.rev)}
              onRestore={() => void restoreVersion(version.rev)}
              onDelete={() => void deleteVersion(version.rev)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
