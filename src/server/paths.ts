import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PROJECT_DIRNAME = ".OpenDesign";

export type Layer = "global" | "project";

export type Roots = {
  cwd: string;
  project: string;
  global: string;
};

export function globalRoot(): string {
  if (process.env.OPEND_GLOBAL) return path.resolve(process.env.OPEND_GLOBAL);
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "OpenDesign");
  }
  return path.join(os.homedir(), ".OpenDesign");
}

export function projectRoot(cwd = process.cwd()): string {
  return path.join(path.resolve(cwd), PROJECT_DIRNAME);
}

export function resolveRoots(cwd = process.cwd()): Roots {
  return {
    cwd: path.resolve(cwd),
    project: projectRoot(cwd),
    global: globalRoot(),
  };
}

export function sameRoots(roots: Roots) {
  return path.resolve(roots.project) === path.resolve(roots.global);
}

/** Low → high priority for merge. Last write wins on the same key. */
export function mergeOrder(roots: Roots): { layer: Layer; root: string }[] {
  if (sameRoots(roots)) return [{ layer: "project", root: roots.project }];
  return [
    { layer: "global", root: roots.global },
    { layer: "project", root: roots.project },
  ];
}

const SUBDIRS = ["designs", "elements", "templates", "uploads", "uploads/backgrounds", "uploads/icons"];

export function ensureRootLayout(root: string) {
  fs.mkdirSync(root, { recursive: true });
  for (const sub of SUBDIRS) fs.mkdirSync(path.join(root, sub), { recursive: true });
}

export function ensureLayouts(roots: Roots) {
  ensureRootLayout(roots.global);
  if (!sameRoots(roots)) ensureRootLayout(roots.project);
}

export function layerRoot(roots: Roots, layer: Layer) {
  return layer === "global" ? roots.global : roots.project;
}

export function safeId(id: string) {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!cleaned || cleaned !== id) throw new Error("Invalid id");
  return cleaned;
}
