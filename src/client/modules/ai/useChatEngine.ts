import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import type { JSX } from "preact";
import { listLlmModels, type LlmModel } from "../../lib/openai";
import { uploadImageFileMeta } from "../../lib/file-drop";
import { fileToDataUrl, type ChatMessage, type ImageAttachment, type ToolRunRecord } from "./types";
import { isMediaWriteTool, outputPathFromToolResult, pathToolFailed } from "./designTools";
import { streamTanitCompletion } from "./streamTanit";
import {
  listSessions,
  loadSession as loadSessionData,
  saveSession,
  deleteSession as deleteSessionData,
  generateSessionTitle,
  type ChatSession,
} from "./chatSessions";

const HISTORY_KEY = "opend-chat-prompt-history";
const MAX_HISTORY = 40;
const DEFAULT_MODEL = "quick";

function usePersisted<T>(key: string, defaultValue: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue];
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

function mediaApplyKey(run: ToolRunRecord): string | undefined {
  if (!isMediaWriteTool(run.name) || pathToolFailed(run.result)) return undefined;
  const result = run.result && typeof run.result === "object" ? (run.result as Record<string, unknown>) : {};
  if (result.pending) return undefined;
  return run.id || outputPathFromToolResult(run.result) || run.name;
}

async function applyHostMediaWrites(runs: ToolRunRecord[], seen: Set<string>) {
  for (const run of runs) {
    const key = mediaApplyKey(run);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      await fetch("/api/agent-tools/apply-media", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: run.name, arguments: run.arguments, result: run.result }),
      });
    } catch {
      seen.delete(key);
    }
  }
}

export function useChatEngine(namespace = "opend") {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [model, setModel] = usePersisted(`${namespace}-model`, DEFAULT_MODEL);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [llmReady, setLlmReady] = useState<boolean | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>(loadHistory);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const prepareTurnRef = useRef<(() => Promise<{ picturePaths?: string[] } | void> | { picturePaths?: string[] } | void) | null>(null);
  const onSceneToolsRef = useRef<((runs: ToolRunRecord[], seen: Set<string>) => void | Promise<void>) | null>(null);
  const isUserScrolledUpRef = useRef(false);

  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [sessions, setSessions] = useState(() => listSessions());
  const refreshSessions = useCallback(() => setSessions(listSessions()), []);

  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/ready");
      const body = await res.json().catch(() => ({}));
      setLlmReady(res.ok && body.ready !== false);
    } catch {
      setLlmReady(false);
    }
    const rows = await listLlmModels();
    setModels(rows);
    if (!rows.length) return;
    setModel((prev) => {
      if (rows.some((m) => m.id === prev)) return prev;
      return rows.find((m) => m.isDefault)?.id ?? rows[0].id;
    });
  }, [setModel]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    if (messages.length === 0) return;
    const clean = messages
      .filter((m) => !(m.role === "assistant" && !m.content && m.isStreaming))
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
    const session: ChatSession = {
      id: sessionId,
      title: generateSessionTitle(clean),
      createdAt: clean[0]?.timestamp || Date.now(),
      updatedAt: Date.now(),
      messages: clean,
    };
    saveSession(session);
    refreshSessions();
  }, [messages, sessionId, refreshSessions]);

  const addFilesAsAttachments = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const next: ImageAttachment[] = [];
    for (const file of imageFiles) {
      try {
        const url = await fileToDataUrl(file);
        const uploaded = await uploadImageFileMeta(file);
        next.push({
          id: crypto.randomUUID(),
          url,
          name: file.name,
          isLocal: true,
          src: uploaded?.key,
        });
      } catch (err) {
        console.error("Failed to read file:", err);
      }
    }
    setAttachments((prev) => [...prev, ...next]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleFileInputChange = useCallback(
    (e: JSX.TargetedEvent<HTMLInputElement>) => {
      const files = e.currentTarget.files;
      if (files) {
        void addFilesAsAttachments(Array.from(files));
        e.currentTarget.value = "";
      }
    },
    [addFilesAsAttachments],
  );

  const handlePaste = useCallback(
    (e: JSX.TargetedClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length) void addFilesAsAttachments(imageFiles);
    },
    [addFilesAsAttachments],
  );

  const handleDragEnter = useCallback((e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (composerRef.current && !composerRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    async (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer?.files) await addFilesAsAttachments(Array.from(e.dataTransfer.files));
    },
    [addFilesAsAttachments],
  );

  const buildApiMessages = useCallback((chatHistory: ChatMessage[], userMsg: ChatMessage) => {
    const apiMessages: any[] = [];
    for (const m of [...chatHistory, userMsg]) {
      if (m.role === "tool") continue;
      const hasImages = m.images && m.images.length > 0;
      if (hasImages) {
        const parts: any[] = [];
        if (m.content) parts.push({ type: "text", text: m.content });
        if (m.toolContext) parts.push({ type: "text", text: m.toolContext });
        for (const img of m.images!) {
          parts.push({ type: "image_url", image_url: { url: img.url } });
        }
        apiMessages.push({ role: m.role, content: parts });
      } else {
        const extras: string[] = [];
        if (m.toolContext) extras.push(m.toolContext);
        apiMessages.push({
          role: m.role,
          content: extras.length ? [m.content, ...extras].filter(Boolean).join("\n\n") : m.content,
        });
      }
    }
    return apiMessages;
  }, []);

  const runStreaming = useCallback(
    async (
      apiMessages: unknown[],
      assistantId: string,
      signal: AbortSignal,
      selection?: string[],
      onTools?: (runs: ToolRunRecord[]) => void,
    ) => {
      console.log("[Chat] stream start", {
        model,
        assistantId,
        messageCount: apiMessages.length,
        roles: apiMessages.map((m: { role?: string }) => m.role),
        selection: selection?.length ?? 0,
      });
      const started = performance.now();
      const out = await streamTanitCompletion({
        model,
        messages: apiMessages,
        sessionId,
        selection,
        signal,
        onUpdate: ({ text, toolRuns }) => {
          onTools?.(toolRuns);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: text, toolRuns: toolRuns.length ? toolRuns : undefined, isStreaming: true }
                : m,
            ),
          );
        },
      });
      onTools?.(out.toolRuns);
      console.log("[Chat] stream done", {
        model,
        chars: out.text.length,
        tools: out.toolRuns.length,
        finishReason: out.finishReason,
        ms: Math.round(performance.now() - started),
        tail: out.text.slice(-160),
      });
      return out;
    },
    [model, sessionId],
  );

  const sendMessage = useCallback(
    async (explicitText?: string) => {
      const textToUse = typeof explicitText === "string" ? explicitText : input;
      const trimmed = textToUse.trim();
      if ((!trimmed && attachments.length === 0) || isGenerating) return;

      console.log("[Chat] session", { sessionId, history: messages.length });
      if (trimmed) {
        setPromptHistory((prev) => {
          const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(0, MAX_HISTORY);
          persistHistory(next);
          return next;
        });
        setHistoryIndex(-1);
      }

      isUserScrolledUpRef.current = false;
      const msgImages = [...attachments];
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
        images: msgImages.length ? msgImages : undefined,
      };
      const assistantId = crypto.randomUUID();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setAttachments([]);
      setIsGenerating(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const extra = await prepareTurnRef.current?.();
        const picturePaths = extra && typeof extra === "object" ? extra.picturePaths : undefined;
        const apiMessages = buildApiMessages(messages, userMsg);
        console.log("[Chat] send", {
          model,
          history: messages.length,
          apiMessages: apiMessages.length,
          images: msgImages.length,
          picturePaths: picturePaths?.length ?? 0,
        });
        const appliedMedia = new Set<string>();
        const appliedScene = new Set<string>();
        const streamOut = await runStreaming(apiMessages, assistantId, abort.signal, picturePaths, (runs) => {
          void (async () => {
            await applyHostMediaWrites(runs, appliedMedia);
            await onSceneToolsRef.current?.(runs, appliedScene);
          })();
        });
        const text = streamOut?.text || "";
        const toolRuns = streamOut?.toolRuns ?? [];
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  isStreaming: false,
                  content: text,
                  toolRuns: toolRuns.length ? toolRuns : undefined,
                  hidden: !text.trim() && !toolRuns.length ? true : undefined,
                }
              : m,
          ),
        );
        setLlmReady(true);
      } catch (err: any) {
        if (err?.name === "AbortError" || String(err?.message || "").includes("aborted")) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content || "(cancelled)", isStreaming: false } : m,
            ),
          );
          return;
        }
        console.error("[Chat] Error:", err);
        setLlmReady(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${err?.message || "request failed"}`, isStreaming: false }
              : m,
          ),
        );
      } finally {
        abortRef.current = null;
        setIsGenerating(false);
        inputRef.current?.focus();
      }
    },
    [input, attachments, isGenerating, messages, sessionId, buildApiMessages, runStreaming],
  );

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    setAttachments([]);
    setInput("");
    setHistoryIndex(-1);
    setSessionId(crypto.randomUUID());
    isUserScrolledUpRef.current = false;
    inputRef.current?.focus();
  }, []);

  const handleLoadSession = useCallback((id: string) => {
    const session = loadSessionData(id);
    if (!session) return;
    setSessionId(session.id);
    const clean = session.messages
      .filter((m) => !(m.role === "assistant" && !m.content && m.isStreaming))
      .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m));
    setMessages(clean);
    setAttachments([]);
    setInput("");
    setHistoryIndex(-1);
    isUserScrolledUpRef.current = false;
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteSessionData(id);
      refreshSessions();
      if (id === sessionId) handleNewSession();
    },
    [sessionId, handleNewSession, refreshSessions],
  );

  const navigateHistory = useCallback(
    (dir: "up" | "down") => {
      if (!promptHistory.length) return;
      setHistoryIndex((idx) => {
        const next = dir === "up" ? Math.min(idx + 1, promptHistory.length - 1) : Math.max(idx - 1, -1);
        setInput(next < 0 ? "" : promptHistory[next] || "");
        return next;
      });
    },
    [promptHistory],
  );

  const handleKeyDown = useCallback(
    (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendMessage();
      } else if (e.key === "ArrowUp" && e.ctrlKey) {
        e.preventDefault();
        navigateHistory("up");
      } else if (e.key === "ArrowDown" && e.ctrlKey) {
        e.preventDefault();
        navigateHistory("down");
      }
    },
    [sendMessage, navigateHistory],
  );

  const canSend = Boolean((input.trim() || attachments.length > 0) && !isGenerating);

  return {
    messages,
    input,
    setInput,
    attachments,
    isDragging,
    model,
    setModel,
    models,
    refreshModels,
    isGenerating,
    llmReady,
    sessionId,
    sessions,
    scrollRef,
    inputRef,
    fileInputRef,
    composerRef,
    prepareTurnRef,
    onSceneToolsRef,
    promptHistory,
    historyIndex,
    navigateHistory,
    sendMessage,
    handleCancel,
    handleNewSession,
    handleLoadSession,
    handleDeleteSession,
    handleKeyDown,
    handlePaste,
    canSend,
    removeAttachment,
    handleFileInputChange,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isUserScrolledUpRef,
  };
}

export type ChatEngineAPI = ReturnType<typeof useChatEngine>;
