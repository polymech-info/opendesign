import { messagesForDisplay } from "./chatTurns";
import type { ChatMessage, ToolRunRecord } from "./types";

function formatJson(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatToolRunsMarkdown(runs: ToolRunRecord[]): string {
  if (!runs.length) return "";
  const lines = ["", "## Tool calls"];
  for (const run of runs) {
    lines.push(
      "",
      `### ${run.name}`,
      "",
      "**arguments**",
      "",
      "```json",
      formatJson(run.arguments),
      "```",
      "",
      "**result**",
      "",
      "```json",
      formatJson(run.result),
      "```",
    );
  }
  return lines.join("\n");
}

export function formatMessageMarkdown(msg: ChatMessage): string {
  const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "Tool";
  const lines = [`## ${role}`];
  if (msg.content.trim()) {
    lines.push("", msg.content.trim());
  }
  if (msg.toolRuns?.length) lines.push(formatToolRunsMarkdown(msg.toolRuns));
  if (msg.images?.length) lines.push("", `*${msg.images.length} image(s) attached*`);
  return lines.join("\n");
}

/** Full chat transcript as Markdown (includes tool calls on assistant turns). */
export function formatChatTranscript(messages: ChatMessage[]): string {
  return messagesForDisplay(messages)
    .filter(
      (m) =>
        m.role !== "tool" &&
        (m.content.trim().length > 0 || (m.toolRuns?.length ?? 0) > 0 || (m.images?.length ?? 0) > 0),
    )
    .map((m) => formatMessageMarkdown(m))
    .join("\n\n---\n\n")
    .trim();
}

/** Single bubble copy text — prose plus tool calls when present. */
export function formatMessageCopyText(msg: ChatMessage): string {
  const parts: string[] = [];
  if (msg.content.trim()) parts.push(msg.content.trim());
  if (msg.toolRuns?.length) parts.push(formatToolRunsMarkdown(msg.toolRuns));
  return parts.join("\n\n").trim();
}
