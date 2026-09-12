import fs from "node:fs";
import path from "node:path";

import { DEFAULT_SKILL, DEFAULT_STYLE_GUIDE } from "./seed-guides.js";

export const STYLE_GUIDE_FILE = "style_guide.md";
export const SKILL_FILE = "SKILL.md";

const MAX_CHARS = 12_000;

export type ProjectGuides = {
  styleGuide?: string;
  skill?: string;
};

function readCapped(file: string): string | undefined {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return undefined;
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text;
  } catch {
    return undefined;
  }
}

function writeIfMissing(file: string, body: string) {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

/** Create default SKILL.md + style_guide.md in a project .OpenDesign folder. */
export function seedProjectGuides(projectDir: string) {
  fs.mkdirSync(projectDir, { recursive: true });
  writeIfMissing(path.join(projectDir, STYLE_GUIDE_FILE), DEFAULT_STYLE_GUIDE);
  writeIfMissing(path.join(projectDir, SKILL_FILE), DEFAULT_SKILL);
}

/** Read guides from \`<cwd>/.OpenDesign/\`. Missing files are omitted. */
export function loadProjectGuides(cwd = process.cwd()): ProjectGuides {
  const root = path.join(path.resolve(cwd), ".OpenDesign");
  return {
    styleGuide: readCapped(path.join(root, STYLE_GUIDE_FILE)),
    skill: readCapped(path.join(root, SKILL_FILE)),
  };
}
