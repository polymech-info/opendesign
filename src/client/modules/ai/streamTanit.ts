import { llmBaseURL } from "../../lib/openai";
import { appendStreamDelta, dedupeRepeatedContent } from "./streamText";
import type { ToolRunRecord } from "./types";

export type SseFrame = { event: string; data: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Split complete SSE frames; leave a partial tail in `rest`. */
export function consumeSseBuffer(buffer: string): { rest: string; frames: SseFrame[] } {
  const frames: SseFrame[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  for (;;) {
    const split = rest.indexOf("\n\n");
    if (split < 0) break;
    const raw = rest.slice(0, split);
    rest = rest.slice(split + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join("\n") });
  }
  return { rest, frames };
}

/** Tanit wraps `{ id, arguments }` as `arguments` on `tanit.tool_call`. */
export function unwrapTanitToolCall(data: Record<string, unknown>): ToolRunRecord {
  const name = str(data.name) || "tool";
  const box = asRecord(data.arguments);
  const id = str(box.id) || str(data.id);
  const inner = box.arguments;
  const args =
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? asRecord(inner)
      : str(box.id) || "arguments" in box
        ? {}
        : box;
  return { id, name, arguments: args, result: { pending: true } };
}

export function applyTanitToolResult(runs: ToolRunRecord[], data: Record<string, unknown>): ToolRunRecord[] {
  const name = str(data.name);
  const id = str(data.id) || str(asRecord(data.arguments).id);
  const result = data.result ?? data.envelope ?? data;
  const next = runs.map((run) => ({ ...run }));
  const idx = next.findIndex((run) => (id && run.id === id) || (name && run.name === name && run.result && asRecord(run.result).pending));
  let pick = idx;
  if (pick < 0 && name) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i]!.name === name) {
        pick = i;
        break;
      }
    }
  }
  if (pick >= 0) {
    next[pick] = { ...next[pick], result };
    return next;
  }
  return [...next, { id, name: name || "tool", arguments: {}, result }];
}

export function applySseFrame(
  frame: SseFrame,
  state: { text: string; finishReason: string | null; toolRuns: ToolRunRecord[] },
): { text: string; finishReason: string | null; toolRuns: ToolRunRecord[] } {
  if (frame.data === "[DONE]") return state;
  let data: Record<string, unknown>;
  try {
    data = asRecord(JSON.parse(frame.data));
  } catch {
    return state;
  }
  const event = frame.event.startsWith("tanit.") ? frame.event.slice(6) : str(data.type) || frame.event;
  if (event === "tool_call") {
    return { ...state, toolRuns: [...state.toolRuns, unwrapTanitToolCall(data)] };
  }
  if (event === "tool_result") {
    return { ...state, toolRuns: applyTanitToolResult(state.toolRuns, data) };
  }
  if (data.object === "chat.completion.chunk") {
    const choice = Array.isArray(data.choices) ? asRecord(data.choices[0]) : {};
    const delta = asRecord(choice.delta);
    const piece = typeof delta.content === "string" ? delta.content : "";
    const finish = choice.finish_reason == null ? state.finishReason : String(choice.finish_reason);
    return {
      ...state,
      text: piece ? appendStreamDelta(state.text, piece) : state.text,
      finishReason: finish,
    };
  }
  return state;
}

export function tanitCompletionBody(opts: {
  model: string;
  messages: unknown[];
  selection?: string[];
}): Record<string, unknown> {
  const selection = (opts.selection ?? []).map((p) => p.trim()).filter(Boolean);
  return {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    max_tokens: 4096,
    ...(selection.length ? { tanit: { selection } } : {}),
  };
}

export async function streamTanitCompletion(opts: {
  model: string;
  messages: unknown[];
  sessionId?: string;
  selection?: string[];
  signal?: AbortSignal;
  onUpdate?: (state: { text: string; toolRuns: ToolRunRecord[] }) => void;
}): Promise<{ text: string; finishReason: string | null; toolRuns: ToolRunRecord[] }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "text/event-stream",
  };
  if (opts.sessionId) headers["X-Tanit-Session"] = opts.sessionId;
  const res = await fetch(`${llmBaseURL()}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(tanitCompletionBody(opts)),
    signal: opts.signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail.slice(0, 240) || `LLM HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("LLM stream had no body");

  let state = { text: "", finishReason: null as string | null, toolRuns: [] as ToolRunRecord[] };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { rest, frames } = consumeSseBuffer(buffer);
    buffer = rest;
    let changed = false;
    for (const frame of frames) {
      const next = applySseFrame(frame, state);
      if (next !== state) {
        state = next;
        changed = true;
      }
    }
    if (changed) opts.onUpdate?.({ text: state.text, toolRuns: state.toolRuns });
  }
  return {
    text: dedupeRepeatedContent(state.text),
    finishReason: state.finishReason,
    toolRuns: state.toolRuns,
  };
}
