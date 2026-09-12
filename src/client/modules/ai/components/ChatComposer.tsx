import { Send, Square, Paperclip, Upload, X, Loader2 } from "lucide-preact";
import type { JSX, RefObject } from "preact";
import type { ImageAttachment } from "../types";

interface ChatComposerProps {
  input: string;
  onInputChange: (v: string) => void;
  attachments: ImageAttachment[];
  isGenerating: boolean;
  isDragging: boolean;
  canSend: boolean;
  composerRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  onSend: () => void;
  onCancel: () => void;
  onKeyDown: (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: JSX.TargetedClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveAttachment: (id: string) => void;
  onFileInputChange: (e: JSX.TargetedEvent<HTMLInputElement>) => void;
  onDragEnter: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDragOver: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onDrop: (e: JSX.TargetedDragEvent<HTMLDivElement>) => void;
  onOpenFilePicker: () => void;
}

export function ChatComposer({
  input,
  onInputChange,
  attachments,
  isGenerating,
  isDragging,
  canSend,
  composerRef,
  inputRef,
  fileInputRef,
  onSend,
  onCancel,
  onKeyDown,
  onPaste,
  onRemoveAttachment,
  onFileInputChange,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onOpenFilePicker,
}: ChatComposerProps) {
  return (
    <div
      ref={composerRef}
      class={`border-t border-zinc-200 p-2 flex flex-col shrink-0 relative ${isDragging ? "bg-accent/5" : ""}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isDragging ? (
        <div class="absolute inset-0 bg-accent/10 flex items-center justify-center z-10 pointer-events-none border-2 border-dashed border-accent">
          <div class="flex items-center gap-1.5 text-accent text-[11px] font-medium">
            <Upload size={14} />
            Drop images
          </div>
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div class="flex gap-1.5 mb-2 flex-wrap">
          {attachments.map((att) => (
            <div key={att.id} class="relative w-12 h-12 rounded-md overflow-hidden border border-zinc-200 group">
              <img src={att.url} alt={att.name} class="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveAttachment(att.id)}
                class="absolute top-0.5 right-0.5 p-0.5 bg-black/60 text-white rounded-full border-none cursor-pointer opacity-0 group-hover:opacity-100"
                title="Remove"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div class="flex gap-1.5 items-end">
        {isGenerating ? (
          <div class="h-8 w-8 shrink-0 flex items-center justify-center" title="Agent working…">
            <Loader2 size={16} class="animate-spin text-accent" />
          </div>
        ) : null}
        <button
          type="button"
          class="h-8 w-8 shrink-0 rounded-md border-none bg-transparent text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 cursor-pointer"
          onClick={onOpenFilePicker}
          disabled={isGenerating}
          title="Attach image"
        >
          <Paperclip size={16} />
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={onFileInputChange}
        />

        <textarea
          ref={inputRef}
          value={input}
          onInput={(e) => onInputChange((e.target as HTMLTextAreaElement).value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Message… Enter to send"
          rows={2}
          class="flex-1 min-h-[40px] max-h-[120px] resize-none text-[12px] leading-relaxed px-2 py-1.5 rounded-md border border-zinc-200 bg-white text-zinc-800 outline-none focus:border-accent"
          disabled={isGenerating}
        />

        {isGenerating ? (
          <button
            type="button"
            onClick={onCancel}
            class="h-8 w-8 shrink-0 rounded-md border-none bg-red-500 text-white cursor-pointer hover:bg-red-600"
            title="Cancel"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            class="h-8 w-8 shrink-0 rounded-md border-none bg-accent text-white cursor-pointer hover:bg-accent-hover disabled:opacity-40 disabled:cursor-default"
            title="Send"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
