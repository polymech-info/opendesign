function waitPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function captureVisibleTabViaExtension(): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(
        new Error(
          "Tanit Inspector did not capture the tab. Reload the unpacked extension after rebuilding tanit-chrome."
        )
      );
    }, 8000);
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as {
        source?: string;
        type?: string;
        id?: string;
        image?: string;
        error?: string;
      } | null;
      if (!data || data.source !== "tanit-chrome" || data.type !== "captureVisibleTabResult" || data.id !== id) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (typeof data.image === "string" && data.image.startsWith("data:image/")) {
        resolve(data.image);
        return;
      }
      reject(new Error(data.error || "Tanit Inspector capture failed"));
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "opend-app", type: "captureVisibleTab", id }, "*");
  });
}

export async function saveAppScreenshot() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await waitPaint();
  const image = await captureVisibleTabViaExtension();
  const ac = new AbortController();
  const timer = window.setTimeout(() => ac.abort(), 20000);
  let res: Response;
  try {
    res = await fetch("/api/export/app-screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      signal: ac.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("Screenshot save timed out");
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
  const data = (await res.json()) as { error?: string; path?: string; filename?: string; relative?: string };
  if (!res.ok) throw new Error(data.error || "Request failed");
  if (!data.path || !data.relative || !data.filename) throw new Error("Screenshot save returned no path");
  return { path: data.path, filename: data.filename, relative: data.relative };
}
