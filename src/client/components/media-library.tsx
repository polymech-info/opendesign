import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Upload } from "lucide-preact";
import {
  acceptFileDrag,
  imageFilesFromDataTransfer,
  isImageFile,
  uploadImageFile,
  type UploadKind,
} from "../lib/file-drop";
import { rememberRecentUpload } from "../lib/recent-uploads";
import type { ImagePickerItem, ImagePickerKind } from "./image-picker";

const PAGE_SIZE = 12;
const COMPACT_PAGE_SIZE = 16;

interface Props {
  kind: ImagePickerKind;
  onPick: (url: string) => void;
  currentUrl?: string;
  compact?: boolean;
}

export function MediaLibrary({ kind, onPick, currentUrl, compact }: Props) {
  const [items, setItems] = useState<ImagePickerItem[]>([]);
  const [page, setPage] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depthRef = useRef(0);
  const pageSize = compact ? COMPACT_PAGE_SIZE : PAGE_SIZE;

  const refresh = useCallback(async () => {
    const resp = await fetch(`/api/uploads?kind=${kind}`);
    const data = (await resp.json()) as { items?: ImagePickerItem[] };
    const next = [...(data.items ?? [])].sort(
      (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0) || b.filename.localeCompare(a.filename)
    );
    setItems(next);
  }, [kind]);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener("opend-uploads-changed", onChange);
    return () => window.removeEventListener("opend-uploads-changed", onChange);
  }, [refresh]);

  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const visible = items.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const pick = useCallback(
    (url: string) => {
      rememberRecentUpload(kind, url);
      onPick(url);
    },
    [kind, onPick]
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
        setPage(0);
        if (last) pick(last);
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kind, pick, refresh]
  );

  return (
    <div
      class={dragOver ? "rounded-lg ring-2 ring-accent ring-inset" : ""}
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
      <div class="flex items-center justify-between mb-2">
        <p class="text-[10px] text-fg-muted m-0">
          {items.length === 0 ? "No files yet" : `Newest first · ${items.length}`}
        </p>
        <button
          type="button"
          class="text-[10px] text-fg-muted bg-transparent border border-dashed border-border-mid rounded-md px-1.5 py-0.5 cursor-pointer hover:border-accent hover:text-fg"
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
        <div class={`grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-3"}`}>
          {visible.map((item) => {
            const selected = currentUrl === item.url;
            return (
              <button
                key={item.key}
                type="button"
                class={`relative aspect-square rounded-md overflow-hidden border p-0 cursor-pointer bg-surface-muted ${
                  selected ? "border-accent ring-2 ring-accent/40" : "border-border-dim hover:border-accent"
                }`}
                title={item.filename}
                onClick={() => pick(item.url)}
              >
                <img src={item.url} alt={item.filename} class="w-full h-full object-cover" loading="lazy" decoding="async" />
              </button>
            );
          })}
        </div>
      )}

      {pages > 1 && (
        <div class="flex items-center justify-between mt-2">
          <button
            type="button"
            class="p-1 rounded border border-border-dim bg-surface-card cursor-pointer disabled:opacity-30"
            disabled={safePage <= 0}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span class="text-[10px] text-fg-muted font-mono">
            {safePage + 1} / {pages}
          </span>
          <button
            type="button"
            class="p-1 rounded border border-border-dim bg-surface-card cursor-pointer disabled:opacity-30"
            disabled={safePage >= pages - 1}
            onClick={() => setPage((n) => Math.min(pages - 1, n + 1))}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
