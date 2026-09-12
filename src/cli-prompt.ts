import OpenAI from "openai";
import {
  applyEmittedDesignTools,
  designChatBrief,
  isDoneCall,
  parseEmittedToolCalls,
  resolveDesignDocument,
  writeCliCanvasJson,
  type ToolCall,
} from "./design/index.js";
import { pickDesign } from "./cli-export.js";
import type { LlmTarget } from "./server/llm.js";
import { resolveRoots } from "./server/paths.js";
import { loadProjectGuides } from "./server/project-guides.js";
import * as store from "./server/store.js";

type PromptMessage = OpenAI.Chat.ChatCompletionMessageParam;
type Complete = (messages: PromptMessage[], model: string) => Promise<string>;

export type CliPromptOptions = {
  cwd: string;
  query?: string;
  prompt: string;
  page: number;
  model: string;
  maxRounds: number;
  dryRun?: boolean;
  llm: LlmTarget;
  complete?: Complete;
  log?: (line: string) => void;
};

export type CliPromptResult = {
  designId: string;
  designName: string;
  pageId: string;
  page: number;
  rounds: number;
  calls: ToolCall[];
  saved: boolean;
};

function defaultComplete(llm: LlmTarget): Complete {
  const client = new OpenAI({
    apiKey: llm.key || "opendesign-local",
    baseURL: `${llm.url.replace(/\/$/, "")}/v1`,
    timeout: 300_000,
    maxRetries: 0,
    defaultHeaders: {
      "X-Tanit-Session": `opendesign-cli-${Date.now().toString(36)}`,
      ...(llm.cwd ? { "X-Tanit-Cwd": llm.cwd } : {}),
    },
  });
  return async (messages, model) => {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 4096,
    });
    return String(response.choices[0]?.message?.content ?? "").trim();
  };
}

function runSucceeded(result: unknown): boolean {
  return !(result && typeof result === "object" && (result as { ok?: boolean }).ok === false);
}

/**
 * Run the same text-emitted design tool protocol as the browser chat.
 * Canvas-only tools are rejected because this command deliberately does not launch a browser.
 */
export async function runCliPrompt(opts: CliPromptOptions): Promise<CliPromptResult> {
  const log = opts.log ?? ((line: string) => console.error(`[prompt] ${line}`));
  const roots = resolveRoots(opts.cwd);
  const design = pickDesign(opts.cwd, opts.query, "prompt");
  const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const pageCount = Math.max(1, pages.length);
  if (opts.page < 1 || opts.page > pageCount) {
    throw new Error(`Page ${opts.page} missing (${pageCount} page${pageCount === 1 ? "" : "s"})`);
  }
  const page = pages[opts.page - 1];
  if (!page) throw new Error(`Design "${design.name}" has no saved page`);
  const doc = resolveDesignDocument([page.canvas_json, design.canvas_json]);
  if (!doc) {
    throw new Error(
      `Page ${opts.page} has no Design DSL. Open it in the editor and save once before prompting from the CLI.`,
    );
  }

  const system = [
    designChatBrief(doc, { guides: loadProjectGuides(opts.cwd), projectRoot: roots.project }),
    "CLI MODE: no live Fabric canvas is open.",
    "Do not call design_screenshot, design_export, image_create, image_transform, or image_understand.",
    'After the requested edit succeeds, emit {"name":"done","arguments":{}}.',
  ].join("\n");
  const messages: PromptMessage[] = [
    { role: "system", content: system },
    { role: "user", content: opts.prompt },
  ];
  const complete = opts.complete ?? defaultComplete(opts.llm);
  const calls: ToolCall[] = [];
  let mutated = false;
  let rounds = 0;

  for (rounds = 1; rounds <= opts.maxRounds; rounds++) {
    const text = await complete(messages, opts.model);
    log(`round ${rounds}: ${text.slice(0, 240).replace(/\s+/g, " ")}`);
    const emitted = parseEmittedToolCalls(text);
    messages.push({ role: "assistant", content: text });
    const sawDone = /"(?:name|tool)"\s*:\s*"done"/i.test(text) || emitted.some(isDoneCall);
    if (sawDone && !emitted.length) break;
    if (!emitted.length) {
      messages.push({
        role: "user",
        content: 'Emit JSON only. Use a design_* tool, or {"name":"done","arguments":{}} when finished.',
      });
      continue;
    }

    const runnable = emitted.filter(
      (call) =>
        call.name.startsWith("design_") &&
        call.name !== "design_screenshot" &&
        call.name !== "design_export",
    );
    const rejected = emitted.filter((call) => !runnable.includes(call));
    const runs = runnable.length
      ? await applyEmittedDesignTools(JSON.stringify({ tool_calls: runnable }), doc)
      : [];
    calls.push(...runnable);
    if (runnable.some((call) => !["design_query", "design_get", "design_search_icons"].includes(call.name))) {
      mutated = runs.some((run) => runSucceeded(run.result)) || mutated;
    }
    const results = [
      ...runs.map((run) => ({ name: run.name, result: run.result })),
      ...rejected.map((call) => ({
        name: call.name,
        result: { ok: false, error: `${call.name} is unavailable in CLI mode` },
      })),
    ];
    if (sawDone) break;
    messages.push({
      role: "user",
      content:
        `TOOL_RESULT ${JSON.stringify(results)}\n` +
        'Continue with JSON only. When the request is complete emit {"name":"done","arguments":{}}.',
    });
  }

  if (rounds > opts.maxRounds) {
    throw new Error(`Prompt did not finish after ${opts.maxRounds} rounds`);
  }
  if (!calls.length) throw new Error("Model finished without calling a design tool");

  if (mutated && !opts.dryRun) {
    // Patch the saved Fabric tree. projectToFabricJSON is flat and drops Groups.
    const canvasJson = writeCliCanvasJson(page.canvas_json, doc, { source: "cli-prompt" });
    const savedPage = store.updatePage(roots, page.id, { canvas_json: canvasJson }, "cli");
    if (!savedPage) throw new Error(`Could not save page ${page.id}`);
    if (opts.page === 1) {
      const savedDesign = store.updateDesign(
        roots,
        design.id,
        {
          canvas_json: canvasJson,
          width: doc.canvas.width,
          height: doc.canvas.height,
        },
        "cli",
      );
      if (!savedDesign) throw new Error(`Could not save design ${design.id}`);
    }
    store.snapshotDesignVersion(roots, design.id, {
      kind: "auto",
      title: "CLI prompt",
      description: opts.prompt.slice(0, 280),
      created_by: "cli",
    });
    log(`saved ${design.name} — open editor will reload this design`);
  }

  return {
    designId: design.id,
    designName: design.name,
    pageId: page.id,
    page: opts.page,
    rounds,
    calls,
    saved: mutated && !opts.dryRun,
  };
}
