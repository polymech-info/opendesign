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

export type EnsureLlmOpts = {
  cwd: string;
  searchFrom: string;
  hostToolProvider?: { id: string; url: string };
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

export function parseLlmUrl(raw: string): { url: string; host: string; port: number } {
  const u = new URL(raw);
  return {
    url: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`,
    host: u.hostname,
    port: Number(u.port || DEFAULT_PORT),
  };
}

/** When OPEND_LLM_URL is unset, try nearby ports if 8090 is taken. */
export function llmPortCandidates(startPort: number, pinned: boolean, count = 10): number[] {
  if (pinned) return [startPort];
  return Array.from({ length: count }, (_, i) => startPort + i);
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

function childAlive(child: ChildProcess | null) {
  return !!child && child.exitCode == null && !child.killed;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(url: string, child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) return false;
    if (await probeReady(url, 600)) return true;
    await sleep(400);
  }
  return false;
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

let lastOpts: EnsureLlmOpts | null = null;
let handle: LlmHandle | null = null;
let inflight: Promise<LlmHandle> | null = null;

function spawnTanit(
  exe: string,
  host: string,
  port: number,
  opts: EnsureLlmOpts,
  key: string,
): ChildProcess {
  const preset = (process.env.OPEND_LLM_PRESET || "quick").trim() || "quick";
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

  console.log(`  LLM:     starting ${exe} on ${host}:${port}`);
  const child = spawn(exe, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  pipeChildLogs(child);
  child.on("exit", (code, signal) => {
    if (handle?.child === child) {
      console.warn(`  [llm] tanit-cli exited code=${code} signal=${signal ?? ""}`);
    }
  });
  return child;
}

async function runEnsure(opts: EnsureLlmOpts): Promise<LlmHandle> {
  const envUrl = process.env.OPEND_LLM_URL?.trim();
  const requested = envUrl || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const parsed = parseLlmUrl(requested);
  const key = (process.env.OPEND_LLM_KEY || "").trim();
  fs.mkdirSync(opts.cwd, { recursive: true });

  if (!handle) {
    handle = {
      url: parsed.url,
      key,
      cwd: opts.cwd,
      child: null,
      stop: () => {
        if (!handle?.child) return;
        try {
          handle.child.kill();
        } catch {
          /* ignore */
        }
        handle.child = null;
      },
    };
  } else {
    handle.key = key;
    handle.cwd = opts.cwd;
  }

  if (await probeReady(handle.url)) {
    console.log(`  LLM:     ${handle.url} (already running)`);
    await attachHostProvider(opts, handle);
    return handle;
  }

  if (childAlive(handle.child)) {
    if (await waitReady(handle.url, handle.child, 20_000)) {
      console.log(`  LLM:     ${handle.url}`);
      await attachHostProvider(opts, handle);
      return handle;
    }
    try {
      handle.child.kill();
    } catch {
      /* ignore */
    }
    handle.child = null;
  }

  const exe = findTanitCli(opts.searchFrom);
  if (!exe) {
    console.warn(
      `  LLM:     not running at ${parsed.url} — tanit-cli not found. Set OPEND_TANIT_CLI or start:\n` +
        `           tanit-cli --no-gui llm agent --serve --host ${parsed.host} --port ${parsed.port} --preset ${
          (process.env.OPEND_LLM_PRESET || "quick").trim() || "quick"
        } --consent-ui yolo`,
    );
    return handle;
  }

  const ports = llmPortCandidates(parsed.port, Boolean(envUrl));
  for (const port of ports) {
    const url = `http://${parsed.host}:${port}`;
    if (await probeReady(url)) {
      handle.url = url;
      console.log(`  LLM:     ${url} (already running)`);
      await attachHostProvider(opts, handle);
      return handle;
    }

    const child = spawnTanit(exe, parsed.host, port, opts, key);
    handle.child = child;
    handle.url = url;
    if (await waitReady(url, child, 45_000)) {
      if (port !== parsed.port) console.log(`  LLM:     port ${parsed.port} busy, using ${port}`);
      console.log(`  LLM:     ${url}`);
      await attachHostProvider(opts, handle);
      return handle;
    }
    if (childAlive(child)) {
      console.warn(`  LLM:     ${url} not ready yet; chat will wait on the next request.`);
      return handle;
    }
    handle.child = null;
    console.warn(`  LLM:     ${url} exited before ready`);
  }

  console.warn(`  LLM:     ${parsed.url} did not become ready. Chat will retry when you send a message.`);
  return handle;
}

function emptyHandle(opts: EnsureLlmOpts): LlmHandle {
  const envUrl = process.env.OPEND_LLM_URL?.trim();
  const requested = envUrl || `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;
  const parsed = parseLlmUrl(requested);
  const key = (process.env.OPEND_LLM_KEY || "").trim();
  fs.mkdirSync(opts.cwd, { recursive: true });
  if (!handle) {
    handle = {
      url: parsed.url,
      key,
      cwd: opts.cwd,
      child: null,
      stop: () => {
        if (!handle?.child) return;
        try {
          handle.child.kill();
        } catch {
          /* ignore */
        }
        handle.child = null;
      },
    };
  } else {
    handle.key = key;
    handle.cwd = opts.cwd;
    handle.url = parsed.url;
  }
  return handle;
}

async function attachHostProvider(opts: EnsureLlmOpts, llm: LlmHandle) {
  if (!opts.hostToolProvider) return;
  await registerHostToolProvider(llm, opts.hostToolProvider);
}

/** Remember how to start tanit-cli, but do not spawn it yet. */
export function deferLlmServer(opts: EnsureLlmOpts): LlmHandle {
  lastOpts = opts;
  const llm = emptyHandle(opts);
  console.log(`  LLM:     on demand (${llm.url})`);
  return llm;
}

export async function ensureLlmServer(opts: EnsureLlmOpts): Promise<LlmHandle> {
  lastOpts = opts;
  if (inflight) return inflight;
  inflight = runEnsure(opts).finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function ensureLiveLlm(fallback?: LlmTarget): Promise<LlmTarget | undefined> {
  if (lastOpts) return ensureLlmServer(lastOpts);
  return fallback;
}

async function liveLlm(llm: LlmTarget): Promise<LlmTarget> {
  return (await ensureLiveLlm(llm)) ?? llm;
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

function llmUnavailable(c: Context, detail: string) {
  return c.json(
    {
      error: "LLM proxy unavailable. Start tanit-cli llm agent --serve or set OPEND_LLM_URL.",
      detail,
    },
    502,
  );
}

export async function proxyLlmRequest(c: Context, llm: LlmTarget) {
  const targetLlm = await liveLlm(llm);
  const prefix = "/api/llm";
  const rest = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : c.req.path;
  const search = new URL(c.req.url).search;
  const target = `${targetLlm.url.replace(/\/$/, "")}${rest || "/"}${search}`;

  const incoming = c.req.raw;
  const headers = new Headers();
  incoming.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (hopByHop(lower) || lower === "authorization" || lower === "x-api-key") return;
    headers.set(name, value);
  });
  // OpenAI SDK always sends a dummy Bearer. An open `--serve` has no key —
  // do not forward or invent one. Only inject when OPEND_LLM_KEY is set.
  if (targetLlm.key) {
    headers.set("authorization", `Bearer ${targetLlm.key}`);
    headers.set("x-api-key", targetLlm.key);
  }
  if (targetLlm.cwd) headers.set("x-tanit-cwd", targetLlm.cwd);

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
    return llmUnavailable(c, detail);
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
  const targetLlm = await liveLlm(llm);
  const target = `${targetLlm.url.replace(/\/$/, "")}/v1/llm/path-tools/call`;
  const headers = new Headers({ "content-type": "application/json" });
  if (targetLlm.key) {
    headers.set("authorization", `Bearer ${targetLlm.key}`);
    headers.set("x-api-key", targetLlm.key);
  }
  if (targetLlm.cwd) headers.set("x-tanit-cwd", targetLlm.cwd);
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
