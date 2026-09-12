#!/usr/bin/env node

import "./server/quiet-env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { listDesignsForCli, runExport } from "./cli-export.js";
import { exportDslMarkdown, queryDesignDsl } from "./cli-dsl.js";
import { runCliPrompt } from "./cli-prompt.js";
import { createOpenDesignApp } from "./server/index.js";
import { resolveIconDir } from "./server/icon-dir.js";
import { listenHono } from "./server/listen.js";
import { resolveRoots } from "./server/paths.js";
import { mountClient } from "./server/serve-client.js";
import { devPortFile } from "./server/dev-port.js";
import { HOST_TOOL_PROVIDER_ID } from "./server/agent-tools.js";
import { ensureLlmServer, registerHostToolProvider } from "./server/llm.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runningFromSource = path.basename(here) === "src";
const pkgRoot = path.resolve(here, "..");
const portFile = devPortFile(pkgRoot);

export const DEFAULT_API_PORT = 3727;
export const DEFAULT_UI_PORT = 5174;

function parseArgv(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  const rest: string[] = [];
  const valueFlags = new Set([
    "--port",
    "-o",
    "--out",
    "--page",
    "--scale",
    "--format",
    "-p",
    "--prompt",
    "-q",
    "--query",
    "--fields",
    "--limit",
    "--model",
    "--max-rounds",
  ]);
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
    export [id|name]      Export PNG, or Markdown with --format dsl
    dsl [id|name]         Export Design DSL as a Markdown file
    query [id|name] EXPR  Query Design DSL and print JSON
    prompt [id|name] TEXT Prompt the design agent and save its edits
    mcp                   MCP stdio server (Cursor / Claude Desktop)
    ls                    List designs in this folder

  Options:
    --port <number>       Preferred port (default: ${DEFAULT_API_PORT})
    --no-browser          Don't open the browser
    -o, --out <file>      Output path (export/dsl)
    --format <png|dsl>    Export format, default png
    --page <n>            Page number, 1-based
    --scale <n>           PNG multiplier, default 2 (export)
    -q, --query <expr>    Query expression (alternative to trailing EXPR)
    --fields <a,b,...>    Query result fields
    --limit <n>           Maximum query results, default 50
    -p, --prompt <text>   Prompt text (alternative to trailing TEXT)
    --model <name>        LLM model/preset, default quick (prompt)
    --max-rounds <n>      Maximum tool-loop rounds, default 8 (prompt)
    --dry-run             Run tools without saving (prompt)
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

const commandName = rest.find(
  (a) =>
    a === "export" ||
    a === "dsl" ||
    a === "query" ||
    a === "prompt" ||
    a === "mcp" ||
    a === "ls" ||
    a === "list",
);
const commandAt = commandName ? rest.indexOf(commandName) : -1;

try {
  if (commandName === "ls" || commandName === "list") {
    listDesignsForCli(targetDir);
    process.exit(0);
  }

  if (commandName === "export") {
    const format = str("--format")?.trim().toLowerCase() || "png";
    const scaleRaw = str("--scale");
    const pageRaw = str("--page");
    if (format === "dsl" || format === "md" || format === "markdown") {
      const out = exportDslMarkdown({
        cwd: targetDir,
        query: rest[commandAt + 1],
        out: str("-o", "--out"),
        page: pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1,
      });
      console.log(out);
      process.exit(0);
    }
    if (format !== "png") throw new Error(`Unknown export format "${format}" (use png or dsl)`);
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

  if (commandName === "dsl") {
    const pageRaw = str("--page");
    const out = exportDslMarkdown({
      cwd: targetDir,
      query: rest[commandAt + 1],
      out: str("-o", "--out"),
      page: pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1,
    });
    console.log(out);
    process.exit(0);
  }

  if (commandName === "query") {
    const designQuery = rest[commandAt + 1];
    const expression = str("-q", "--query") ?? rest.slice(commandAt + 2).join(" ");
    if (!expression.trim()) {
      throw new Error(
        'Query expression is required: pm-opendesign query <id|name> "type=txt role=title"',
      );
    }
    const pageRaw = str("--page");
    const limitRaw = str("--limit");
    const fields = str("--fields")
      ?.split(",")
      .map((field) => field.trim())
      .filter(Boolean);
    const result = queryDesignDsl({
      cwd: targetDir,
      designQuery,
      page: pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1,
      query: expression,
      fields,
      limit: limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 50) : undefined,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (commandName === "mcp") {
    const { runMcpStdio } = await import("./mcp/stdio.js");
    await runMcpStdio({ cwd: targetDir, searchFrom: pkgRoot });
    process.exit(0);
  }

  if (commandName === "prompt") {
    const query = rest[commandAt + 1];
    const prompt = str("-p", "--prompt") ?? rest.slice(commandAt + 2).join(" ");
    if (!prompt.trim()) {
      throw new Error(
        'Prompt text is required: pm-opendesign prompt <id|name> "Move the title down 20px"',
      );
    }
    const pageRaw = str("--page");
    const roundsRaw = str("--max-rounds");
    const roots = resolveRoots(targetDir);
    const llm = await ensureLlmServer({ cwd: roots.project, searchFrom: pkgRoot });
    try {
      const result = await runCliPrompt({
        cwd: targetDir,
        query,
        prompt,
        page: pageRaw ? Math.max(1, parseInt(pageRaw, 10) || 1) : 1,
        model: str("--model")?.trim() || process.env.OPEND_LLM_PRESET?.trim() || "quick",
        maxRounds: roundsRaw ? Math.max(1, parseInt(roundsRaw, 10) || 8) : 8,
        dryRun: flags.has("--dry-run"),
        llm,
      });
      console.log(
        `${result.saved ? "saved" : "dry-run"} ${result.designName} page ${result.page} ` +
          `(${result.calls.map((call) => call.name).join(", ")})`,
      );
    } finally {
      llm.stop();
    }
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const noBrowser =
  flags.has("--no-browser") || process.env.OPEND_NO_BROWSER === "1" || runningFromSource;

const roots = resolveRoots(targetDir);
const hostToolProvider = {
  id: HOST_TOOL_PROVIDER_ID,
  url: `http://127.0.0.1:${Number.isFinite(preferredPort) ? preferredPort : DEFAULT_API_PORT}/api/agent-tools`,
};
const llm = await ensureLlmServer({ cwd: roots.project, searchFrom: pkgRoot, hostToolProvider });
const app = createOpenDesignApp({ roots, iconDir, llm });

if (!runningFromSource && fs.existsSync(clientDir)) {
  mountClient(app, clientDir);
}

const { port } = await listenHono(app.fetch, preferredPort, { allowFallback: true });
fs.writeFileSync(portFile, JSON.stringify({ api: port }) + "\n");
await registerHostToolProvider(llm, {
  id: HOST_TOOL_PROVIDER_ID,
  url: `http://127.0.0.1:${port}/api/agent-tools`,
});

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
