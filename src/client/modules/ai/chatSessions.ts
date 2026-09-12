import type { ChatMessage } from "./types";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const SESSIONS_INDEX_KEY = "opend-chat-sessions-index";
const SESSION_PREFIX = "opend-chat-session-";
const MAX_SESSIONS = 50;

export function listSessions(): Omit<ChatSession, "messages">[] {
  try {
    const raw = localStorage.getItem(SESSIONS_INDEX_KEY);
    if (!raw) return [];
    const index: Omit<ChatSession, "messages">[] = JSON.parse(raw);
    return index.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function loadSession(id: string): ChatSession | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: ChatSession): void {
  try {
    localStorage.setItem(SESSION_PREFIX + session.id, JSON.stringify(session));

    const index = listSessions();
    const existing = index.findIndex((s) => s.id === session.id);
    const meta = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    if (existing >= 0) index[existing] = meta;
    else index.unshift(meta);

    while (index.length > MAX_SESSIONS) {
      const removed = index.pop();
      if (removed) localStorage.removeItem(SESSION_PREFIX + removed.id);
    }

    localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(index));
  } catch {
    /* ignore quota */
  }
}

export function deleteSession(id: string): void {
  try {
    localStorage.removeItem(SESSION_PREFIX + id);
    const index = listSessions().filter((s) => s.id !== id);
    localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(index));
  } catch {
    /* ignore */
  }
}

export function generateSessionTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && !m.hidden);
  if (!firstUser?.content) return "New Chat";
  const text = firstUser.content.slice(0, 60);
  return text.length < firstUser.content.length ? text + "…" : text;
}
