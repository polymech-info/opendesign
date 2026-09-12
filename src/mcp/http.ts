import type { Context } from "hono";
import { handleMcpRpc } from "./handler.js";
import type { McpContext } from "./tools.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, authorization, mcp-session-id, mcp-protocol-version, accept",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

function sessionId(c: Context): string {
  return c.req.header("mcp-session-id")?.trim() || crypto.randomUUID();
}

function mcpHeaders(session: string, extra?: Record<string, string>) {
  return {
    ...CORS,
    "Mcp-Session-Id": session,
    "MCP-Protocol-Version": "2025-03-26",
    ...extra,
  };
}

function sseBody(payload: unknown): string {
  return `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
}

export function mcpOptionsResponse() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Legacy SSE + Streamable HTTP GET. Cursor falls back here when POST isn't accepted as streamable. */
export function mcpGetResponse(c: Context) {
  const session = sessionId(c);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: endpoint\ndata: /api/mcp\n\n`));
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          clearInterval(timer);
        }
      }, 25_000);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: mcpHeaders(session, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    }),
  });
}

export function mcpDeleteResponse(c: Context) {
  return new Response(null, { status: 204, headers: mcpHeaders(sessionId(c)) });
}

export async function mcpPostResponse(c: Context, ctx: McpContext) {
  const session = sessionId(c);
  const accept = (c.req.header("accept") || "").toLowerCase();
  const wantsSse = accept.includes("text/event-stream") && !accept.includes("application/json");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    const err = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    if (wantsSse) {
      return new Response(sseBody(err), {
        status: 200,
        headers: mcpHeaders(session, { "Content-Type": "text/event-stream; charset=utf-8" }),
      });
    }
    return new Response(JSON.stringify(err), {
      status: 200,
      headers: mcpHeaders(session, { "Content-Type": "application/json" }),
    });
  }

  const result = await handleMcpRpc(body, ctx);
  if (result == null) {
    return new Response(null, { status: 202, headers: mcpHeaders(session) });
  }
  if (wantsSse) {
    return new Response(sseBody(result), {
      status: 200,
      headers: mcpHeaders(session, { "Content-Type": "text/event-stream; charset=utf-8" }),
    });
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: mcpHeaders(session, { "Content-Type": "application/json" }),
  });
}
