import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Roots } from "./paths.js";
import { layerRoot } from "./paths.js";

export type DesignJournalEntry = {
  id: string;
  ts: string;
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
  docBefore?: unknown;
  docAfter?: unknown;
  notes?: string[];
};

function journalPath(roots: Roots) {
  return path.join(layerRoot(roots, "project"), "journal", "design-changes.jsonl");
}

function ensureJournalDir(roots: Roots) {
  fs.mkdirSync(path.dirname(journalPath(roots)), { recursive: true });
}

export function appendDesignJournal(roots: Roots, entry: Omit<DesignJournalEntry, "id" | "ts"> & { id?: string; ts?: string }) {
  ensureJournalDir(roots);
  const row: DesignJournalEntry = {
    id: entry.id ?? randomUUID(),
    ts: entry.ts ?? new Date().toISOString(),
    ...entry,
  };
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(journalPath(roots), line, "utf8");
  const tag = row.phase;
  const tools = row.parsed?.map((c) => c.name).join(",") || row.ran?.map((r) => r.name).join(",") || "";
  console.log(`[design-journal] ${tag} ${tools} id=${row.id.slice(0, 8)}`);
  return row;
}

export function readDesignJournal(roots: Roots, limit = 80): DesignJournalEntry[] {
  const file = journalPath(roots);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const tail = lines.slice(-Math.max(1, Math.min(limit, 500)));
  const out: DesignJournalEntry[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as DesignJournalEntry);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}
