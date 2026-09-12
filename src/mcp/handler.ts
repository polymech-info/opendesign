/**
 * MCP JSON-RPC handler.
 * Stateless dispatcher — no MCP SDK. Speaks JSON-RPC 2.0 over HTTP or stdio.
 */

import { MCP_TOOLS, MCP_TOOLS_MAP, type McpContext } from "./tools.js";

export const MCP_SERVER_INFO = {
  name: "opendesign",
  version: "0.1.0",
};

const SERVER_CAPABILITIES = {
  tools: {},
};

function jsonRpcOk(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

export type McpRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpHandlerOptions = McpContext;

function isNotification(msg: McpRpcMessage): boolean {
  return msg.id === undefined;
}

async function dispatchOne(msg: McpRpcMessage, opts: McpHandlerOptions): Promise<unknown | null> {
  const { id, method, params } = msg;
  if (msg.jsonrpc !== "2.0" || !method) {
    if (isNotification(msg)) return null;
    return jsonRpcError(id ?? null, INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = requested === "2024-11-05" ? "2024-11-05" : "2025-03-26";
        return jsonRpcOk(id ?? null, {
          protocolVersion,
          capabilities: SERVER_CAPABILITIES,
          serverInfo: MCP_SERVER_INFO,
        });
      }
      case "notifications/initialized":
      case "initialized":
        return null;
      case "ping":
        return isNotification(msg) ? null : jsonRpcOk(id ?? null, {});
      case "tools/list":
        return jsonRpcOk(id ?? null, {
          tools: MCP_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
      case "resources/list":
        return jsonRpcOk(id ?? null, { resources: [] });
      case "prompts/list":
        return jsonRpcOk(id ?? null, { prompts: [] });
      case "tools/call": {
        const toolName = typeof params?.name === "string" ? params.name : "";
        const toolArgs =
          params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const tool = MCP_TOOLS_MAP.get(toolName);
        if (!tool) {
          return jsonRpcError(id ?? null, METHOD_NOT_FOUND, `Unknown tool: ${toolName}`);
        }
        const result = await tool.handler(toolArgs, opts);
        const isError = Boolean(result && typeof result === "object" && "error" in result);
        return jsonRpcOk(id ?? null, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          ...(isError ? { isError: true } : {}),
        });
      }
      default:
        if (isNotification(msg)) return null;
        return jsonRpcError(id ?? null, METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (err) {
    if (isNotification(msg)) return null;
    return jsonRpcError(id ?? null, INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  }
}

export async function handleMcpRpc(body: unknown, opts: McpHandlerOptions): Promise<unknown | null> {
  if (body == null || typeof body !== "object") {
    return jsonRpcError(null, PARSE_ERROR, "Parse error");
  }
  if (Array.isArray(body)) {
    const results: unknown[] = [];
    for (const item of body) {
      const result = await dispatchOne((item ?? {}) as McpRpcMessage, opts);
      if (result != null) results.push(result);
    }
    return results.length ? results : null;
  }
  return dispatchOne(body as McpRpcMessage, opts);
}
