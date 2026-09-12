import type { DesignDocument } from "./types";
import { normalizeUploadKey } from "./upload-paths";

export type DesignDocSnapshot = {
  pageBackground?: string;
  images: Array<{ id: string; src: string }>;
  nodeCount: number;
  widgetIds: string[];
};

export function snapshotDesignDoc(doc: DesignDocument | null | undefined): DesignDocSnapshot | null {
  if (!doc) return null;
  const images = doc.nodes
    .filter((n) => n.type === "img")
    .map((n) => ({
      id: n.id,
      src: n.src ? normalizeUploadKey(n.src) : "",
    }));
  return {
    pageBackground: doc.pageBackground ? normalizeUploadKey(doc.pageBackground) : undefined,
    images,
    nodeCount: doc.nodes.length,
    widgetIds: doc.nodes.filter((n) => n.type === "use").map((n) => n.id),
  };
}
