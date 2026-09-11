import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";

function isInside(dir: string, file: string) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".map": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function mountClient(app: Hono, clientDir: string) {
  app.use("/*", async (c, next) => {
    const urlPath = c.req.path;
    if (urlPath.startsWith("/api") || urlPath.startsWith("/tabler-icons") || urlPath === "/llms.txt") {
      return next();
    }
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\//, ""));
    const file = path.resolve(clientDir, rel);
    const found = isInside(clientDir, file) && fs.existsSync(file) && fs.statSync(file).isFile();
    if (!found && path.extname(rel)) return next();
    const bodyFile = found ? file : path.join(clientDir, "index.html");
    if (!fs.existsSync(bodyFile)) return next();
    const ext = path.extname(bodyFile).toLowerCase();
    return c.body(new Uint8Array(fs.readFileSync(bodyFile)), 200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
  });
}
