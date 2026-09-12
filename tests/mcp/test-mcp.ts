import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { handleMcpRpc } from "../../src/mcp/handler.ts";
import { MCP_TOOLS_MAP } from "../../src/mcp/tools.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "opend-mcp-"));

async function rpc(method: string, params?: Record<string, unknown>, id: number | string = 1) {
  return handleMcpRpc({ jsonrpc: "2.0", id, method, params }, { cwd });
}

function toolText(response: unknown): Record<string, unknown> {
  const rec = response as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
  const text = rec.result?.content?.[0]?.text;
  assert.ok(text, "missing tools/call text");
  return JSON.parse(text) as Record<string, unknown>;
}

try {
  const init = (await rpc("initialize", { protocolVersion: "2025-03-26" })) as {
    result: { serverInfo: { name: string }; capabilities: { tools: object }; protocolVersion: string };
  };
  assert.equal(init.result.serverInfo.name, "opendesign");
  assert.equal(init.result.protocolVersion, "2025-03-26");
  assert.ok(init.result.capabilities.tools);

  const listed = (await rpc("tools/list")) as { result: { tools: Array<{ name: string }> } };
  const names = listed.result.tools.map((t) => t.name);
  for (const need of [
    "list_designs",
    "create_design",
    "get_design",
    "design_update",
    "design_create",
    "design_use_widget",
    "delete_design",
    "prompt_design",
  ]) {
    assert.ok(names.includes(need), `missing tool ${need}`);
  }
  assert.ok(!names.includes("design_screenshot"));

  const empty = toolText(await rpc("tools/call", { name: "list_designs", arguments: {} }));
  assert.ok(Array.isArray(empty));
  assert.equal((empty as unknown as unknown[]).length, 0);

  const created = toolText(
    await rpc("tools/call", {
      name: "create_design",
      arguments: {
        name: "MCP Card",
        dsl: "canvas main 800 600\ntheme tanit-light\ntxt hero.title role=title x=40 y=40 w=400 h=60 text=Hello",
      },
    }),
  );
  assert.equal(created.success, true);
  assert.equal(created.name, "MCP Card");
  const designId = String(created.id);
  assert.match(String(created.dsl), /hero\.title/);

  const queried = toolText(
    await rpc("tools/call", {
      name: "design_query",
      arguments: { design: "MCP Card", query: "type=txt role=title", fields: ["id", "text"] },
    }),
  );
  const items = queried.result as Array<{ id: string; text: string }>;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.text, "Hello");

  const updated = toolText(
    await rpc("tools/call", {
      name: "design_update",
      arguments: { design: designId, where: "id=hero.title", set: { text: "Hola" } },
    }),
  );
  assert.equal(updated.saved, true);
  assert.equal((updated.result as { changed?: number }).changed, 1);

  const after = toolText(await rpc("tools/call", { name: "get_design", arguments: { design: "MCP Card" } }));
  assert.match(String(after.dsl), /Hola/);

  const templates = toolText(await rpc("tools/call", { name: "list_templates", arguments: {} }));
  assert.ok(Array.isArray(templates));
  assert.ok((templates as unknown as Array<{ id: string }>).some((t) => t.id === "feature-cards"));

  const fromTemplate = toolText(
    await rpc("tools/call", {
      name: "create_design",
      arguments: { name: "From Template", template: "feature-cards" },
    }),
  );
  assert.equal(fromTemplate.success, true);
  assert.match(String(fromTemplate.dsl ?? ""), /feature-group|feature\.chat/);

  const exported = toolText(
    await rpc("tools/call", {
      name: "design_export",
      arguments: { design: "MCP Card", format: "dsl", path: "exports/mcp-card.md" },
    }),
  );
  assert.equal(exported.ok, true);
  const exportedPath = String(exported.path);
  assert.equal(exportedPath, path.join(cwd, "exports", "mcp-card.md"));
  assert.match(fs.readFileSync(exportedPath, "utf8"), /hero\.title/);

  const exportedJson = toolText(
    await rpc("tools/call", {
      name: "design_export",
      arguments: { design: "MCP Card", format: "json", path: "exports/" },
    }),
  );
  assert.equal(exportedJson.ok, true);
  assert.ok(fs.existsSync(String(exportedJson.path)));
  assert.match(fs.readFileSync(String(exportedJson.path), "utf8"), /"id": "hero.title"/);

  const note = await rpc("notifications/initialized");
  assert.equal(note, null);

  assert.ok(MCP_TOOLS_MAP.has("design_search_icons"));

  const replies = [
    '{"tool_calls":[{"name":"design_update","arguments":{"where":"id=hero.title","set":{"text":"Ciao"}}},{"name":"done","arguments":{}}]}',
  ];
  const prompted = toolText(
    await handleMcpRpc(
      {
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: {
          name: "prompt_design",
          arguments: { design: "MCP Card", prompt: "Say hello in Italian" },
        },
      },
      {
        cwd,
        llm: { url: "http://127.0.0.1:1", key: "", cwd },
        complete: async () => replies.shift() ?? '{"name":"done","arguments":{}}',
      },
    ),
  );
  assert.equal(prompted.success, true);
  assert.equal(prompted.saved, true);
  assert.deepEqual(prompted.calls, ["design_update"]);
  assert.match(String(prompted.dsl), /Ciao/);

  const removed = toolText(await rpc("tools/call", { name: "delete_design", arguments: { design: "MCP Card" } }));
  assert.equal(removed.success, true);

  console.log("test:mcp PASS");
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
