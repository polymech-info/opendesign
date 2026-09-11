import fs from "node:fs";
import path from "node:path";
import type { Context, Next } from "hono";

function safeIconName(raw: string): string | null {
  const name = decodeURIComponent(raw).replace(/\.svg$/i, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
  return name;
}

function isInside(dir: string, file: string) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function iconNames(iconDir: string): string[] {
  const index = path.join(iconDir, "index.json");
  try {
    if (fs.existsSync(index)) {
      const data = JSON.parse(fs.readFileSync(index, "utf8"));
      if (Array.isArray(data)) return data.filter((n) => typeof n === "string");
    }
  } catch {
    /* fall through */
  }
  if (!fs.existsSync(iconDir)) return [];
  return fs
    .readdirSync(iconDir)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => file.slice(0, -4));
}

export async function tablerMiddleware(iconDir: string, c: Context, next: Next) {
  const url = c.req.path;
  if (url === "/tabler-icons/index.json") {
    return c.json(iconNames(iconDir), 200, { "Cache-Control": "public, max-age=60" });
  }
  const match = url.match(/^\/tabler-icons\/([^/]+)$/);
  if (!match) return next();
  const name = safeIconName(match[1]);
  if (!name) return c.body("", 400);
  const file = path.join(iconDir, `${name}.svg`);
  if (!iconDir || !isInside(iconDir, file) || !fs.existsSync(file)) return c.body("", 404);
  return c.body(new Uint8Array(fs.readFileSync(file)), 200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "public, max-age=86400",
    "Access-Control-Allow-Origin": "*",
  });
}
