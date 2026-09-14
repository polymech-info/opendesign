import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Upload } from "lucide-preact";
import {
  acceptFileDrag,
  imageFilesFromDataTransfer,
  isImageFile,
  uploadImageFile,
  type UploadKind,
} from "../lib/file-drop";
import { readRecentUploadUrls, rememberRecentUpload, type RecentUploadKind } from "../lib/recent-uploads";

export type ImagePickerKind = RecentUploadKind;

export type ImagePickerItem = {
  key: string;
  filename: string;
  url: string;
  mtime?: number;
};

const PAGE_SIZE = 24;

function pageCount(n: number) {
  return Math.max(1, Math.ceil(n / PAGE_SIZE));
}

function Thumb({
  item,
  selected,
  onSelect,
  onConfirm,
}: {
  item: ImagePickerItem;
  selected: boolean;
  onSelect: () => void;
  onConfirm: (url: string) => void;
}) {
  return (
    <button
      type="button"
      class={`relative aspect-square rounded-md overflow-hidden border p-0 cursor-pointer bg-surface-muted ${
        selected ? "border-accent ring-2 ring-accent/40" : "border-border-dim hover:border-accent"
      }`}
      title={item.filename}
      onClick={onSelect}
      onDblClick={() => onConfirm(item.url)}
    >
      <img src={item.url} alt={item.filename} class="w-full h-full object-cover" loading="lazy" decoding="async" />
    </button>
  );
}

export function ImagePickerDialog({
  kind,
  currentUrl,
  title,
  confirmLabel = "OK",
  onConfirm,
  onCancel,
}: {
  kind: ImagePickerKind;
  currentUrl?: string;
  title: string;
  confirmLabel?: string;
  onConfirm: (url: string) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<ImagePickerItem[]>([]);
  const [recent, setRecent] = useState<string[]>(() => readRecentUploadUrls(kind));
  const [draft, setDraft] = useState(currentUrl || "");
  const [page, setPage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depthRef = useRef(0);
  const syncedPageRef = useRef(false);

  const refresh = useCallback(async () => {
    const resp = await fetch(`/api/uploads?kind=${kind}`);
    const data = (await resp.json()) as { items?: ImagePickerItem[] };
    const next = [...(data.items ?? [])].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || b.filename.localeCompare(a.filename));
    setItems(next);
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (syncedPageRef.current || !currentUrl || items.length === 0) return;
    const idx = items.findIndex((item) => item.url === currentUrl);
    if (idx >= 0) setPage(Math.floor(idx / PAGE_SIZE));
    syncedPageRef.current = true;
  }, [currentUrl, items]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const byUrl = useMemo(() => new Map(items.map((item) => [item.url, item])), [items]);
  const recentItems = useMemo(
    () => recent.map((url) => byUrl.get(url)).filter((item): item is ImagePickerItem => !!item),
    [recent, byUrl]
  );

  const pages = pageCount(items.length);
  const safePage = Math.min(page, pages - 1);
  const visible = items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const confirm = useCallback(
    (url?: string) => {
      const next = (url || draft).trim();
      if (!next) return;
      rememberRecentUpload(kind, next);
      onConfirm(next);
    },
    [draft, kind, onConfirm]
  );

  const upload = useCallback(
    async (files: File[] | FileList | null) => {
      const list = files ? Array.from(files).filter(isImageFile) : [];
      if (!list.length) return;
      setUploading(true);
      try {
        let last = "";
        for (const file of list) {
          const url = await uploadImageFile(file, kind as UploadKind);
          if (url) last = url;
        }
        await refresh();
        if (last) {
          setDraft(last);
          setRecent(readRecentUploadUrls(kind));
          setPage(0);
        }
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kind, refresh]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === "Enter") {
        const hit = e.target as HTMLElement | null;
        if (hit?.closest("[data-picker-cancel]")) return;
        e.preventDefault();
        e.stopPropagation();
        confirm();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.stopPropagation();
        return;
      }
      if (e.key === "PageDown" || (e.key === "ArrowRight" && e.altKey)) {
        e.preventDefault();
        setPage((n) => Math.min(pages - 1, n + 1));
      } else if (e.key === "PageUp" || (e.key === "ArrowLeft" && e.altKey)) {
        e.preventDefault();
        setPage((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirm, draft, onCancel, pages]);

  return (
    <div
      class="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        class="bg-surface-card border border-border-dim rounded-xl shadow-2xl w-[min(720px,calc(100vw-32px))] max-h-[min(80vh,640px)] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onDragEnter={(e) => {
          if (!acceptFileDrag(e)) return;
          depthRef.current += 1;
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!acceptFileDrag(e)) return;
          depthRef.current = Math.max(0, depthRef.current - 1);
          if (!depthRef.current) setDragOver(false);
        }}
        onDragOver={(e) => acceptFileDrag(e)}
        onDrop={(e) => {
          if (!acceptFileDrag(e)) return;
          depthRef.current = 0;
          setDragOver(false);
          void upload(imageFilesFromDataTransfer(e.dataTransfer));
        }}
      >
        <div class="px-4 py-3 border-b border-border-dim flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-fg m-0">{title}</h2>
          <button
            type="button"
            class="text-[11px] text-fg-muted bg-transparent border border-dashed border-border-mid rounded-md px-2 py-1 cursor-pointer hover:border-accent hover:text-fg"
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple={kind === "images"}
            class="hidden"
            onChange={(e) => void upload((e.target as HTMLInputElement).files)}
          />
        </div>

        <div class={`flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4 ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}>
          {recentItems.length > 0 && (
            <div>
              <p class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.14em] m-0 mb-2">Recently used</p>
              <div class="grid grid-cols-8 gap-1.5">
                {recentItems.slice(0, 8).map((item) => (
                  <Thumb
                    key={`recent-${item.key}`}
                    item={item}
                    selected={draft === item.url}
                    onSelect={() => setDraft(item.url)}
                    onConfirm={confirm}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <div class="flex items-center justify-between mb-2">
              <p class="text-[10px] font-semibold text-fg-muted uppercase tracking-[0.14em] m-0">Library</p>
              <p class="text-[10px] text-fg-muted m-0">
                {items.length === 0 ? "No files yet" : `Newest first · ${items.length}`}
              </p>
            </div>
            {items.length === 0 ? (
              <button
                type="button"
                class={`w-full py-8 rounded-lg border-2 border-dashed text-fg-muted text-xs cursor-pointer ${
                  dragOver ? "border-accent bg-accent/10" : "border-border-mid hover:border-accent/50"
                }`}
                onClick={() => inputRef.current?.click()}
              >
                <Upload size={18} class="mx-auto mb-1" />
                {uploading ? "Uploading…" : "Upload or drop images"}
              </button>
            ) : (
              <div class="grid grid-cols-6 gap-1.5">
                {visible.map((item) => (
                  <Thumb
                    key={item.key}
                    item={item}
                    selected={draft === item.url}
                    onSelect={() => setDraft(item.url)}
                    onConfirm={confirm}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div class="px-4 py-3 border-t border-border-dim flex items-center gap-2">
          <div class="flex items-center gap-1 mr-auto">
            <button
              type="button"
              class="p-1 rounded-md border border-border-dim bg-surface-card text-fg-muted cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:border-accent hover:text-fg"
              disabled={safePage <= 0}
              onClick={() => setPage((n) => Math.max(0, n - 1))}
              title="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span class="text-[11px] text-fg-muted min-w-[4.5rem] text-center">
              {items.length === 0 ? "—" : `${safePage + 1} / ${pages}`}
            </span>
            <button
              type="button"
              class="p-1 rounded-md border border-border-dim bg-surface-card text-fg-muted cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:border-accent hover:text-fg"
              disabled={safePage >= pages - 1}
              onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
              title="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          <button
            type="button"
            data-picker-cancel
            class="px-3 py-1.5 rounded-md text-[11px] font-medium border border-border-dim bg-surface-card text-fg-secondary cursor-pointer hover:border-accent"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded-md text-[11px] font-medium border border-accent bg-accent/15 text-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!draft}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImagePickerField({
  kind,
  currentUrl,
  label = "Image",
  buttonLabel = "Choose image",
  title,
  confirmLabel,
  onPick,
}: {
  kind: ImagePickerKind;
  currentUrl?: string;
  label?: string;
  buttonLabel?: string;
  title?: string;
  confirmLabel?: string;
  onPick: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {label ? <label class="text-[11px] text-fg-muted mb-1 block">{label}</label> : null}
      <div class="w-full h-16 rounded-md border border-border-dim bg-surface-muted overflow-hidden mb-2 flex items-center justify-center">
        {currentUrl ? (
          <img src={currentUrl} alt="" class="w-full h-full object-contain" />
        ) : (
          <ImageIcon size={18} class="text-fg-muted" />
        )}
      </div>
      <button
        type="button"
        class="w-full flex items-center justify-center gap-2 p-2 rounded-lg bg-surface-card border border-border-dim cursor-pointer transition-all hover:border-accent hover:bg-accent/5"
        onClick={() => setOpen(true)}
      >
        <span class="text-[11px] text-fg-secondary">{buttonLabel}</span>
      </button>
      {open && (
        <ImagePickerDialog
          kind={kind}
          currentUrl={currentUrl}
          title={title || buttonLabel}
          confirmLabel={confirmLabel}
          onCancel={() => setOpen(false)}
          onConfirm={(url) => {
            setOpen(false);
            onPick(url);
          }}
        />
      )}
    </div>
  );
}
