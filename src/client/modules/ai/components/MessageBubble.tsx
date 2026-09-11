import { useState, useCallback } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Bot, User, Wrench, Loader2, Copy, Check, StopCircle } from "lucide-preact";
import type { ChatMessage } from "../types";
import { MarkdownRenderer, unescapeMarkdown } from "./MarkdownRenderer";

const URL_REGEX = /(https?:\/\/[^\s<>"')\]]+)/g;
const URL_TEST = /^https?:\/\//;
const IMG_TEST = /\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|$)|\/api\/images\/render\?/i;

function linkifyContent(text: string): ComponentChildren {
  const parts = text.split(URL_REGEX);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (!URL_TEST.test(part)) return part;
    if (IMG_TEST.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" class="inline-block my-1">
          <img
            src={part}
            alt="image"
            class="rounded-md border border-black/10 max-w-[200px] max-h-[200px] object-cover"
            loading="lazy"
          />
        </a>
      );
    }
    return (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 break-all">
        {part}
      </a>
    );
  });
}

export function MessageBubble({ message, onCancel }: { message: ChatMessage; onCancel?: () => void }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!message.content) return;
    void navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  return (
    <div class={`flex gap-2 min-w-0 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        class={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
          isUser ? "bg-accent text-white" : isTool ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"
        }`}
      >
        {isUser ? <User size={12} /> : isTool ? <Wrench size={12} /> : <Bot size={12} />}
      </div>

      <div
        class={`relative group rounded-xl px-2.5 py-2 min-w-0 ${
          isUser
            ? "max-w-[90%] bg-accent text-white rounded-br-sm"
            : isTool
              ? "max-w-[95%] bg-amber-50 border border-amber-200 rounded-bl-sm"
              : "max-w-[95%] bg-zinc-100 text-zinc-800 rounded-bl-sm"
        }`}
      >
        {message.content ? (
          <button
            type="button"
            onClick={handleCopy}
            class={`absolute top-1 right-1 p-0.5 rounded border-none cursor-pointer opacity-0 group-hover:opacity-100 ${
              isUser ? "bg-white/15 text-white" : "bg-white text-zinc-500"
            }`}
            title="Copy"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        ) : null}

        {isTool && message.toolName ? (
          <div class="text-[10px] font-semibold mb-1 opacity-70">{message.toolName}</div>
        ) : null}

        {message.images && message.images.length > 0 ? (
          <div class="flex gap-1.5 mb-1.5 flex-wrap">
            {message.images.map((img) => (
              <img
                key={img.id}
                src={img.url}
                alt={img.name}
                class="rounded-md object-cover border border-black/10"
                style={{
                  width: message.images!.length === 1 ? 160 : 64,
                  height: message.images!.length === 1 ? 160 : 64,
                }}
              />
            ))}
          </div>
        ) : null}

        <div class={`text-[12px] leading-relaxed break-words min-w-0 ${isUser ? "whitespace-pre-wrap" : ""}`}>
          {message.content ? (
            isUser ? (
              <span class="whitespace-pre-wrap">{linkifyContent(message.content)}</span>
            ) : (
              <MarkdownRenderer content={unescapeMarkdown(message.content)} />
            )
          ) : (
            <span class={`inline-flex items-center gap-1.5 ${isUser ? "text-white/80" : "text-zinc-400"}`}>
              <Loader2 size={12} class="animate-spin" />
              Thinking…
              {onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  class="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border-none bg-transparent cursor-pointer hover:text-red-600"
                >
                  <StopCircle size={10} /> Stop
                </button>
              ) : null}
            </span>
          )}
        </div>

        {message.isStreaming && message.content ? (
          <div class="flex items-center gap-1 mt-0.5">
            <span class="inline-block w-1.5 h-3 bg-current opacity-50 animate-pulse" />
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                class="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border-none bg-transparent cursor-pointer text-zinc-400 hover:text-red-600"
              >
                <StopCircle size={10} /> Stop
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
