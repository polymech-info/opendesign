import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findHeadlessBrowser } from "./server/chrome.js";
import { createExportJob, failExportJob } from "./server/export-jobs.js";
import { createOpenDesignApp } from "./server/index.js";
import { listenHono } from "./server/listen.js";
import { resolveRoots } from "./server/paths.js";
import { mountClient } from "./server/serve-client.js";
import * as store from "./server/store.js";
import { getUpload } from "./server/uploads.js";
import { listCanvasAssets, parseFabricJSON, uploadKeyFromUrl } from "./shared/canvas-json.js";

function slug(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "design";
}

function printDesigns(rows: { id: string; name: string }[]) {
  if (!rows.length) {
    console.log("  (no designs in this folder)");
    return;
  }
  const w = Math.max(...rows.map((r) => r.name.length), 4);
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(w)}  ${row.id}`);
  }
}

export function listDesignsForCli(cwd: string) {
  const roots = resolveRoots(cwd);
  printDesigns(store.listDesigns(roots));
}

export function pickDesign(cwd: string, query: string | undefined, command = "export") {
  const roots = resolveRoots(cwd);
  const all = store.listDesigns(roots);
  if (!all.length) {
    throw new Error("No designs in this folder. Open pm-opendesign and save one first.");
  }
  if (!query) {
    if (all.length === 1) return store.getDesign(roots, all[0].id)!;
    console.log("Designs:\n");
    printDesigns(all);
    throw new Error(`Pass a design id or name: pm-opendesign ${command} <id>`);
  }
  const exactId = all.find((d) => d.id === query);
  if (exactId) return store.getDesign(roots, exactId.id)!;
  const q = query.toLowerCase();
  const named = all.filter((d) => d.name.toLowerCase() === q);
  if (named.length === 1) return store.getDesign(roots, named[0].id)!;
  const fuzzy = all.filter(
    (d) => d.id.startsWith(query) || d.name.toLowerCase().includes(q)
  );
  if (fuzzy.length === 1) return store.getDesign(roots, fuzzy[0].id)!;
  if (fuzzy.length > 1) {
    printDesigns(fuzzy);
    throw new Error(`Ambiguous design "${query}"`);
  }
  throw new Error(`Design not found: ${query}`);
}

function log(line: string) {
  console.error(`[export] ${line}`);
}

function checkAssetsOnDisk(cwd: string, json: string) {
  const roots = resolveRoots(cwd);
  let parsed: Record<string, unknown>;
  try {
    parsed = parseFabricJSON(json);
  } catch (err) {
    log(`canvas JSON parse failed: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const assets = listCanvasAssets(parsed);
  if (!assets.length) {
    log("no remote images/icons in canvas JSON");
    return;
  }
  log(`checking ${assets.length} asset(s) on disk`);
  for (const asset of assets) {
    const key = uploadKeyFromUrl(asset.src);
    const label = asset.id ? `${asset.kind} ${asset.id}` : asset.kind;
    if (key) {
      const file = getUpload(roots, key);
      if (file) {
        log(`ok       ${label}  ${key}  ${file.data.byteLength}B  (${file.source})`);
      } else {
        log(`MISSING  ${label}  ${key}  not in project or global uploads`);
      }
      continue;
    }
    if (asset.src.startsWith("/tabler-icons/") || asset.src.startsWith("/api/icons/")) {
      log(`icon     ${label}  ${asset.src}  (served by editor, checked in browser)`);
      continue;
    }
    log(`remote   ${label}  ${asset.src}`);
  }
}

export function designFileSlug(name: string) {
  return slug(name);
}

export async function runExport(opts: {
  cwd: string;
  query?: string;
  out?: string;
  page: number;
  scale: number;
  port: number;
  clientDir: string;
  iconDir: string;
  quiet?: boolean;
}): Promise<string> {
  if (!fs.existsSync(path.join(opts.clientDir, "index.html"))) {
    throw new Error("Client bundle missing. Run npm run build, then: pm-opendesign export");
  }
  const browser = findHeadlessBrowser();
  if (!browser) {
    throw new Error(
      "Need Chrome or Edge for headless PNG. Install one, or set OPEND_BROWSER to the executable."
    );
  }

  const design = pickDesign(opts.cwd, opts.query);
  const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const pageCount = Math.max(pages.length, 1);
  if (opts.page > pageCount) {
    throw new Error(`Page ${opts.page} missing (${pageCount} page${pageCount === 1 ? "" : "s"})`);
  }

  const out =
    opts.out ||
    path.resolve(
      opts.cwd,
      pageCount > 1 ? `${slug(design.name)}-p${opts.page}.png` : `${slug(design.name)}.png`
    );

  log(`${design.name}  ${design.id}`);
  log(`${design.width}×${design.height}  page ${opts.page}/${pageCount}  scale ${opts.scale}`);
  checkAssetsOnDisk(opts.cwd, pages[opts.page - 1]?.canvas_json || design.canvas_json || "{}");

  const app = createOpenDesignApp({ roots: resolveRoots(opts.cwd), iconDir: opts.iconDir });
  mountClient(app, opts.clientDir);
  const { server, port } = await listenHono(app.fetch, opts.port, { allowFallback: true });
  const { token, promise } = createExportJob(90_000, log);
  const url = `http://127.0.0.1:${port}/export/${encodeURIComponent(design.id)}?token=${encodeURIComponent(token)}&page=${opts.page}&scale=${opts.scale}`;
  log(`browser ${path.basename(browser)}  ${url}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "opend-export-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: "ignore", windowsHide: true }
  );
  child.on("error", (err) => {
    failExportJob(token, err instanceof Error ? err : new Error(String(err)));
  });

  const stop = () => {
    try {
      if (process.platform === "win32" && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGKILL");
      }
    } catch {
      /* ignore */
    }
    try {
      server.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    const { png, logs } = await promise;
    const missing = logs.filter((line) => line.includes("MISSING") || line.includes("FAILED"));
    fs.writeFileSync(out, png);
    if (missing.length) log(`${missing.length} missing/failed line(s); PNG still written`);
    log(`wrote ${png.byteLength}B`);
    if (!opts.quiet) console.log(out);
    return out;
  } finally {
    stop();
  }
}
