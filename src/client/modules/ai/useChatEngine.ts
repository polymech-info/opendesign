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
import {
  assistantDisplayText,
  dedupeToolCalls,
  describeDesignToolJsonIssues,
  looksTruncatedDesignToolJson,
  countEmittedJsonObjects,
  parseEmittedToolCalls,
  screenshotResultForLog,
  shouldWarnDesignResponseTruncation,
  stripDesignToolJsonFromText,
  toolFollowUpFromRuns,
} from "./designTools";
import { appendStreamDelta, dedupeRepeatedContent } from "./streamText";
import type { ToolRunRecord } from "./types";
import type { ToolCall } from "./designTools";

export type DesignToolRunContext = {
  sessionId: string;
  messageId: string;
  finishReason: string | null;
  parsedCalls: ToolCall[];
  jsonObjectCount: number;
};

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
  const designContextRef = useRef<(() => string | null) | null>(null);
  const runDesignToolsRef = useRef<
    ((
      text: string,
      ctx: DesignToolRunContext,
    ) => Promise<Array<{ name: string; result: unknown }>> | Array<{ name: string; result: unknown }>) | null
  >(null);
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
    const brief = designContextRef.current?.();
    if (brief) apiMessages.push({ role: "system", content: brief });
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
        if (m.toolRuns?.length) {
          extras.push(m.toolRuns.map((r) => JSON.stringify({ name: r.name, result: r.result })).join("\n"));
        }
        apiMessages.push({
          role: m.role,
          content: extras.length ? [m.content, ...extras].filter(Boolean).join("\n\n") : m.content,
        });
      }
    }
    return apiMessages;
  }, []);

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
          { model, messages: apiMessages, stream: true, max_tokens: 4096 },
          { signal },
        );
      } catch (err) {
        console.error("[Chat] stream create failed", { model, baseURL, err });
        throw err;
      }
      console.log("[Chat] stream opened", { model, ms: Math.round(performance.now() - started) });

      let fullContent = "";
      let chunkIndex = 0;
      let finishReason: string | null = null;
      try {
        for await (const chunk of stream) {
          chunkIndex += 1;
          const choices = chunk?.choices;
          const choice = Array.isArray(choices) ? choices[0] : undefined;
          if (choice?.finish_reason) finishReason = String(choice.finish_reason);
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
            fullContent = appendStreamDelta(fullContent, delta);
            const display = stripDesignToolJsonFromText(fullContent);
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: display, isStreaming: true } : m)),
            );
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
        finishReason,
        ms: Math.round(performance.now() - started),
        tail: fullContent.slice(-160),
      });
      fullContent = dedupeRepeatedContent(fullContent);
      return { text: fullContent, finishReason };
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
        const brief = typeof apiMessages[0]?.content === "string" && apiMessages[0]?.role === "system";
        console.log("[Chat] send", {
          model,
          history: messages.length,
          apiMessages: apiMessages.length,
          images: msgImages.length,
          designBrief: brief,
        });
        // --serve ignores client tools[]; stream, then host-run any JSON tool_calls.
        const historyForApi: ChatMessage[] = [...messages, userMsg];
        const finishStream = async (
          streamText: string,
          finishReason: string | null,
          currentAssistantId: string,
          prior: ChatMessage[],
          followFlags: { canFollowShot: boolean; canFollowUnderstand: boolean },
        ): Promise<void> => {
          const text = streamText || "";
          const parsedCalls = parseEmittedToolCalls(text);
          const ran =
            (await runDesignToolsRef.current?.(text, {
              sessionId,
              messageId: currentAssistantId,
              finishReason,
              parsedCalls,
              jsonObjectCount: countEmittedJsonObjects(text),
            })) ?? [];
          const truncatedJson = looksTruncatedDesignToolJson(text);
          const jsonIssues = describeDesignToolJsonIssues(text);
          const warnTruncation = shouldWarnDesignResponseTruncation({
            truncatedJson,
            finishReason,
            runs: ran,
            parsedCount: parsedCalls.length,
          });
          const toolCalls = dedupeToolCalls(parsedCalls).filter((c) => c.name !== "done");
          const usedRuns = new Set<number>();
          const toolRuns: ToolRunRecord[] = toolCalls.map((call) => {
            let idx = ran.findIndex((row, i) => !usedRuns.has(i) && row.name === call.name);
            if (idx < 0 && (call.name === "image_create" || call.name === "image_transform")) {
              idx = ran.findIndex(
                (row, i) =>
                  !usedRuns.has(i) &&
                  (row.name === "design_update" ||
                    row.name === "design_set_page_background" ||
                    row.name === "design_insert_image"),
              );
            }
            if (idx >= 0) usedRuns.add(idx);
            return {
              name: call.name,
              arguments: call.arguments,
              result: idx >= 0 ? screenshotResultForLog(call.name, ran[idx].result) : { ok: false, error: "not run" },
            };
          });
          const hadDesignJson = /design_[a-z_]+/i.test(text);
          console.log("[Chat] design tools", {
            finishReason,
            chars: text.length,
            truncatedJson,
            warnTruncation,
            jsonIssues,
            parsed: parsedCalls.map((c) => c.name),
            ran: ran.map((r) => ({ name: r.name, ok: (r.result as { ok?: boolean })?.ok })),
            tail: text.slice(-200),
          });
          if (truncatedJson && !warnTruncation) {
            console.warn("[Chat] trailing design JSON after successful tool run (not shown to user)", {
              jsonIssues,
            });
          }
          const display = assistantDisplayText(text, ran, {
            truncated: warnTruncation,
            parseFailed: hadDesignJson && !parsedCalls.length,
          });
          const assistantDone: ChatMessage = {
            id: currentAssistantId,
            role: "assistant",
            content: display,
            timestamp: Date.now(),
            toolRuns: toolRuns.length ? toolRuns : undefined,
          };

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== currentAssistantId) return m;
              return { ...m, isStreaming: false, content: display, toolRuns: toolRuns.length ? toolRuns : undefined };
            }),
          );

          if (!parsedCalls.length && /design_[a-z_]+/i.test(text)) {
            console.warn("[Chat] assistant emitted design tool JSON but host parsed 0 calls", {
              text: text.slice(0, 240),
            });
          }

          const follow = toolFollowUpFromRuns(ran, followFlags);
          if (!follow || abort.signal.aborted) return;

          const followUser: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: follow.content,
            timestamp: Date.now(),
            hidden: true,
          };
          const followAssistantId = crypto.randomUUID();
          const followAssistant: ChatMessage = {
            id: followAssistantId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          };
          setMessages((prev) => [...prev, followUser, followAssistant]);
          const nextPrior = [...prior, assistantDone];
          const nextApi = buildApiMessages(nextPrior, followUser);
          const followOut = await runStreaming(client, nextApi, followAssistantId, abort.signal);
          await finishStream(followOut?.text || "", followOut?.finishReason ?? null, followAssistantId, [...nextPrior, followUser], {
            canFollowShot: false,
            canFollowUnderstand: follow.kind === "screenshot",
          });
        };

        const streamOut = await runStreaming(client, apiMessages, assistantId, abort.signal);
        await finishStream(streamOut?.text || "", streamOut?.finishReason ?? null, assistantId, historyForApi, {
          canFollowShot: true,
          canFollowUnderstand: true,
        });
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
    extraToolsRef,
    designContextRef,
    runDesignToolsRef,
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
