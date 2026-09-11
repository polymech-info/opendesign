import { useState, useRef, useCallback, useEffect } from "preact/hooks";
import type { JSX } from "preact";
import type OpenAI from "openai";
import { createOpenAIClient, listLlmModels, type LlmModel } from "../../lib/openai";
import { fileToDataUrl, type ChatMessage, type ImageAttachment } from "./types";
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
  const extraToolsRef = useRef<(() => any[]) | null>(null);
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
        next.push({
          id: crypto.randomUUID(),
          url: await fileToDataUrl(file),
          name: file.name,
          isLocal: true,
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
      } else if (m.toolContext) {
        apiMessages.push({ role: m.role, content: m.content + "\n\n" + m.toolContext });
      } else {
        apiMessages.push({ role: m.role, content: m.content });
      }
    }
    return apiMessages;
  }, []);

  const collectTools = useCallback(() => {
    const extra = extraToolsRef.current?.();
    return extra?.length ? extra : [];
  }, []);

  const runWithTools = useCallback(
    async (client: OpenAI, apiMessages: any[], allTools: any[], assistantId: string) => {
      const runner = client.chat.completions.runTools({ model, messages: apiMessages, tools: allTools });
      runner.on("functionToolCall", (fnCall: any) => {
        let argsDisplay = fnCall.arguments;
        try {
          const parsed = JSON.parse(fnCall.arguments);
          argsDisplay = Object.entries(parsed)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ");
        } catch {
          /* raw */
        }
        const toolMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "tool",
          content: `Calling ${fnCall.name}(${argsDisplay})`,
          timestamp: Date.now(),
          toolName: fnCall.name,
        };
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === assistantId);
          if (idx === -1) return [...prev, toolMsg];
          return [...prev.slice(0, idx), toolMsg, ...prev.slice(idx)];
        });
      });
      await runner.done();
      const finalContent = (await runner.finalContent()) || "";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: finalContent, isStreaming: false } : m)),
      );
    },
    [model],
  );

  const runStreaming = useCallback(
    async (client: OpenAI, apiMessages: any[], assistantId: string, signal: AbortSignal) => {
      const baseURL = (client as any).baseURL ?? (client as any)._baseURL;
      console.log("[Chat] stream start", {
        model,
        baseURL,
        assistantId,
        messageCount: apiMessages.length,
        roles: apiMessages.map((m: any) => m.role),
      });
      const started = performance.now();
      let stream;
      try {
        stream = await client.chat.completions.create(
          { model, messages: apiMessages, stream: true },
          { signal },
        );
      } catch (err) {
        console.error("[Chat] stream create failed", { model, baseURL, err });
        throw err;
      }
      console.log("[Chat] stream opened", { model, ms: Math.round(performance.now() - started) });

      let fullContent = "";
      let chunkIndex = 0;
      try {
        for await (const chunk of stream) {
          chunkIndex += 1;
          const choices = chunk?.choices;
          const choice = Array.isArray(choices) ? choices[0] : undefined;
          const delta = choice?.delta?.content || "";
          const odd = !Array.isArray(choices) || choices.length === 0;
          if (odd || chunkIndex <= 3) {
            console.log("[Chat] stream chunk", {
              n: chunkIndex,
              id: chunk?.id,
              object: (chunk as any)?.object,
              model: chunk?.model,
              choicesLen: Array.isArray(choices) ? choices.length : choices,
              finish: choice?.finish_reason,
              deltaLen: delta.length,
              keys: chunk && typeof chunk === "object" ? Object.keys(chunk) : typeof chunk,
              raw: odd ? chunk : undefined,
            });
          }
          if (delta) {
            fullContent += delta;
            const snapshot = fullContent;
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)));
          }
        }
      } catch (err) {
        console.error("[Chat] stream iterate failed", {
          model,
          chunks: chunkIndex,
          chars: fullContent.length,
          err,
        });
        throw err;
      }
      console.log("[Chat] stream done", {
        model,
        chunks: chunkIndex,
        chars: fullContent.length,
        ms: Math.round(performance.now() - started),
      });
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
    },
    [model],
  );

  const sendMessage = useCallback(
    async (explicitText?: string) => {
      const textToUse = typeof explicitText === "string" ? explicitText : input;
      const trimmed = textToUse.trim();
      if ((!trimmed && attachments.length === 0) || isGenerating) return;

      const client = createOpenAIClient({ sessionId });
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
        const apiMessages = buildApiMessages(messages, userMsg);
        const tools = collectTools();
        console.log("[Chat] send", {
          model,
          history: messages.length,
          apiMessages: apiMessages.length,
          images: msgImages.length,
          tools: tools.map((t: any) => t?.function?.name ?? t?.name).filter(Boolean),
        });
        if (tools.length) await runWithTools(client, apiMessages, tools, assistantId);
        else await runStreaming(client, apiMessages, assistantId, abort.signal);
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
    [input, attachments, isGenerating, messages, sessionId, buildApiMessages, collectTools, runWithTools, runStreaming],
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
    extraToolsRef,
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
