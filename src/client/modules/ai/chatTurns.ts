import type { ChatMessage, ToolRunRecord } from "./types";

/** Attach legacy `role: tool` rows to the following assistant message for display. */
export function messagesForDisplay(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.hidden || msg.role === "tool") continue;
    if (msg.role === "assistant" && !msg.toolRuns?.length) {
      const prev = messages[i - 1];
      if (prev?.role === "tool") {
        const legacy: ToolRunRecord[] = (prev.toolName ?? "design_tool")
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({
            name,
            arguments: {},
            result: prev.content,
          }));
        out.push({ ...msg, toolRuns: legacy.length ? legacy : undefined });
        continue;
      }
    }
    out.push(msg);
  }
  return out;
}
