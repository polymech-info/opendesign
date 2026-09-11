import { useEffect, useRef } from "preact/hooks";
import { Bot, Plus } from "lucide-preact";
import type { ChatEngineAPI } from "./useChatEngine";
import { ChatComposer } from "./components/ChatComposer";
import { MessageBubble } from "./components/MessageBubble";
import { ModelSelector } from "./components/ModelSelector";

export function ChatMessages({ engine }: { engine: ChatEngineAPI }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = engine.scrollRef;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      engine.isUserScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight >= 50;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollContainerRef, engine.isUserScrolledUpRef]);

  useEffect(() => {
    if (!engine.isUserScrolledUpRef.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [engine.messages, engine.isUserScrolledUpRef]);

  return (
    <div class="h-full w-full min-h-0 flex flex-col">
      <div class="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-100 shrink-0">
        <select
          class="flex-1 min-w-0 text-[11px] px-1.5 py-1 rounded-md border border-zinc-200 bg-white text-zinc-600"
          value={engine.sessions.some((s) => s.id === engine.sessionId) ? engine.sessionId : ""}
          onChange={(e) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id) engine.handleLoadSession(id);
          }}
        >
          <option value="">{engine.messages.length ? "This chat" : "New chat"}</option>
          {engine.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="h-7 w-7 shrink-0 rounded-md border border-zinc-200 bg-white text-zinc-500 hover:text-accent hover:border-accent cursor-pointer"
          title="New chat"
          onClick={engine.handleNewSession}
        >
          <Plus size={14} />
        </button>
      </div>
      <div class="px-2 pb-1.5 border-b border-zinc-100 shrink-0">
        <ModelSelector
          models={engine.models}
          value={engine.model}
          onChange={engine.setModel}
          disabled={engine.isGenerating}
          onRefresh={() => void engine.refreshModels()}
        />
      </div>

      <div ref={scrollContainerRef} class="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2.5">
        {engine.messages.length === 0 ? (
          <div class="flex flex-col items-center justify-center h-full text-zinc-400 gap-2 px-3">
            <Bot size={28} class="opacity-30" />
            <p class="text-[12px] text-center m-0">Ask about this design</p>
            <p class="text-[10px] text-center m-0 opacity-70">
              {engine.llmReady === false
                ? "LLM server is not ready — OpenDesign will start tanit-cli --serve"
                : `${engine.model} · Enter to send`}
            </p>
          </div>
        ) : (
          engine.messages
            .filter((msg) => msg.role !== "tool")
            .map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onCancel={msg.isStreaming ? engine.handleCancel : undefined}
              />
            ))
        )}
        <div ref={bottomRef} class="h-1 shrink-0" />
      </div>

      <ChatComposer
        input={engine.input}
        onInputChange={engine.setInput}
        attachments={engine.attachments}
        isGenerating={engine.isGenerating}
        isDragging={engine.isDragging}
        canSend={engine.canSend}
        composerRef={engine.composerRef}
        inputRef={engine.inputRef}
        fileInputRef={engine.fileInputRef}
        onSend={() => void engine.sendMessage()}
        onCancel={engine.handleCancel}
        onKeyDown={engine.handleKeyDown}
        onPaste={engine.handlePaste}
        onRemoveAttachment={engine.removeAttachment}
        onFileInputChange={engine.handleFileInputChange}
        onDragEnter={engine.handleDragEnter}
        onDragLeave={engine.handleDragLeave}
        onDragOver={engine.handleDragOver}
        onDrop={engine.handleDrop}
        onOpenFilePicker={() => engine.fileInputRef.current?.click()}
      />
    </div>
  );
}
