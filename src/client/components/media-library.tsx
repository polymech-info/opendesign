import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Trash2, Upload } from "lucide-preact";
import {
  acceptFileDrag,
  imageFilesFromDataTransfer,
  isImageFile,
  uploadImageFile,
  type UploadKind,
} from "../lib/file-drop";

export type MediaKind = "images" | "backgrounds";

interface MediaItem {
  key: string;
  filename: string;
  url: string;
}

interface Props {
  kind: MediaKind;
  onPick: (url: string) => void;
  compact?: boolean;
}

export function MediaLibrary({ kind, onPick, compact }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef(0);

  const refresh = useCallback(async () => {
    const resp = await fetch(`/api/uploads?kind=${kind}`);
    const data = await resp.json();
    setItems(data.items ?? []);
  }, [kind]);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("opend-uploads-changed", onChanged);
    return () => window.removeEventListener("opend-uploads-changed", onChanged);
  }, [refresh]);

  const upload = useCallback(
    async (files: File[] | FileList | null) => {
      const list = files ? Array.from(files).filter(isImageFile) : [];
      if (!list.length) return;
      setUploading(true);
      try {
        for (const file of list) {
          const url = await uploadImageFile(file, kind as UploadKind);
          if (url) onPick(url);
        }
        await refresh();
      } catch (e) {
        console.error("Upload failed:", e);
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [kind, onPick, refresh]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const enter = (e: DragEvent) => {
      if (!acceptFileDrag(e)) return;
      depthRef.current += 1;
      setDragOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!acceptFileDrag(e)) return;
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (!depthRef.current) setDragOver(false);
    };
    const over = (e: DragEvent) => {
      acceptFileDrag(e);
    };
    const drop = (e: DragEvent) => {
      if (!acceptFileDrag(e)) return;
      depthRef.current = 0;
      setDragOver(false);
      void upload(imageFilesFromDataTransfer(e.dataTransfer));
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragleave", leave);
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
    };
  }, [upload]);

  const remove = useCallback(
    async (item: MediaItem, e: Event) => {
      e.stopPropagation();
      await fetch(`/api/uploads/file/${item.key}`, { method: "DELETE" });
      await refresh();
    },
    [refresh]
  );

  return (
    <div
      ref={rootRef}
      class={`rounded-lg transition-all ${dragOver ? "ring-2 ring-accent bg-accent/5" : ""}`}
    >
      <div
        class={`border-2 border-dashed rounded-lg text-center cursor-pointer transition-all mb-3 ${
          compact ? "p-2" : "p-4"
        } ${
          dragOver
            ? "border-accent bg-accent/10"
            : "border-zinc-300 hover:border-accent/50 hover:bg-accent/5"
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={compact ? 14 : 20} class="text-zinc-400 mx-auto mb-1" />
        <p class="text-xs text-zinc-400">
          {uploading ? "Uploading..." : compact ? "Upload, drop, or pick" : "Click or drop images here"}
        </p>
        {!compact && <p class="text-[10px] text-zinc-500 mt-0.5">PNG, JPG, SVG, WebP — from Explorer too</p>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={kind === "images"}
        class="hidden"
        onChange={(e) => void upload((e.target as HTMLInputElement).files)}
      />

      {items.length === 0 ? (
        <p class="text-zinc-400 text-[11px]">No files yet. Uploads are kept for reuse.</p>
      ) : (
        <div class={`grid gap-1.5 ${compact ? "grid-cols-3 max-h-[240px] overflow-y-auto" : "grid-cols-2"}`}>
          {items.map((item) => (
            <div key={item.key} class="group relative rounded-md overflow-hidden border border-zinc-200 bg-zinc-50">
              <button
                class="block w-full aspect-square p-0 border-none cursor-pointer bg-zinc-100"
                onClick={() => onPick(item.url)}
                title="Use this image"
              >
                <img src={item.url} alt={item.filename} class="w-full h-full object-cover" />
              </button>
              <button
                class="absolute top-1 right-1 p-0.5 rounded bg-white/90 border border-zinc-200 text-zinc-400 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
                onClick={(e) => void remove(item, e)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
