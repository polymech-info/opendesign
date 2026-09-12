import { ensureLlmServer, type LlmTarget } from "../server/llm.js";
import { handleMcpRpc } from "./handler.js";
import { mcpRoots } from "./session.js";
import type { McpContext } from "./tools.js";

function writeMessage(payload: unknown) {
  const json = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
}

function logErr(line: string) {
  process.stderr.write(`[mcp] ${line}\n`);
}

async function handleRaw(raw: string, ctx: McpContext) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    writeMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const result = await handleMcpRpc(body, ctx);
  if (result == null) return;
  if (Array.isArray(result)) {
    for (const item of result) writeMessage(item);
    return;
  }
  writeMessage(result);
}

/**
 * MCP stdio transport: Content-Length framing (spec) plus NDJSON for ad-hoc tests.
 * Never write logs to stdout.
 */
export async function runMcpStdio(opts: { cwd: string; llm?: LlmTarget; searchFrom?: string }) {
  const stdoutLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  };
  const cwd = mcpRoots(opts.cwd).cwd;
  const llmHandle = opts.llm
    ? { ...opts.llm, stop: () => {} }
    : await ensureLlmServer({ cwd: mcpRoots(cwd).project, searchFrom: opts.searchFrom ?? cwd });
  const ctx: McpContext = { cwd, llm: llmHandle };
  logErr(`stdio ready cwd=${cwd} llm=${llmHandle.url}`);
  let buf = Buffer.alloc(0);

  const consume = async () => {
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      const textStart = buf.subarray(0, Math.min(buf.length, 24)).toString("utf8");
      if (headerEnd >= 0 && /^content-length:/i.test(textStart)) {
        const header = buf.subarray(0, headerEnd).toString("utf8");
        const match = /content-length:\s*(\d+)/i.exec(header);
        if (!match) {
          buf = buf.subarray(headerEnd + 4);
          continue;
        }
        const len = Number(match[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) return;
        const raw = buf.subarray(start, start + len).toString("utf8");
        buf = buf.subarray(start + len);
        await handleRaw(raw, ctx);
        continue;
      }
      const nl = buf.indexOf("\n");
      if (nl >= 0 && !/^content-length:/i.test(textStart)) {
        const line = buf.subarray(0, nl).toString("utf8").replace(/\r$/, "").trim();
        buf = buf.subarray(nl + 1);
        if (line) await handleRaw(line, ctx);
        continue;
      }
      return;
    }
  };

  try {
    for await (const chunk of process.stdin) {
      buf = Buffer.concat([buf, chunk]);
      await consume();
    }
    if (buf.length) await consume();
  } finally {
    llmHandle.stop();
    console.log = stdoutLog;
  }
}
