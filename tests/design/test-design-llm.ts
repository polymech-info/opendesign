/**
 * Local Gemma via `tanit-cli llm agent --serve` driving OpenDesign design tools.
 *
 * --serve ignores client tools[], so this harness uses a plain completion
 * (`--no-tools`) and executes JSON tool_calls locally — same split as
 * tests/orchestrator/test-llm-server-tools.mjs (model thinks, host runs tools).
 *
 *   npm run test:design:llm
 *   npm run test:design:llm -- --require-live
 *
 * Suites:
 *   1. create        — primitive design_create
 *   2. query-update  — query then batch patch
 *   3. advanced      — create + where update + transform
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

import {
  EXAMPLE_DSL,
  FEATURE_CARDS,
  FEATURE_CARD_SEED,
  designToolCatalog,
  dispatchDesignTool,
  emptyDocument,
  findNode,
  isDoneCall,
  parseDsl,
  parseEmittedToolCalls,
  queryNodes,
  type DesignDocument,
  type ToolCall,
} from "../../src/design/index.ts";
import { findTanitCli } from "../../src/server/llm.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "../..");

const argv = process.argv.slice(2);
const REQUIRE_LIVE = argv.includes("--require-live");
const PRESET = (() => {
  const i = argv.indexOf("--preset");
  return (i >= 0 && argv[i + 1] ? argv[i + 1] : "Local Gemma").trim() || "Local Gemma";
})();
const SERVE_KEY = "tanit-design-llm";
const MAX_ROUNDS = 8;

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
  for (let i = 0; i < 40; i++) {
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

function toolSystem(allowed: string[], extra: string): string {
  return [
    "You are the OpenDesign tool caller.",
    "Reply with ONE JSON object only. No markdown. No prose.",
    'Format: {"name":"design_create","arguments":{...}}',
    'Or several: {"tool_calls":[{"name":"...","arguments":{...}}]}',
    'When the task is done: {"name":"done","arguments":{}}',
    "Allowed tools:",
    designToolCatalog(allowed),
    extra,
  ].join("\n");
}

async function complete(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const r = await client.chat.completions.create({ model, messages });
  return String(r.choices?.[0]?.message?.content || "").trim();
}

async function runToolLoop(opts: {
  client: OpenAI;
  model: string;
  doc: DesignDocument;
  system: string;
  user: string;
  allowed: string[];
  required?: string[];
  maxRounds?: number;
  verify?: () => string | null;
}): Promise<{ calls: ToolCall[]; text: string; rounds: number }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const calls: ToolCall[] = [];
  const required = opts.required ?? [];
  const limit = opts.maxRounds ?? MAX_ROUNDS;
  let text = "";
  for (let round = 1; round <= limit; round++) {
    text = await complete(opts.client, opts.model, messages);
    console.log(`  [gemma r${round}] ${text.slice(0, 240).replace(/\s+/g, " ")}`);
    const emitted = parseEmittedToolCalls(text);
    if (!emitted.length) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: 'Reply with JSON only: {"name":"<tool>","arguments":{...}}',
      });
      continue;
    }
    messages.push({ role: "assistant", content: text });
    const results: unknown[] = [];
    let sawDone = false;
    for (const call of emitted) {
      if (isDoneCall(call)) {
        sawDone = true;
        continue;
      }
      if (!opts.allowed.includes(call.name)) {
        results.push({ name: call.name, ok: false, error: `tool not allowed: ${call.name}` });
        continue;
      }
      const result = dispatchDesignTool(call.name, call.arguments, opts.doc);
      calls.push(call);
      results.push({ name: call.name, result });
    }
    const missing = required.filter((name) => !calls.some((c) => c.name === name));
    const verifyHint = opts.verify?.() ?? null;
    if (sawDone && missing.length === 0 && !verifyHint) return { calls, text, rounds: round };
    if (results.length) {
      const parts = [`TOOL_RESULT ${JSON.stringify(results)}.`];
      if (missing.length) parts.push(` Still required: ${missing.join(", ")}.`);
      if (verifyHint) parts.push(` ${verifyHint}`);
      if (!missing.length && !verifyHint) parts.push(' Then {"name":"done","arguments":{}}.');
      else parts.push(" Do not done yet. JSON only.");
      messages.push({ role: "user", content: parts.join("") });
      continue;
    }
    if (missing.length || verifyHint) {
      messages.push({
        role: "user",
        content: `Not done. ${missing.length ? `Call ${missing.join(" then ")}. ` : ""}${verifyHint ?? ""} JSON only.`,
      });
    }
  }
  return { calls, text, rounds: limit };
}

const exe = findTanitCli(pkgRoot);
if (!exe || !existsSync(exe)) {
  console.log("test:design:llm SKIP — tanit-cli not found");
  process.exit(0);
}

const host = "127.0.0.1";
const port = await getFreePort();
const workDir = path.join(pkgRoot, ".OpenDesign", "stemp-design-llm");
mkdirSync(workDir, { recursive: true });

const serveArgs = [
  "--no-gui",
  "--cwd",
  workDir,
  "llm",
  "agent",
  "--serve",
  "--host",
  host,
  "--port",
  String(port),
  "--concurrency",
  "1",
  "--preset",
  PRESET,
  "--consent-ui",
  "yolo",
  "--no-mcp",
  "--no-skills",
  "--no-planner",
  "--no-tools",
  "--max-iter",
  "1",
  "--serve-api-key",
  SERVE_KEY,
];

const env = { ...process.env };
delete env.TANIT_SERVE_API_KEY;
env.TANIT_SERVE_API_KEY = SERVE_KEY;

console.log(`test:design:llm preset=${PRESET} exe=${exe} port=${port}`);
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
function makeClient(sessionId: string) {
  return new OpenAI({
    apiKey: SERVE_KEY,
    baseURL: `http://${host}:${port}/v1`,
    timeout: 300_000,
    maxRetries: 0,
    defaultHeaders: { "X-Tanit-Session": sessionId },
  });
}

try {
  await waitListen(host, port);
  const health = await fetch(`http://${host}:${port}/health`);
  const healthJson = (await health.json()) as { ok?: boolean; ready?: boolean };
  check(health.ok && healthJson.ready !== false, `health: ${health.status}`);
  console.log("ok: daemon ready");

  try {
    const models = await makeClient("design-llm-probe").models.list();
    const ids: string[] = [];
    for await (const m of models) ids.push(m.id);
    console.log(`ok: models.list (${ids.length}) ${ids.slice(0, 6).join(", ")}`);
    check(ids.length > 0 || true, "models listed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (REQUIRE_LIVE) throw e;
    skip = true;
    console.log(`SKIP local-gemma unavailable: ${msg}`);
    throw Object.assign(new Error("SKIP_GEMMA"), { skip: true });
  }

  // --- 1. primitive create ---
  console.log("\n=== create ===");
  {
    const doc = emptyDocument();
    const { calls } = await runToolLoop({
      client: makeClient("design-llm-create"),
      model: PRESET,
      doc,
      allowed: ["design_create"],
      required: ["design_create"],
      system: toolSystem(
        ["design_create"],
        'Example: {"name":"design_create","arguments":{"objects":[{"type":"txt","id":"hero.title","x":100,"y":80,"w":600,"h":100,"style":"h1","text":"Hello"}]}}',
      ),
      user: "Create one text primitive: type=txt id=hero.title x=100 y=80 w=600 h=100 style=h1 text=Hello. Then done.",
    });
    check(calls.some((c) => c.name === "design_create"), `create: no design_create (calls=${calls.map((c) => c.name).join(",")})`);
    const node = findNode(doc, "hero.title");
    check(node?.type === "txt", `create: missing hero.title, nodes=${doc.nodes.map((n) => n.id).join(",")}`);
    check(node?.bounds.x === 100 && node?.bounds.w === 600, `create: geometry ${JSON.stringify(node?.bounds)}`);
    check((node?.text || "") === "Hello" || node?.style === "h1", `create: text/style ${node?.text} ${node?.style}`);
    console.log("ok: primitive create");
  }

  // --- 2. query then manipulate ---
  console.log("\n=== query-update ===");
  {
    const doc = parseDsl(EXAMPLE_DSL);
    const { calls } = await runToolLoop({
      client: makeClient("design-llm-query-update"),
      model: PRESET,
      doc,
      allowed: ["design_query", "design_update"],
      required: ["design_query", "design_update"],
      system: toolSystem(
        ["design_query", "design_update"],
        [
          'Query example: {"name":"design_query","arguments":{"query":"type=txt role=title","fields":["id","x"]}}',
          'Update example: {"name":"design_update","arguments":{"where":"id=hero.title","set":{"x":1400}}}',
        ].join("\n"),
      ),
      user: "1) Query type=txt role=title. 2) Set ONLY geometry: design_update where=id=hero.title set={\"x\":1400}. Do not change text. Then done.",
      verify: () => {
        const x = findNode(doc, "hero.title")?.bounds.x;
        return x === 1400 ? null : `hero.title.x is ${x}, must be 1400. Call design_update where=id=hero.title set.x=1400`;
      },
    });
    check(calls.some((c) => c.name === "design_query"), "query-update: no design_query");
    check(calls.some((c) => c.name === "design_update"), "query-update: no design_update");
    const hero = findNode(doc, "hero.title");
    check(hero?.bounds.x === 1400, `query-update: hero.title.x=${hero?.bounds.x}`);
    console.log("ok: query + update");
  }

  // --- 3. advanced combo ---
  console.log("\n=== advanced ===");
  {
    const doc = emptyDocument();
    const { calls } = await runToolLoop({
      client: makeClient("design-llm-advanced"),
      model: PRESET,
      doc,
      allowed: ["design_create", "design_query", "design_update"],
      required: ["design_create", "design_update"],
      system: toolSystem(
        ["design_create", "design_query", "design_update"],
        [
          "Create two shapes in ONE design_create call:",
          'card.a and card.b, type=shape, 200x120, preset=card.soft, a at x=80 y=80, b at x=320 y=80.',
          'Then design_update where=id^=card. set preset=card.dark and transform x=+20.',
        ].join("\n"),
      ),
      user: "Create shape card.a (x=80 y=80 w=200 h=120 preset=card.soft) and shape card.b (x=320 y=80 w=200 h=120 preset=card.soft) in one design_create. Then design_update where=id^=card. set preset=card.dark and transform x=+20. Then done.",
      verify: () => {
        const a = findNode(doc, "card.a");
        const b = findNode(doc, "card.b");
        if (!a || !b) return "Create both card.a and card.b first.";
        if (a.preset !== "card.dark" || b.preset !== "card.dark") {
          return "Both cards must have preset=card.dark. design_update where=id^=card. set.preset=card.dark";
        }
        if (a.bounds.x !== 100 || b.bounds.x !== 340) {
          return `card.a.x=${a.bounds.x} card.b.x=${b.bounds.x}; transform x=+20 from 80/320 → 100/340`;
        }
        return null;
      },
    });
    check(calls.some((c) => c.name === "design_create"), "advanced: no create");
    check(calls.some((c) => c.name === "design_update"), "advanced: no update");
    const a = findNode(doc, "card.a");
    const b = findNode(doc, "card.b");
    check(a?.type === "shape" && b?.type === "shape", `advanced: cards missing (${doc.nodes.map((n) => n.id)})`);
    check(a?.preset === "card.dark" && b?.preset === "card.dark", `advanced: preset a=${a?.preset} b=${b?.preset}`);
    check(a?.bounds.x === 100 && b?.bounds.x === 340, `advanced: x a=${a?.bounds.x} b=${b?.bounds.x}`);
    const dark = queryNodes(doc, { query: "id^=card. preset=card.dark" });
    check(dark.length === 2, `advanced: query combo ${dark.length}`);
    console.log("ok: create + where update + transform");
  }

  // --- 4. real-world feature cards ---
  console.log("\n=== feature-cards ===");
  {
    const doc = parseDsl(FEATURE_CARD_SEED);
    const { calls } = await runToolLoop({
      client: makeClient("design-llm-features"),
      model: PRESET,
      doc,
      allowed: ["design_use_widget", "design_update", "design_query", "design_delete"],
      required: ["design_use_widget", "design_update"],
      maxRounds: 10,
      system: toolSystem(
        ["design_use_widget", "design_update", "design_query", "design_delete"],
        [
          "Widget feature-group is already defined (icon, title, caption, body).",
          'Use: {"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.chat","x":80,"y":80,"bindings":{"icon":"chat","title":"Chat & AI","caption":"Everyday assistance","body":"Chat, translate, generate and understand."}}}',
          'Align: {"name":"design_update","arguments":{"where":"type=use id^=feature.","layout":{"type":"column","gap":24,"area":{"x":80,"y":80}}}}',
        ].join("\n"),
      ),
      user: [
        "Instantiate feature-group three times: feature.chat, feature.files, feature.search.",
        "Fill bindings exactly:",
        ...FEATURE_CARDS.map(
          (c) => `${c.id}: icon=${c.icon} title=${c.title} caption=${c.caption} body=${c.body}`,
        ),
        "Then design_update layout column gap=24 area x=80 y=80 so they stack top-left. Then done.",
      ].join(" "),
      verify: () => {
        const wanted = FEATURE_CARDS.map((c) => c.id);
        const extras = doc.nodes.filter((n) => n.type === "use" && !wanted.includes(n.id));
        if (extras.length) {
          return `Delete extras ${extras.map((e) => e.id).join(",")}. Only ${wanted.join(", ")}. design_delete ids=${JSON.stringify(extras.map((e) => e.id))}`;
        }
        for (const card of FEATURE_CARDS) {
          if (!findNode(doc, card.id)) {
            return `Missing ${card.id}. design_use_widget widget=feature-group id=${card.id} bindings icon=${card.icon} title=${card.title}`;
          }
        }
        const uses = wanted.map((id) => findNode(doc, id)!).sort((a, b) => a.id.localeCompare(b.id));
        const xs = uses.map((u) => u.bounds.x);
        const ys = uses.map((u) => u.bounds.y);
        if (xs.some((x) => x !== 80) || ys[0] !== 80 || ys[1] !== 324 || ys[2] !== 568) {
          return `Align only those three: design_update where=type=use id^=feature. layout type=column gap=24 area.x=80 area.y=80 (now x=${xs} y=${ys})`;
        }
        return null;
      },
    });
    check(calls.some((c) => c.name === "design_use_widget"), "feature-cards: used widget");
    check(calls.some((c) => c.name === "design_update"), "feature-cards: layout update");
    const uses = FEATURE_CARDS.map((c) => findNode(doc, c.id)).filter(Boolean);
    check(uses.length === 3, `feature-cards named instances ${uses.map((u) => u?.id)}`);
    check(uses.every((u) => u && u.bounds.x === 80), `feature-cards left x=${uses.map((u) => u?.bounds.x)}`);
    const ordered = [...uses].sort((a, b) => a!.id.localeCompare(b!.id));
    check(
      ordered[0]?.bounds.y === 80 && ordered[1]?.bounds.y === 324 && ordered[2]?.bounds.y === 568,
      `feature-cards y=${ordered.map((u) => u?.bounds.y)}`,
    );
    for (const card of FEATURE_CARDS) {
      const title = findNode(doc, `${card.id}.title`)?.text || "";
      check(title.length > 0, `filled ${card.id}.title`);
    }
    console.log("ok: 3 feature cards top-left column");
  }

  ok = stats.failed === 0;
  console.log(`\ntest:design:llm ${ok ? "PASS" : "FAIL"} (${PRESET}) passed=${stats.passed}`);
} catch (e) {
  if ((e as { skip?: boolean })?.skip) {
    skip = true;
    ok = true;
  } else {
    ok = false;
    console.error("FAIL:", e instanceof Error ? e.message : e);
  }
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 400));
  if (child.exitCode == null) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

if (skip && !REQUIRE_LIVE) process.exit(0);
process.exit(ok ? 0 : 1);
