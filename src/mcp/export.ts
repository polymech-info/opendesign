import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { designDslMarkdown } from "../cli-dsl.js";
import { designFileSlug, runExport } from "../cli-export.js";
import { serializeDsl } from "../design/index.js";
import { resolveIconDir } from "../server/icon-dir.js";
import { resolveDesignPage } from "./session.js";

function runtimeDirs() {
  let here = path.dirname(fileURLToPath(import.meta.url));
  if (path.basename(here) === "mcp") here = path.dirname(here);
  const runningFromSource = path.basename(here) === "src";
  const pkgRoot = runningFromSource ? path.resolve(here, "..") : here;
  return {
    clientDir: path.join(pkgRoot, runningFromSource ? "dist/client" : "client"),
    iconDir: resolveIconDir(here, pkgRoot),
  };
}

function slugName(name: string, page: number, pageCount: number, ext: string) {
  const base = designFileSlug(name);
  return pageCount > 1 ? `${base}-p${page}.${ext}` : `${base}.${ext}`;
}

export function resolveExportPath(cwd: string, requested: string | undefined, fallbackName: string): string {
  if (!requested?.trim()) return path.resolve(cwd, fallbackName);
  const raw = requested.trim();
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
  const asDir = raw.endsWith("/") || raw.endsWith("\\") || (fs.existsSync(abs) && fs.statSync(abs).isDirectory());
  return asDir ? path.join(abs, fallbackName) : abs;
}

function writeText(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return { path: file, bytes: Buffer.byteLength(body, "utf8") };
}

export async function exportDesignFile(opts: {
  cwd: string;
  design?: string;
  page: number;
  format?: string;
  out?: string;
  scale?: number;
}) {
  const format = String(opts.format ?? "dsl").toLowerCase();
  const session = resolveDesignPage(opts.cwd, opts.design, opts.page);
  if ("error" in session) return session;
  const pageCount = Math.max(1, session.design.pages?.length ?? 1);

  if (format === "svg") {
    return { error: "SVG export is not available. Use format=png, dsl, json, or md." };
  }

  if (format === "png" || format === "jpeg" || format === "jpg") {
    const { clientDir, iconDir } = runtimeDirs();
    const out = resolveExportPath(
      opts.cwd,
      opts.out,
      slugName(session.design.name, opts.page, pageCount, "png"),
    );
    try {
      const written = await runExport({
        cwd: opts.cwd,
        query: session.design.id,
        out,
        page: opts.page,
        scale: Math.max(1, opts.scale ?? 2),
        port: Number(process.env.OPEND_PORT || 3727),
        clientDir,
        iconDir,
        quiet: true,
      });
      const bytes = fs.existsSync(written) ? fs.statSync(written).size : 0;
      return {
        ok: true,
        format: "png",
        path: written,
        bytes,
        design: { id: session.design.id, name: session.design.name },
        page: opts.page,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (format === "json") {
    const out = resolveExportPath(
      opts.cwd,
      opts.out,
      slugName(session.design.name, opts.page, pageCount, "json"),
    );
    const body = JSON.stringify(session.doc, null, 2);
    const written = writeText(out, body.endsWith("\n") ? body : `${body}\n`);
    return {
      ok: true,
      format: "json",
      ...written,
      design: { id: session.design.id, name: session.design.name },
      page: opts.page,
    };
  }

  if (format === "md" || format === "markdown") {
    const out = resolveExportPath(
      opts.cwd,
      opts.out,
      slugName(session.design.name, opts.page, pageCount, "md"),
    );
    const written = writeText(out, designDslMarkdown(session.design.name, opts.page, serializeDsl(session.doc)));
    return {
      ok: true,
      format: "md",
      ...written,
      design: { id: session.design.id, name: session.design.name },
      page: opts.page,
    };
  }

  if (format !== "dsl") {
    return { error: `Unknown export format "${format}" (use dsl, md, json, or png)` };
  }

  const out = resolveExportPath(
    opts.cwd,
    opts.out,
    slugName(session.design.name, opts.page, pageCount, "md"),
  );
  const dsl = serializeDsl(session.doc);
  const body = out.endsWith(".opendsl") || out.endsWith(".dsl")
    ? `${dsl.trimEnd()}\n`
    : designDslMarkdown(session.design.name, opts.page, dsl);
  const written = writeText(out, body);
  return {
    ok: true,
    format: "dsl",
    ...written,
    design: { id: session.design.id, name: session.design.name },
    page: opts.page,
  };
}
