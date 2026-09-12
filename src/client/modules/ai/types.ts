export interface ImageAttachment {
  id: string;
  url: string;
  name: string;
  isLocal?: boolean;
}

export interface ToolRunRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  toolRuns?: ToolRunRecord[];
  isStreaming?: boolean;
  images?: ImageAttachment[];
  toolContext?: string;
  /** Host-loop tool result — kept in API history, hidden from the transcript. */
  hidden?: boolean;
}

export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
