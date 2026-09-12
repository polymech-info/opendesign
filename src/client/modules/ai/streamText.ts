/** Tanit --serve may stream TextDelta chunks then repeat the full text as AssistantText. */
export function dedupeRepeatedContent(text: string): string {
  if (text.length < 20) return text;
  for (let len = Math.floor(text.length / 2); len >= 20; len--) {
    const head = text.slice(0, len);
    if (text.slice(len, len * 2) === head) return head + text.slice(len * 2);
  }
  return text;
}

export function appendStreamDelta(fullContent: string, delta: string): string {
  if (!delta) return fullContent;
  if (!fullContent) return delta;
  if (delta === fullContent) return fullContent;
  if (delta.startsWith(fullContent)) return delta;
  if (fullContent.endsWith(delta)) return fullContent;
  return fullContent + delta;
}
