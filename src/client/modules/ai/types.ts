export interface ImageAttachment {
  id: string;
  url: string;
  name: string;
  isLocal?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  isStreaming?: boolean;
  images?: ImageAttachment[];
  toolContext?: string;
}

export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
