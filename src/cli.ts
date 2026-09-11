#!/usr/bin/env node

import "./server/quiet-env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { listDesignsForCli, runExport } from "./cli-export.js";
import { createOpenDesignApp } from "./server/index.js";
import { resolveIconDir } from "./server/icon-dir.js";
import { listenHono } from "./server/listen.js";
import { resolveRoots } from "./server/paths.js";
import { mountClient } from "./server/serve-client.js";
import { devPortFile } from "./server/dev-port.js";
import { ensureLlmServer } from "./server/llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runningFromSource = path.basename(here) === "src";
const pkgRoot = path.resolve(here, "..");
const portFile = devPortFile(pkgRoot);

export const DEFAULT_API_PORT = 3727;
export const DEFAULT_UI_PORT = 5174;

function parseArgv(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const rest: string[] = [];
  const valueFlags = new Set(["--port", "-o", "--out", "--page", "--scale"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valueFlags.has(a)) {
      flags.set(a, argv[i + 1] ?? "");
      i++;
      continue;
    }
    if (a.startsWith("-")) {
      flags.set(a, true);
      continue;
    }
    rest.push(a);
  }
  const str = (...names: string[]) => {
    for (const n of names) {
      const v = flags.get(n);
      if (typeof v === "string") return v;
    }
    return undefined;
  };
  return { flags, rest, str };
}

const args = process.argv.slice(2);
const { rest, str, flags } = parseArgv(args);
const targetDir = process.env.OPEND_CWD || process.cwd();
const clientDir = path.join(runningFromSource ? pkgRoot : here, runningFromSource ? "dist/client" : "client");
const iconDir = resolveIconDir(here, pkgRoot);

const HELP = `
  Usage: pm-opendesign [command] [options]

  Commands:
    (default)             Start the editor and open the browser
    export [id|name]      Headless PNG (uses Chrome or Edge)
    ls                    List designs in this folder

  Options:
    --port <number>       Preferred port (default: ${DEFAULT_API_PORT})
    --no-browser          Don't open the browser
    -o, --out <file>      PNG path (export)
    --page <n>            Page number, 1-based (export)
    --scale <n>           PNG multiplier, default 2 (export)
    -h, --help            Show this help

  Storage (merged union; project shadows same id/key):
    Project  <cwd>/.OpenDesign
    Global   %APPDATA%/OpenDesign  (or ~/.OpenDesign)
`;

if (flags.has("--help") || flags.has("-h")) {
  console.log(HELP);
  process.exit(0);
}

const preferredPort =
  str("--port") != null
    ? parseInt(str("--port")!, 10)
    : Number(process.env.OPEND_PORT || DEFAULT_API_PORT);

const commandName = rest.find((a) => a === "export" || a === "ls" || a === "list");
const commandAt = commandName ? rest.indexOf(commandName) : -1;

try {
  if (commandName === "ls" || commandName === "list") {
    listDesignsForCli(targetDir);
    process.exit(0);
  }

  if (commandName === "export") {
    const scaleRaw = str("--scale");
    const pageRaw = str("--page");
    await runExport({
      cwd: targetDir,
      query: rest[commandAt + 1],
      out: str("-o", "--out"),
      page: pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1,
      scale: scaleRaw ? Math.max(1, Number(scaleRaw) || 2) : 2,
      port: preferredPort,
      clientDir,
      iconDir,
    });
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const noBrowser =
  flags.has("--no-browser") || process.env.OPEND_NO_BROWSER === "1" || runningFromSource;

const roots = resolveRoots(targetDir);
const llm = await ensureLlmServer({ cwd: roots.project, searchFrom: pkgRoot });
const app = createOpenDesignApp({ roots, iconDir, llm });

if (!runningFromSource && fs.existsSync(clientDir)) {
  mountClient(app, clientDir);
}

const { port } = await listenHono(app.fetch, preferredPort, { allowFallback: true });
fs.writeFileSync(portFile, JSON.stringify({ api: port }) + "\n");

const uiPort = Number(process.env.OPEND_UI_PORT || DEFAULT_UI_PORT);
const ui = runningFromSource ? `http://127.0.0.1:${uiPort}` : `http://127.0.0.1:${port}`;

console.log(`\n  @polymech/opendesign\n`);
console.log(`  Local:   ${ui}`);
console.log(`  Project: ${roots.project}`);
console.log(`  Global:  ${roots.global}`);
console.log(`  Merge:   union — project shadows same id/key`);
console.log(`  LLM:     ${llm.url}\n`);

const cleanup = () => {
  llm.stop();
  try {
    fs.unlinkSync(portFile);
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

if (!noBrowser) {
  await open(ui);
}
