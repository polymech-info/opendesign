/**
 * Live check: tanit-cli --serve owns the tool loop. OpenDesign is an
 * IAgentToolProvider over HTTP (`/api/agent-tools`). Chat sends prose.
 *
 *   npm run test:design:llm
 *   npm run test:design:llm -- --require-live
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

import { HOST_TOOL_PROVIDER_ID } from "../../src/server/agent-tools.ts";
import { canvasFromDsl, documentToCanvasJson, resolveDesignPage } from "../../src/mcp/session.ts";
import type { DesignDocument, DesignNode } from "../../src/design/types.ts";
import { resolveIconDir } from "../../src/server/icon-dir.ts";
import { createOpenDesignApp } from "../../src/server/index.ts";
import { listenHono } from "../../src/server/listen.ts";
import { findTanitCli, registerHostToolProvider } from "../../src/server/llm.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import * as store from "../../src/server/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");

const argv = process.argv.slice(2);
const REQUIRE_LIVE = argv.includes("--require-live");
const PRESET = (() => {
  const i = argv.indexOf("--preset");
  return (i >= 0 && argv[i + 1] ? argv[i + 1] : "quick").trim() || "quick";
})();
const SERVE_KEY = "tanit-design-llm";

const stats = { passed: 0, failed: 0 };

function check(cond: unknown, msg: string) {
  if (cond) {
    stats.passed += 1;
    return;
  }
  stats.failed += 1;
  throw new Error(msg);
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolvePort(port));
    });
    s.on("error", reject);
  });
}

async function waitListen(host: string, port: number) {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect({ host, port }, () => {
          sock.end();
          resolve();
        });
        sock.on("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error(`nothing listening on ${host}:${port}`);
}

const exe = findTanitCli(pkgRoot);
if (!exe || !fs.existsSync(exe)) {
  console.log("test:design:llm SKIP — tanit-cli not found");
  process.exit(0);
}

const host = "127.0.0.1";
const llmPort = await getFreePort();
const apiPort = await getFreePort();
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-design-llm-"));
const roots = resolveRoots(cwd);
ensureLayouts(roots);

function seedDesign(name: string, dsl: string, width: number, height: number) {
  const parsed = canvasFromDsl(dsl);
  if ("error" in parsed) throw new Error(`${name}: ${parsed.error}`);
  return store.createDesign(roots, {
    name,
    canvas_json: documentToCanvasJson(parsed, "test"),
    width,
    height,
  });
}

function bboxOf(nodes: DesignNode[]) {
  const x0 = Math.min(...nodes.map((n) => n.bounds.x));
  const y0 = Math.min(...nodes.map((n) => n.bounds.y));
  const x1 = Math.max(...nodes.map((n) => n.bounds.x + n.bounds.w));
  const y1 = Math.max(...nodes.map((n) => n.bounds.y + n.bounds.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function loadDoc(designId: string): DesignDocument {
  const page = resolveDesignPage(cwd, designId, 1);
  if ("error" in page) throw new Error(page.error);
  return page.doc;
}

function assertCentered(_doc: DesignDocument, nodes: DesignNode[], canvas: number, label: string, slack = 160) {
  check(nodes.length >= 4, `${label} still has four squares (got ${nodes.length})`);
  const box = bboxOf(nodes);
  check(
    Math.abs(box.cx - canvas / 2) <= slack,
    `${label} center x ${box.cx.toFixed(1)} (want ${canvas / 2}±${slack})`,
  );
  check(
    Math.abs(box.cy - canvas / 2) <= slack,
    `${label} center y ${box.cy.toFixed(1)} (want ${canvas / 2}±${slack})`,
  );
  check(box.cx > canvas * 0.25 && box.cy > canvas * 0.25, `${label} left the top-left corner`);
}

const created = seedDesign(
  "Agent Card",
  "canvas main 800 600\ntheme tanit-light\ntxt hero.title role=title x=40 y=40 w=400 h=60 text=Hello",
  800,
  600,
);
const squaresDesign = seedDesign(
  "Four Squares",
  `canvas main 1080 1080
theme tanit-light
shape sq.tl x=40 y=40 w=120 h=120 fill=#ef4444
shape sq.tr x=180 y=40 w=120 h=120 fill=#3b82f6
shape sq.bl x=40 y=180 w=120 h=120 fill=#22c55e
shape sq.br x=180 y=180 w=120 h=120 fill=#eab308
`,
  1080,
  1080,
);
const groupedDesign = seedDesign(
  "Four Grouped Squares",
  `canvas main 1080 1080
theme tanit-light

widget quad w=260 h=260
  shape tl x=0 y=0 w=120 h=120
  shape tr x=140 y=0 w=120 h=120
  shape bl x=0 y=140 w=120 h=120
  shape br x=140 y=140 w=120 h=120

use quad as=quad.1 x=40 y=40
`,
  1080,
  1080,
);

const iconDir = resolveIconDir(path.join(pkgRoot, "src"), pkgRoot);
const llm = { url: `http://${host}:${llmPort}`, key: SERVE_KEY, cwd: roots.project };
const app = createOpenDesignApp({ roots, iconDir, llm });
const api = await listenHono(app.fetch, apiPort, { allowFallback: false });
const providerUrl = `http://${host}:${api.port}/api/agent-tools`;

const serveArgs = [
  "--no-gui",
  "--cwd",
  roots.project,
  "llm",
  "agent",
  "--serve",
  "--host",
  host,
  "--port",
  String(llmPort),
  "--concurrency",
  "1",
  "--preset",
  PRESET,
  "--consent-ui",
  "yolo",
  "--no-mcp",
  "--no-skills",
  "--host-tool-provider",
  `${HOST_TOOL_PROVIDER_ID}=${providerUrl}`,
  "--serve-api-key",
  SERVE_KEY,
];

const env = { ...process.env };
delete env.TANIT_SERVE_API_KEY;
env.TANIT_SERVE_API_KEY = SERVE_KEY;

console.log(`test:design:llm preset=${PRESET} exe=${exe} llm=${llmPort} api=${api.port}`);
const child: ChildProcess = spawn(exe, serveArgs, {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
  env,
});
const llmLog = (chunk: Buffer | string) => {
  const text = String(chunk).trimEnd();
  if (!text) return;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) console.log(`  [llm] ${line}`);
  }
};
child.stdout?.on("data", llmLog);
child.stderr?.on("data", llmLog);

let ok = false;
let skip = false;

try {
  await waitListen(host, llmPort);
  const health = await fetch(`http://${host}:${llmPort}/health`, {
    headers: { authorization: `Bearer ${SERVE_KEY}` },
  });
  const healthJson = (await health.json()) as { ok?: boolean; ready?: boolean };
  check(health.ok && healthJson.ready !== false, `health: ${health.status}`);

  const catalog = await fetch(providerUrl);
  const catalogJson = (await catalog.json()) as { id?: string; tools?: Array<{ name: string }> };
  check(catalog.ok && catalogJson.id === HOST_TOOL_PROVIDER_ID, "OpenDesign catalog");
  check(
    (catalogJson.tools ?? []).some((t) => t.name === "design_update"),
    "catalog lists design_update",
  );

  const putSession = async (designId: string, selectionIds: string[]) => {
    const session = await fetch(`${providerUrl}/session`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        design: designId,
        page: 1,
        selectionIds,
        projectRoot: roots.project,
      }),
    });
    check(session.ok, `session PUT ${designId} ${session.status}`);
  };
  await putSession(created.id, ["hero.title"]);

  const registered = await registerHostToolProvider(llm, {
    id: HOST_TOOL_PROVIDER_ID,
    url: providerUrl,
  });
  check(registered, "POST /v1/host-tool-providers");
  const listed = await fetch(`http://${host}:${llmPort}/v1/host-tool-providers`, {
    headers: { authorization: `Bearer ${SERVE_KEY}`, "x-api-key": SERVE_KEY },
  });
  const listedJson = (await listed.json()) as { providers?: Array<{ id?: string }> };
  check(
    listed.ok && (listedJson.providers ?? []).some((p) => p.id === HOST_TOOL_PROVIDER_ID),
    `GET /v1/host-tool-providers ${listed.status} ${JSON.stringify(listedJson)}`,
  );
  console.log("ok: host provider registered");

  const client = new OpenAI({
    apiKey: SERVE_KEY,
    baseURL: `http://${host}:${llmPort}/v1`,
    timeout: 300_000,
    maxRetries: 0,
    defaultHeaders: { "X-Tanit-Session": "design-llm-host" },
  });

  try {
    const models = await client.models.list();
    const ids: string[] = [];
    for await (const m of models) ids.push(m.id);
    console.log(`ok: models.list (${ids.length}) ${ids.slice(0, 6).join(", ")}`);
    check(ids.length >= 0, "models listed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (REQUIRE_LIVE) throw e;
    skip = true;
    console.log(`SKIP live model unavailable: ${msg}`);
    throw Object.assign(new Error("SKIP_MODEL"), { skip: true });
  }

  const ask = async (prompt: string) => {
    const reply = await client.chat.completions.create({
      model: PRESET,
      messages: [{ role: "user", content: prompt }],
    });
    const text = String(reply.choices?.[0]?.message?.content || "");
    console.log(`  [agent] ${text.slice(0, 280).replace(/\s+/g, " ")}`);
    return text;
  };

  await ask('Change hero.title text to "Hola". Then answer in one short sentence.');
  const after = store.getDesign(roots, created.id);
  check(after?.updated_by === "cli", `updated_by=${after?.updated_by}`);
  const title = loadDoc(created.id).nodes.find((n) => n.id === "hero.title")?.text;
  check(title === "Hola", `hero.title="${title}"`);
  console.log("ok: agent mutated design via host tools");

  await putSession(squaresDesign.id, ["sq.tl", "sq.tr", "sq.bl", "sq.br"]);
  await ask(
    "The four selected squares sit in the top-left of this 1080×1080 canvas. Center that 2×2 on the canvas. Keep their relative spacing and sizes proportional. Do not add or delete objects.",
  );
  const loose = loadDoc(squaresDesign.id).nodes.filter((n) => n.id.startsWith("sq."));
  assertCentered(loadDoc(squaresDesign.id), loose, 1080, "four selected squares");
  console.log("ok: agent centered four selected squares on 1:1 canvas");

  await putSession(groupedDesign.id, ["quad.1"]);
  await ask(
    "The selected object is a group of four squares. Center that group on this 1080×1080 canvas. Keep the four squares grouped together with the same relative layout. Do not ungroup or delete them.",
  );
  const groupedDoc = loadDoc(groupedDesign.id);
  const use = groupedDoc.nodes.find((n) => n.id === "quad.1" || n.type === "use");
  check(!!use, "grouped design still has the use/group");
  const kids = groupedDoc.nodes.filter((n) => n.parentId === use?.id && n.type === "shape");
  assertCentered(groupedDoc, kids.length ? kids : groupedDoc.nodes.filter((n) => n.type === "shape"), 1080, "four grouped squares");
  if (use && kids.length === 4) {
    const local = kids.map((n) => ({
      dx: n.bounds.x - use.bounds.x,
      dy: n.bounds.y - use.bounds.y,
    }));
    check(local.some((p) => p.dx > 1 && p.dy < 1), "grouped 2×2 still has a top-right square");
    check(local.some((p) => p.dx < 1 && p.dy > 1), "grouped 2×2 still has a bottom-left square");
  }
  console.log("ok: agent centered four grouped squares on 1:1 canvas");

  ok = stats.failed === 0;
  console.log(`\ntest:design:llm ${ok ? "PASS" : "FAIL"} (${PRESET}) passed=${stats.passed}`);
} catch (e) {
  if ((e as { skip?: boolean })?.skip) {
    skip = true;
    ok = true;
    console.log(`\ntest:design:llm SKIP live turn — host provider smoke passed (${stats.passed})`);
  } else {
    ok = false;
    console.error("FAIL:", e instanceof Error ? e.message : e);
  }
} finally {
  child.kill();
  try {
    api.server.close();
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 400));
  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(cwd, { recursive: true, force: true });
}

if (skip && !REQUIRE_LIVE) process.exit(0);
process.exit(ok ? 0 : 1);
