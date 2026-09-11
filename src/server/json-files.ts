import fs from "node:fs";
import path from "node:path";
import { safeId, type Layer } from "./paths.js";

export function mergeByKey<T>(keyOf: (item: T) => string, ...layers: T[][]): T[] {
  const map = new Map<string, T>();
  for (const layer of layers) {
    for (const item of layer) {
      const key = keyOf(item);
      if (!key) continue;
      map.set(key, item);
    }
  }
  return [...map.values()];
}

export function readJsonFile<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJsonFile(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJsonDir<T extends { id: string }>(
  dir: string,
  layer: Layer
): Array<T & { source: Layer }> {
  if (!fs.existsSync(dir)) return [];
  const out: Array<T & { source: Layer }> = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const row = readJsonFile<T>(path.join(dir, file));
    if (!row || typeof row !== "object" || !row.id) continue;
    out.push({ ...row, source: layer });
  }
  return out;
}

export function jsonPath(root: string, folder: string, id: string) {
  return path.join(root, folder, `${safeId(id)}.json`);
}
