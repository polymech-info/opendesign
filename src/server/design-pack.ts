import { applyDesignPack, buildDesignPack, type DesignPack } from "../design/design-pack.js";
import type { Roots } from "./paths.js";
import * as store from "./store.js";
import { getUpload, putUploadKey } from "./uploads.js";

export async function exportDesignPack(roots: Roots, ids: string[]): Promise<DesignPack> {
  const designs = [];
  for (const id of ids) {
    const row = store.getDesign(roots, id);
    if (!row) throw new Error(`Design not found: ${id}`);
    designs.push(row);
  }
  return buildDesignPack(designs, async (key) => {
    const hit = getUpload(roots, key);
    if (!hit) return null;
    return { bytes: new Uint8Array(hit.data), contentType: hit.contentType };
  });
}

export async function importDesignPack(roots: Roots, raw: unknown) {
  return applyDesignPack(raw, {
    readAsset: async (key) => {
      const hit = getUpload(roots, key);
      return hit ? new Uint8Array(hit.data) : null;
    },
    writeAsset: async (key, bytes) => {
      putUploadKey(roots, key, bytes);
    },
    writeDesign: async (design) => {
      const row = store.importDesignRecord(roots, design);
      return { id: row.id, name: row.name };
    },
  });
}
