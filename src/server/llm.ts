import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";

export type LlmTarget = {
  url: string;
  key: string;
  cwd: string;
};

export type LlmHandle = LlmTarget & {
  child: ChildProcess | null;
  stop: () => void;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8090;

function exists(file: string) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

function parseLlmUrl(raw: string): { url: string; host: string; port: number } {
  const u = new URL(raw);
  return {
    url: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`,
    host: u.hostname,
    port: Number(u.port || DEFAULT_PORT),
  };
}

function walkForTanitCli(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const names =
      process.platform === "win32"
        ? ["tanit-cli.exe", "tanit.exe"]
        : ["tanit-cli", "tanit"];
    const folders = [
      path.join(dir, "dist", "win-x64"),
      path.join(dir, "dist"),
      path.join(dir, "dist-osx"),
    ];
    for (const folder of folders) {
      for (const name of names) {
        const candidate = path.join(folder, name);
        if (exists(candidate)) return candidate;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function whichTanitCli(): string | null {
  const pathEnv = process.env.PATH || "";
  const names =
    process.platform === "win32"
      ? ["tanit-cli.exe", "tanit-cli", "tanit.exe"]
      : ["tanit-cli", "tanit"];
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function findTanitCli(searchFrom: string): string | null {
  const fromEnv = process.env.OPEND_TANIT_CLI?.trim();
  if (fromEnv && exists(fromEnv)) return path.resolve(fromEnv);
  return walkForTanitCli(searchFrom) || walkForTanitCli(process.cwd()) || whichTanitCli();
}

async function probeReady(url: string, timeoutMs = 800): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/$/, "")}/ready`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { ready?: boolean };
    return body.ready !== false;
  } catch {
    return false;
  }
}

function pipeChildLogs(child: ChildProcess) {
  const write = (chunk: Buffer | string) => {
    const text = String(chunk).trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) console.log(`  [llm] ${line}`);
    }
  };
  child.stdout?.on("data", write);
  child.stderr?.on("data", write);
}

export async function registerHostToolProvider(
  llm: LlmTarget,
  spec: { id: string; url: string },
): Promise<boolean> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (llm.key) {
    headers.authorization = `Bearer ${llm.key}`;
    headers["x-api-key"] = llm.key;
  }
  try {
    const res = await fetch(`${llm.url.replace(/\/$/, "")}/v1/host-tool-providers`, {
      method: "POST",
      headers,
      body: JSON.stringify(spec),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `  LLM:     host tool provider ${spec.id} register failed HTTP ${res.status}${detail ? ` ${detail.slice(0, 180)}` : ""}`,
      );
      return false;
    }
    console.log(`  LLM:     host tool provider ${spec.id} → ${spec.url}`);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`  LLM:     host tool provider ${spec.id} register failed: ${detail}`);
    return false;
  }
}

export async function ensureLlmServer(opts: {
  cwd: string;
  searchFrom: string;
  hostToolProvider?: { id: string; url: string };
}): Promise<LlmHandle> {
  const requested = process.env.OPEND_LLM_URL?.trim() || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const { url, host, port } = parseLlmUrl(requested);
  /** Only if you opt in — `tanit-cli --serve` is open on loopback by default. */
  const key = (process.env.OPEND_LLM_KEY || "").trim();
  const preset = (process.env.OPEND_LLM_PRESET || "quick").trim() || "quick";
  fs.mkdirSync(opts.cwd, { recursive: true });
  const target: LlmTarget = { url, key, cwd: opts.cwd };

  if (await probeReady(url)) {
    console.log(`  LLM:     ${url} (already running)`);
    return { ...target, child: null, stop: () => {} };
  }

  const exe = findTanitCli(opts.searchFrom);
  if (!exe) {
    console.warn(
      `  LLM:     not running at ${url} — tanit-cli not found. Set OPEND_TANIT_CLI or start:\n` +
        `           tanit-cli --no-gui llm agent --serve --host ${host} --port ${port} --preset ${preset} --consent-ui yolo`,
    );
    return { ...target, child: null, stop: () => {} };
  }

  const logLevel = (process.env.OPEND_LLM_LOG_LEVEL || "trace").trim() || "trace";
  const args = [
    "--no-gui",
    "--log-level",
    logLevel,
    "--cwd",
    opts.cwd,
    "llm",
    "agent",
    "--serve",
    "--host",
    host,
    "--port",
    String(port),
    "--concurrency",
    process.env.OPEND_LLM_CONCURRENCY || "2",
    "--preset",
    preset,
    "--consent-ui",
    process.env.OPEND_LLM_CONSENT?.trim() || "yolo",
  ];
  if (opts.hostToolProvider) {
    args.push("--host-tool-provider", `${opts.hostToolProvider.id}=${opts.hostToolProvider.url}`);
  }
  if (key) args.push("--serve-api-key", key);

  const env = { ...process.env };
  delete env.TANIT_SERVE_API_KEY;
  if (key) env.TANIT_SERVE_API_KEY = key;

  console.log(`  LLM:     starting ${exe}`);
  const child = spawn(exe, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  pipeChildLogs(child);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  };

  child.on("exit", (code, signal) => {
    if (!stopped) console.warn(`  [llm] tanit-cli exited code=${code} signal=${signal ?? ""}`);
  });

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    if (await probeReady(url, 600)) {
      console.log(`  LLM:     ${url}`);
      return { ...target, child, stop };
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.warn(`  LLM:     ${url} did not become ready. Chat will retry when you send a message.`);
  return { ...target, child, stop };
}

function hopByHop(name: string) {
  return (
    name === "host" ||
    name === "connection" ||
    name === "keep-alive" ||
    name === "proxy-authenticate" ||
    name === "proxy-authorization" ||
    name === "te" ||
    name === "trailers" ||
    name === "transfer-encoding" ||
    name === "upgrade" ||
    name === "content-length"
  );
}

export async function proxyLlmRequest(c: Context, llm: LlmTarget) {
  const prefix = "/api/llm";
  const rest = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : c.req.path;
  const search = new URL(c.req.url).search;
  const target = `${llm.url.replace(/\/$/, "")}${rest || "/"}${search}`;

  const incoming = c.req.raw;
  const headers = new Headers();
  incoming.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (hopByHop(lower) || lower === "authorization" || lower === "x-api-key") return;
    headers.set(name, value);
  });
  // OpenAI SDK always sends a dummy Bearer. An open `--serve` has no key —
  // do not forward or invent one. Only inject when OPEND_LLM_KEY is set.
  if (llm.key) {
    headers.set("authorization", `Bearer ${llm.key}`);
    headers.set("x-api-key", llm.key);
  }
  if (llm.cwd) headers.set("x-tanit-cwd", llm.cwd);

  const method = incoming.method;
  const body = method === "GET" || method === "HEAD" ? undefined : incoming.body;
  const init: RequestInit = { method, headers, body };
  if (body) (init as RequestInit & { duplex: "half" }).duplex = "half";

  try {
    const upstream = await fetch(target, init);
    const out = new Headers();
    upstream.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (hopByHop(lower)) return;
      out.set(name, value);
    });
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: "LLM proxy unavailable. Start tanit-cli llm agent --serve or set OPEND_LLM_URL.",
        detail,
      },
      502,
    );
  }
}

export async function proxyPathToolCall(c: Context, llm: LlmTarget) {
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const name = typeof body.name === "string" ? body.name : "";
  if (!name) return c.json({ ok: false, error: "'name' is required" }, 400);
  const target = `${llm.url.replace(/\/$/, "")}/v1/llm/path-tools/call`;
  const headers = new Headers({ "content-type": "application/json" });
  if (llm.key) {
    headers.set("authorization", `Bearer ${llm.key}`);
    headers.set("x-api-key", llm.key);
  }
  if (llm.cwd) headers.set("x-tanit-cwd", llm.cwd);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, arguments: body.arguments ?? {} }),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: `path tool proxy failed: ${detail}` }, 502);
  }
}

export function mountLlmProxy(app: { all: (path: string, handler: (c: Context) => Response | Promise<Response>) => unknown; post?: (path: string, handler: (c: Context) => Response | Promise<Response>) => unknown }, llm: LlmTarget) {
  app.all("/api/llm/*", (c) => proxyLlmRequest(c, llm));
  app.all("/api/llm", (c) => proxyLlmRequest(c, llm));
  if (app.post) app.post("/api/path-tools/call", (c) => proxyPathToolCall(c, llm));
}
