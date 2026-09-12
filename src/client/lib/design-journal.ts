import type { DesignDocSnapshot } from "../../design/journal-snapshot";

export type ClientJournalEntry = {
  phase: "chat-turn" | "parse" | "tool-run" | "apply" | "note";
  sessionId?: string;
  messageId?: string;
  designId?: string;
  pageId?: string;
  selection?: { id?: string; srcKey?: string };
  stream?: { chars?: number; finishReason?: string | null; textTail?: string };
  parsed?: Array<{ name: string; arguments: Record<string, unknown> }>;
  ran?: Array<{ name: string; ok?: boolean; result?: unknown }>;
  apply?: { mode?: string; plan?: unknown; patched?: boolean };
  docBefore?: DesignDocSnapshot | null;
  docAfter?: DesignDocSnapshot | null;
  notes?: string[];
};

export function postDesignJournal(entry: ClientJournalEntry): void {
  void fetch("/api/design/journal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entry),
  }).catch((err) => {
    console.warn("[design-journal] post failed", err);
  });
}
