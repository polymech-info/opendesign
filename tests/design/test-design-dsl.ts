/**
 * Offline design DSL tests (no Fabric, no tanit-cli, no network).
 *
 *   npm run test:design
 *
 * Suites (same idea as tests/orchestrator/test-llm-server-tools.mjs, minus HTTP):
 *   1. query          — parse §17 sample + spec §16 predicates
 *   2. emulate        — loopback-shaped tool_calls against the IR
 *   3. project        — IR → Fabric JSON → IR
 *   4. roundtrip      — real Feature Cards design, Search → Audio Player
 *   5. custom-tools   — OpenAI function wrappers from createDesignTools()
 */
import assert from "node:assert/strict";
import {
  AUDIO_PLAYER,
  EXAMPLE_DSL,
  FEATURE_CARDS,
  FEATURE_CARD_SEED,
  applyEmittedDesignTools,
  applySearchToAudioPlayer,
  assistantReplyForDesignTools,
  shouldWarnDesignResponseTruncation,
  buildFeatureCardsDocument,
  dedupeToolCalls,
  isDesignToolOnlyReply,
  bundledFeatureCardsTemplate,
  designChatBrief,
  understandPicturePaths,
  attachDesignDocument,
  documentFromCanvasJson,
  pruneDocumentToCanvas,
  projectToFabricJSON,
  writeCliCanvasJson,
  validateFabricProjection,
  hostToolRunNeedsSceneRefresh,
  latestHostRevisionAfter,
  replayHostDesignRuns,
  shouldReloadInsteadOfSave,
  takeFreshHostSceneRuns,
  createDesignTools,
  designToolNames,
  dispatchDesignTool,
  emulateToolScript,
  parseDsl,
  parseEmittedToolCalls,
  queryNodes,
  resolveDesignDocument,
  serializeDsl,
  setActiveDocument,
  stripDesignToolJsonFromText,
  assistantDisplayText,
  applyUploadFromToolResult,
  autoApplyUploadPath,
  isCanvasImageUploadKey,
  parseEmittedMediaCalls,
  pathToolFailed,
  planCanvasApply,
  rememberScreenshotPath,
  replaceImageSrc,
  resolveUnderstandPaths,
  resolveUploadKey,
  screenshotResultForLog,
  toolFollowUpFromRuns,
} from "../../src/design/index.ts";
import { appendStreamDelta, dedupeRepeatedContent } from "../../src/client/modules/ai/streamText.ts";
import {
  applySseFrame,
  consumeSseBuffer,
  tanitCompletionBody,
  unwrapTanitToolCall,
} from "../../src/client/modules/ai/streamTanit.ts";
import { formatChatTranscript, formatMessageCopyText } from "../../src/client/modules/ai/chatTranscript.ts";

const stats = { passed: 0, failed: 0 };

function check(cond: unknown, msg: string) {
  if (cond) {
    stats.passed += 1;
    return;
  }
  stats.failed += 1;
  throw new Error(msg);
}

async function suite(name: string, fn: () => void | Promise<void>) {
  console.log(`\n=== ${name} ===`);
  await fn();
}

await suite("query", () => {
  const doc = parseDsl(EXAMPLE_DSL);
  check(doc.canvas.width === 1920 && doc.canvas.height === 1080, "canvas size");
  check(doc.theme === "tanit-light", "theme");
  check(doc.presets["card.soft"] != null, "preset card.soft");
  check(doc.widgets["feature-group"]?.nodes.length === 5, "widget children");
  check(doc.content["hero.title"]?.includes("Your AI"), "content binding");
  check(!doc.errors.length, `parse errors: ${JSON.stringify(doc.errors)}`);

  const titles = queryNodes(doc, { query: "type=txt role=title" });
  check(titles.length === 3, `titles expected 3, got ${titles.length}: ${JSON.stringify(titles.map((t) => t.id))}`);
  check(
    titles.some((t) => t.id === "hero.title") && titles.some((t) => t.id === "feature.chat.title"),
    "title ids include hero + widget instance",
  );

  const images = queryNodes(doc, { query: "type=img" });
  check(images.length === 1 && images[0].id === "hero", "one hero img");

  const large = queryNodes(doc, { query: "type=img w>=800" });
  check(large.length === 1, "large images");

  const features = queryNodes(doc, { query: "id^=feature." });
  check(features.length >= 8, `feature.* kids, got ${features.length}`);

  const bgs = queryNodes(doc, { query: "role=background" });
  check(bgs.length === 2, "two widget backgrounds");

  const dark = queryNodes(doc, { query: "preset=card.dark" });
  check(dark.length === 0, "no dark cards yet");

  const bound = queryNodes(doc, { query: "type=txt text^=@feature." });
  check(bound.length === 6, `feature text bindings, got ${bound.length}`);

  const shots = queryNodes(doc, { query: "type=img src*=screenshot" });
  check(shots.length === 1, "src contains screenshot via @hero.image");

  const orHits = queryNodes(doc, { query: "type=img | type=icon" });
  check(orHits.length === 3, `img|icon expected 3, got ${orHits.length}`);

  const dsl = serializeDsl(doc);
  check(dsl.includes("canvas main 1920 1080"), "serialize canvas");
  check(dsl.includes("txt hero.title"), "serialize hero.title");
  console.log("ok: query + parse + serialize");
});

await suite("emulate", () => {
  const doc = parseDsl(EXAMPLE_DSL);
  const script = [
    {
      tool_calls: [
        {
          id: "tc_q1",
          name: "design_query",
          arguments: { query: "type=txt role=title", fields: ["id", "x", "y", "style", "text"] },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "tc_u1",
          name: "design_update",
          arguments: { where: "role=background", set: { preset: "card.dark" }, dry_run: true },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "tc_u2",
          name: "design_update",
          arguments: { where: "role=background", set: { preset: "card.dark" } },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "tc_c1",
          name: "design_create",
          arguments: {
            objects: [
              {
                type: "txt",
                id: "badge.note",
                x: 80,
                y: 40,
                w: 200,
                h: 32,
                style: "caption",
                text: "@badge.note",
              },
            ],
          },
        },
      ],
    },
    {
      tool_calls: [
        {
          id: "tc_t1",
          name: "design_update",
          arguments: { where: "id=badge.note", transform: { x: "+20" } },
        },
      ],
    },
    { text: "emulate-done" },
  ];

  const preview = emulateToolScript(doc, script.slice(0, 2));
  const queried = preview.results[0].result as Array<{ id: string }>;
  check(Array.isArray(queried) && queried.length === 3, "emulated design_query");
  const dry = preview.results[1].result as { ok: boolean; matched: number; changed: number; diff: unknown[] };
  check(dry.ok && dry.matched === 2 && dry.diff.length === 2, "dry_run diff");
  check(queryNodes(doc, { query: "preset=card.dark" }).length === 0, "dry_run did not mutate");

  const { results, text } = emulateToolScript(doc, script.slice(2));
  check(text === "emulate-done", "script final text");

  const applied = results[0].result as { ok: boolean; changed: number };
  check(applied.ok && applied.changed === 2, "update applied");
  check(queryNodes(doc, { query: "preset=card.dark" }).length === 2, "backgrounds now card.dark");

  const created = results[1].result as { ok: boolean; created: string[] };
  check(created.ok && created.created.includes("badge.note"), "create badge.note");

  const moved = doc.nodes.find((n) => n.id === "badge.note");
  check(moved?.bounds.x === 100, `transform +20 → x=100, got ${moved?.bounds.x}`);

  const del = dispatchDesignTool("design_delete", { where: "id=badge.note" }, doc) as { deleted: string[] };
  check(del.deleted.includes("badge.note"), "delete badge.note");
  check(queryNodes(doc, { query: "id=badge.note" }).length === 0, "gone after delete");
  console.log("ok: loopback-shaped tool_calls mutate IR");
});

await suite("parse-emitted", () => {
  const one = parseEmittedToolCalls('{"name":"design_create","arguments":{"objects":[{"id":"a","type":"txt"}]}}');
  check(one[0]?.name === "design_create" && (one[0].arguments.objects as unknown[]).length === 1, "bare json call");
  const fenced = parseEmittedToolCalls('Sure.\n```json\n{"name":"design_query","arguments":{"query":"type=txt"}}\n```');
  check(fenced[0]?.name === "design_query", "fenced json");
  const many = parseEmittedToolCalls('{"tool_calls":[{"name":"design_update","arguments":{"where":"id=a","set":{"x":1}}},{"name":"done","arguments":{}}]}');
  check(many.length === 1 && many[0].name === "design_update", "tool_calls array skips done");
  const glued =
    '{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search Files"}}}{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search Files"}}}';
  const duped = parseEmittedToolCalls(glued);
  check(duped.length === 1 && duped[0].name === "design_update", "concatenated identical JSON — deduped to one");
  const batch =
    '{"name":"design_update","arguments":{"patches":[{"id":"image_1","set":{"x":1008}}]}}' +
    '{"name":"design_delete","arguments":{"where":"id=feature.chat.copy"}}';
  const batched = parseEmittedToolCalls(batch);
  check(
    batched.length === 2 && batched[0].name === "design_update" && batched[1].name === "design_delete",
    "two glued design_* blobs both run",
  );
  const braces = parseEmittedToolCalls(
    '{"name":"design_update","arguments":{"where":"id=a.title","set":{"text":"Use {braces} here"}}}',
  );
  check(braces[0]?.name === "design_update", "braces inside string values");
  const wrapped = parseEmittedToolCalls(
    '{"tool_calls":[{"type":"function","function":{"name":"design_query","arguments":{"query":"type=txt"}}}]}',
  );
  check(wrapped[0]?.name === "design_query", "openai function wrapper in tool_calls");
  const truncated =
    '{"tool_calls":[{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.security","x":80,"y":568,"bindings":{"icon":"shield","title":"Security","caption":"Privacy and protection","body":"Manage passwords, permissions ';
  const repaired = parseEmittedToolCalls(truncated);
  check(repaired[0]?.name === "design_use_widget" && repaired[0].arguments.id === "feature.security", "repair truncated tool_calls JSON");
  const multi =
    '{"tool_calls":[{"name":"design_search_icons","arguments":{"query":"security shield","source":"all"}},{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.security","x":524,"y":80,"bindings":{"icon":"shield","title';
  const salvaged = parseEmittedToolCalls(multi);
  check(salvaged[0]?.name === "design_search_icons", "salvage complete first tool in truncated array");
  check(salvaged.some((c) => c.name === "design_use_widget"), "repair truncated use_widget in array");
  const mixed = 'Done.\n{"name":"design_export","arguments":{"format":"dsl"';
  check(stripDesignToolJsonFromText(mixed) === "Done.", "strip partial design JSON from prose");
  check(
    assistantDisplayText(mixed, [], { parseFailed: true }).includes("cut off"),
    "display text for truncated export",
  );
  const reportThenTool =
    "## Totals\n- **26 nodes**\n" +
    '{"name":"design_create","arguments":{"objects":[{"type":"shape","id":"cards.pane","x":48,"y":48,"w":928,"h":528,"fill":"#02061799","glass":true}],"behind":true}}';
  check(parseEmittedToolCalls(reportThenTool)[0]?.name === "design_create", "salvage create after scene report");
  const junkOnly = '## Totals\n- **26 nodes**\n{"fill":"#f8fafc","size":18,"font":"Inter"}';
  check(parseEmittedToolCalls(junkOnly).length === 0, "non-tool JSON is not a design call");
  check(
    assistantDisplayText(junkOnly, [], { parseFailed: true }).includes("described the scene"),
    "display text when model dumped a scene report",
  );
  const shotCall = parseEmittedToolCalls('{"name":"design_screenshot","arguments":{"reason":"overlap"}}');
  check(shotCall[0]?.name === "design_screenshot", "parse design_screenshot");
  const shot = dispatchDesignTool("design_screenshot", { reason: "overlap" }) as { ok?: boolean; pending?: string };
  check(shot.ok && shot.pending === "canvas", "screenshot waits for canvas capture");
  const shotPlan = planCanvasApply([
    { name: "design_screenshot", result: { ok: true, pending: "canvas" } },
    {
      name: "design_update",
      result: { ok: true, matched: 1, changed: 0, touched: ["feature.chat.bg"] },
    },
  ]);
  check(shotPlan.mode === "patch" && shotPlan.styleNodeIds?.includes("feature.chat.bg"), "screenshot does not force full reload");
  check(
    assistantDisplayText('{"name":"design_screenshot","arguments":{}}', [
      { name: "design_screenshot", result: { ok: true, path: "uploads/screenshots/canvas-1.jpg" } },
    ]).includes("image_understand"),
    "screenshot feedback tells the model to request image_understand",
  );
  const understandCall = parseEmittedToolCalls(
    '{"name":"image_understand","arguments":{"paths":["uploads/screenshots/canvas-1.jpg"],"prompt":"overlaps?"}}',
  );
  check(understandCall[0]?.name === "image_understand", "parse image_understand");
  check(
    parseEmittedMediaCalls('{"name":"image_understand","arguments":{"paths":["uploads/screenshots/canvas-1.jpg"]}}').length === 1,
    "image_understand is a media tool",
  );
  const logged = screenshotResultForLog("design_screenshot", {
    ok: true,
    path: "uploads/screenshots/canvas-1.jpg",
    image: "data:image/jpeg;base64,xx",
  }) as { path?: string; image?: string };
  check(logged.path === "uploads/screenshots/canvas-1.jpg" && !logged.image, "log keeps path, drops pixels");
  check(!isCanvasImageUploadKey("uploads/screenshots/canvas-1.jpg"), "screenshots are not canvas images");
  const follow = toolFollowUpFromRuns(
    [{ name: "design_screenshot", result: { ok: true, path: "uploads/screenshots/canvas-1.jpg" } }],
    { canFollowShot: true, canFollowUnderstand: true },
  );
  check(follow?.kind === "screenshot" && follow.content.includes("image_understand") && !follow.content.includes("data:"), "follow-up is path-only");
  const understandFollow = toolFollowUpFromRuns(
    [{ name: "image_understand", result: { ok: true, answer: "pane overlaps image_1" } }],
    { canFollowShot: false, canFollowUnderstand: true },
  );
  check(understandFollow?.kind === "understand" && understandFollow.content.includes("design_*"), "understand follow-up asks for design_*");
  check(
    toolFollowUpFromRuns(
      [{ name: "image_understand", result: { ok: true, answer: "a cat" } }],
      { canFollowShot: true, canFollowUnderstand: false },
    ) === null,
    "describe-only understand does not follow up",
  );
  const longAnswer = `${"A wide landscape photo with mountains and a lake. ".repeat(12)}End.`;
  check(
    assistantDisplayText('{"name":"image_understand","arguments":{}}', [
      { name: "image_understand", result: { ok: true, results: [{ answer: longAnswer }] } },
    ]).includes("End."),
    "understand answer is shown in full",
  );
  check(assistantDisplayText('{"tool_calls":[]}', []).trim() === "", "empty tool_calls is not shown");
  rememberScreenshotPath("uploads/1789171201377_phj16w.jpg");
  check(
    resolveUnderstandPaths(["uploads/178917120137_phj16w.jpg"])[0] === "uploads/1789171201377_phj16w.jpg",
    "rewrites truncated screenshot filename",
  );
  check(resolveUnderstandPaths(["uploads/product-v1.png"])[0] === "uploads/product-v1.png", "leaves real image paths alone");
  check(
    pathToolFailed({
      ok: true,
      results: [{ ok: false, error: "input not found: uploads/178917120137_phj16w.jpg" }],
      summary: { failed: 1, succeeded: 0, total: 1 },
    }),
    "nested image_understand miss is a failure",
  );
  check(
    assistantDisplayText("", [
      {
        name: "image_understand",
        result: {
          ok: false,
          error: "input not found: uploads/178917120137_phj16w.jpg",
        },
      },
    ]).includes("not found"),
    "understand error is shown",
  );
  console.log("ok: parseEmittedToolCalls");
});

await suite("feature-cards", () => {
  check(parseDsl(FEATURE_CARD_SEED).widgets["feature-group"]?.nodes.length === 5, "seed widget slots");
  const doc = buildFeatureCardsDocument();

  const instances = doc.nodes.filter((n) => n.type === "use").sort((a, b) => a.bounds.y - b.bounds.y);
  check(instances.length === 3, `three instances, got ${instances.length}`);
  for (const card of FEATURE_CARDS) {
    const title = doc.nodes.find((n) => n.id === `${card.id}.title`);
    const icon = doc.nodes.find((n) => n.id === `${card.id}.icon`);
    const caption = doc.nodes.find((n) => n.id === `${card.id}.caption`);
    const body = doc.nodes.find((n) => n.id === `${card.id}.body`);
    check(title?.text === card.title, `${card.id}.title`);
    check(icon?.props.icon === card.icon, `${card.id}.icon`);
    check(caption?.text === card.caption, `${card.id}.caption`);
    check(body?.text === card.body, `${card.id}.body`);
  }
  const expectedY = [80, 324, 568];
  instances.forEach((inst, i) => {
    check(inst.bounds.x === 80, `${inst.id} left x=80 got ${inst.bounds.x}`);
    check(inst.bounds.y === expectedY[i], `${inst.id} y=${expectedY[i]} got ${inst.bounds.y}`);
    check(inst.bounds.x + inst.bounds.w <= 960, `${inst.id} stays on left half`);
  });
  const firstIcon = doc.nodes.find((n) => n.id === `${instances[0].id}.icon`);
  check(firstIcon?.bounds.x === 104 && firstIcon?.bounds.y === 104, `child follows parent ${JSON.stringify(firstIcon?.bounds)}`);
  console.log("ok: 3 feature cards filled + column top-left");
});

await suite("patch-projection", () => {
  const doc = buildFeatureCardsDocument();
  const bg = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.bg", set: { fill: "#ff0000", stroke: "#00ff00", radius: 32 } }] },
    doc,
  ) as { ok?: boolean; changed?: number };
  check(bg.ok && bg.changed === 1, "shape bg patch");
  const bgObj = JSON.parse(projectToFabricJSON(doc)).objects.find((o: { _id?: string }) => o._id === "feature.chat.bg");
  check(bgObj?.fill === "#ff0000" && bgObj?.rx === 32, "bg fill/radius projected");

  dispatchDesignTool("design_update", { patches: [{ id: "feature.chat.title", set: { color: "#2563eb" } }] }, doc);
  const title = JSON.parse(projectToFabricJSON(doc)).objects.find((o: { _id?: string }) => o._id === "feature.chat.title");
  check(title?.fill === "#2563eb", "color alias maps to fill on txt");

  const icon = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.icon", set: { fill: "#2563eb" } }] },
    doc,
  ) as { warnings?: Array<{ field?: string }>; ok?: boolean };
  check(icon.ok && !icon.warnings?.length, "icon fill is projectable");
  const iconObj = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string }) => o._id === "feature.chat.icon",
  );
  check(iconObj?._iconFill === "#2563eb", "icon fill in fabric json");

  const shadowPatch = dispatchDesignTool(
    "design_update",
    {
      patches: [
        {
          id: "feature.chat.bg",
          set: { shadow: { x: 8, y: 8, blur: 0, color: "#0f172a40" }, strokeWidth: 2 },
        },
      ],
    },
    doc,
  ) as { ok?: boolean; warnings?: unknown[] };
  check(shadowPatch.ok && !shadowPatch.warnings?.length, "shape shadow is projectable");
  const shadowBg = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; shadow?: { offsetX?: number; color?: string }; strokeWidth?: number }) =>
      o._id === "feature.chat.bg",
  );
  check(shadowBg?.shadow?.offsetX === 8 && shadowBg?.shadow?.color === "#0f172a40", "shadow projected to Fabric");
  check(shadowBg?.strokeWidth === 2, "strokeWidth projected");
  const shadowNode = doc.nodes.find((n) => n.id === "feature.chat.bg");
  check(shadowNode?.props.shadow?.includes('"x":8'), "shadow stored as JSON in props");

  dispatchDesignTool("design_update", { patches: [{ id: "feature.files.bg", set: { shadow: "soft" } }] }, doc);
  const softBg = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; shadow?: { blur?: number } }) => o._id === "feature.files.bg",
  );
  check(softBg?.shadow?.blur === 24, "named shadow=soft preset");

  const glass = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.bg", set: { glass: true } }] },
    doc,
  ) as { warnings?: unknown[]; ok?: boolean };
  check(glass.ok && !glass.warnings?.length, "glass is projectable on shapes");
  const glassBg = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; _stylePreset?: string }) => o._id === "feature.chat.bg",
  );
  check(glassBg?._stylePreset === "glass", "glass preset in fabric json");

  const border = dispatchDesignTool(
    "design_update",
    {
      patches: [{
        id: "feature.files.bg",
        set: { border: "rim", borderOptions: { width: 2.5, opacity: 0.6 } },
      }],
    },
    doc,
  ) as { warnings?: unknown[]; ok?: boolean };
  check(border.ok && !border.warnings?.length, "border is projectable on shapes");
  const borderBg = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; _stylePreset?: string; _borderOptions?: { kind?: string; width?: number }; stroke?: string }) =>
      o._id === "feature.files.bg",
  );
  check(borderBg?._stylePreset === "border", "border preset in fabric json");
  check(borderBg?._borderOptions?.kind === "rim", "border=rim seeds rim kind");
  check(borderBg?.stroke === "", "border projection clears native stroke");

  const glassWins = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.files.bg", set: { glass: true, border: true } }] },
    doc,
  ) as { ok?: boolean };
  check(glassWins.ok, "glass+border patch ok");
  const bothBg = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; _stylePreset?: string }) => o._id === "feature.files.bg",
  );
  check(bothBg?._stylePreset === "glass", "glass wins when both overlays are set");
  dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.files.bg", set: { glass: false, border: false } }] },
    doc,
  );

  dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.title", set: { shadow: { x: 0, y: 2, blur: 8, color: "#0f172a30" } } }] },
    doc,
  );
  const titleShadow = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; shadow?: { blur?: number } }) => o._id === "feature.chat.title",
  );
  check(titleShadow?.shadow?.blur === 8, "txt shadow projected");

  dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.icon", set: { shadow: "soft" } }] },
    doc,
  );
  const iconShadow = JSON.parse(projectToFabricJSON(doc)).objects.find(
    (o: { _id?: string; shadow?: { blur?: number } }) => o._id === "feature.chat.icon",
  );
  check(iconShadow?.shadow?.blur === 24, "icon shadow projected");
  console.log("ok: patch keys + projection");
});

await suite("project-use-widget", async () => {
  const doc = buildFeatureCardsDocument();
  const text =
    '{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.audio","x":968,"y":80,"bindings":{"icon":"audio-player","title":"Audio Recording","caption":"Capture sound","body":"Record and manage audio clips."}}}';
  const ran = await applyEmittedDesignTools(text, doc);
  const result = ran[0]?.result as { ok?: boolean } | undefined;
  check(result?.ok === true, "design_use_widget adds feature.audio");
  const fabric = projectToFabricJSON(doc);
  const report = validateFabricProjection(doc, fabric);
  check(report.ok, `projection complete missing=${report.missing.join(",")}`);
  const canvas = JSON.parse(fabric) as { objects: Array<{ _id?: string; text?: string }> };
  check(canvas.objects.some((o) => o._id === "feature.audio.bg"), "audio card bg projected");
  check(
    canvas.objects.some((o) => o._id === "feature.audio.title" && o.text === "Audio Recording"),
    "audio title text projected",
  );
  check(doc.nodes.filter((n) => n.type === "use").length === 4, "four use instances in IR");
  console.log("ok: design_use_widget → Fabric projection");
});

await suite("project-fabric", () => {
  const doc = buildFeatureCardsDocument();
  const raw = projectToFabricJSON(doc, { source: "feature-cards" });
  const canvas = JSON.parse(raw) as {
    objects: Array<{ type: string; _id?: string; left?: number; top?: number; text?: string; src?: string }>;
    _designDsl?: string;
    _designSource?: string;
  };
  check(canvas._designSource === "feature-cards", "source tag");
  check(typeof canvas._designDsl === "string" && canvas._designDsl.includes("use feature-group as=feature.chat"), "dsl attached");
  const titles = canvas.objects.filter((o) => o._id?.endsWith(".title"));
  check(titles.length === 3, `three titles, got ${titles.length}`);
  check(titles[0]?.text === FEATURE_CARDS[0].title, "first title text");
  const firstBg = canvas.objects.find((o) => o._id === "feature.chat.bg");
  check(firstBg?.type === "Rect" && firstBg.left === 80 && firstBg.top === 80, `chat bg at 80,80 got ${firstBg?.left},${firstBg?.top}`);
  const icon = canvas.objects.find((o) => o._id === "feature.chat.icon");
  check(!!icon?.src?.includes("message-circle"), `chat icon src ${icon?.src}`);
  const roundtrip = documentFromCanvasJson(raw);
  check(roundtrip?.nodes.some((n) => n.id === "feature.search") === true, "reopen IR from canvas json");
  console.log("ok: feature cards project to Fabric JSON");
});

await suite("roundtrip-search-to-audio", () => {
  const template = bundledFeatureCardsTemplate();
  const opened = documentFromCanvasJson(template.canvas_json);
  check(!!opened, "open projected Feature Cards design");
  check(opened!.nodes.some((n) => n.id === "feature.search.title" && n.text === "Search"), "search card present");

  applySearchToAudioPlayer(opened!);

  const title = opened!.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.title`);
  const icon = opened!.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.icon`);
  const caption = opened!.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.caption`);
  const body = opened!.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.body`);
  check(title?.text === AUDIO_PLAYER.title, `title → ${AUDIO_PLAYER.title}`);
  check(icon?.props.icon === AUDIO_PLAYER.icon, `icon → ${AUDIO_PLAYER.icon}`);
  check(caption?.text === AUDIO_PLAYER.caption, "caption swapped");
  check(body?.text === AUDIO_PLAYER.body, "body swapped");
  check(opened!.nodes.find((n) => n.id === "feature.chat.title")?.text === FEATURE_CARDS[0].title, "chat unchanged");
  check(opened!.nodes.find((n) => n.id === "feature.files.title")?.text === FEATURE_CARDS[1].title, "files unchanged");
  check(opened!.nodes.find((n) => n.id === AUDIO_PLAYER.id)?.bounds.y === 568, "search slot stays y=568");

  const projected = JSON.parse(projectToFabricJSON(opened!)) as {
    objects: Array<{ _id?: string; text?: string; src?: string; _iconName?: string }>;
    _designDsl?: string;
  };
  const fabricTitle = projected.objects.find((o) => o._id === `${AUDIO_PLAYER.id}.title`);
  const fabricIcon = projected.objects.find((o) => o._id === `${AUDIO_PLAYER.id}.icon`);
  const fabricChat = projected.objects.find((o) => o._id === "feature.chat.title");
  check(fabricTitle?.text === AUDIO_PLAYER.title, "Fabric title is Audio Player");
  check(!!fabricIcon?.src?.includes("player-play") || fabricIcon?._iconName === "player-play", `Fabric icon ${fabricIcon?.src}`);
  check(fabricChat?.text === FEATURE_CARDS[0].title, "Fabric chat title unchanged");

  const again = documentFromCanvasJson(projectToFabricJSON(opened!));
  check(again?.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.title`)?.text === AUDIO_PLAYER.title, "IR from re-projected canvas");
  check(again?.nodes.find((n) => n.id === "feature.chat.title")?.text === FEATURE_CARDS[0].title, "chat survives canvas reopen");

  const parsed = parseDsl(serializeDsl(opened!));
  check(parsed.nodes.find((n) => n.id === `${AUDIO_PLAYER.id}.title`)?.text === AUDIO_PLAYER.title, "DSL serialize → parse keeps Audio Player");
  check(parsed.nodes.find((n) => n.id === AUDIO_PLAYER.id)?.bounds.y === 568, "DSL round-trip keeps column slot");
  console.log("ok: Feature Cards design → audio player → Fabric + DSL round-trip");
});

await suite("chat-brief-host-tools", async () => {
  const doc = documentFromCanvasJson(bundledFeatureCardsTemplate().canvas_json)!;
  const brief = designChatBrief(doc, { selectionIds: ["feature.search.title"] });
  check(brief.includes("SCENE:"), "brief has scene");
  check(brief.includes("feature.search.title"), "brief lists search title");
  check(brief.includes("design_update"), "brief lists design_update");
  check(brief.includes("design_search_icons"), "brief lists icon search");
  check(brief.includes("design_screenshot"), "brief lists screenshot");
  check(brief.includes("image_understand"), "brief lists image_understand");
  check(brief.includes("PICTURES:"), "brief has PICTURES block");
  check(/design_set_page_background/i.test(brief), "brief routes page bg through design_set_page_background");
  check(/full-page/i.test(brief), "brief forbids full-page shape backgrounds");
  check(brief.includes("SELECTION: feature.search.title"), "brief carries selection");
  check(brief.includes("Never say there is no UI"), "brief forbids disconnected-UI reply");
  check(brief.includes("answer from SELECTION"), "brief answers selection from SELECTION");
  check(brief.includes("CANVAS pixels"), "brief warns x/y are canvas, not slot locals");
  check(brief.includes("not workspace files"), "tells agent not to edit workspace files");
  check(brief.includes("native tools"), "brief says design tools are native");
  check(!brief.includes("emit JSON below"), "brief does not ask the model to emit JSON");
  const guided = designChatBrief(doc, {
    guides: { styleGuide: "Glass cards use #0F172ACC.", skill: "Store Chat is 1920x1080." },
  });
  check(guided.includes("STYLE_GUIDE"), "brief injects style_guide.md");
  check(guided.includes("Glass cards use #0F172ACC."), "brief carries style guide body");
  check(guided.includes("SKILL"), "brief injects SKILL.md");
  check(guided.includes("Store Chat is 1920x1080."), "brief carries skill body");

  const emitted =
    '{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search files."}}}{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search files."}}}';
  const ran = await applyEmittedDesignTools(emitted, doc);
  check(ran.length === 1 && ran[0].name === "design_update", "host deduped duplicate design_update");
  check(doc.nodes.find((n) => n.id === "feature.search.title")?.text === "Search files.", "title patched from streamed JSON");
  const fabric = JSON.parse(projectToFabricJSON(doc)) as { objects: Array<{ _id?: string; text?: string }> };
  check(fabric.objects.find((o) => o._id === "feature.search.title")?.text === "Search files.", "re-project shows Search files.");
  console.log("ok: brief + native tools (CLI emit path still parses JSON)");
});

await suite("icon-search", async () => {
  const audio = dispatchDesignTool("design_search_icons", { query: "audio" }) as {
    icons: Array<{ id: string; source: string }>;
  };
  check(audio.icons.some((h) => h.id === "player-play"), `audio → player-play ${JSON.stringify(audio.icons.map((h) => h.id))}`);
  const chat = dispatchDesignTool("design_search_icons", { query: "chat" }) as {
    icons: Array<{ id: string }>;
  };
  check(chat.icons.some((h) => h.id === "message-circle"), "chat → message-circle");

  const doc = documentFromCanvasJson(bundledFeatureCardsTemplate().canvas_json)!;
  const ran = await applyEmittedDesignTools(
    '{"tool_calls":[{"name":"design_search_icons","arguments":{"query":"audio","source":"local"}},{"name":"design_update","arguments":{"where":"id=feature.search.icon","set":{"icon":"player-play"}}}]}',
    doc,
  );
  check(ran.some((r) => r.name === "design_search_icons"), "host ran icon search");
  check(doc.nodes.find((n) => n.id === "feature.search.icon")?.props.icon === "player-play", "icon set from search hit");
  const fabric = JSON.parse(projectToFabricJSON(doc)) as { objects: Array<{ _id?: string; src?: string; _iconName?: string }> };
  const icon = fabric.objects.find((o) => o._id === "feature.search.icon");
  check(!!icon?.src?.includes("player-play") || icon?._iconName === "player-play", `projected icon ${icon?.src}`);
  console.log("ok: design_search_icons + apply hit");
});

await suite("delete-use-instance", () => {
  const doc = buildFeatureCardsDocument();
  check(doc.nodes.some((n) => n.id === "feature.search"), "search card before delete");
  const childCount = doc.nodes.filter((n) => n.id.startsWith("feature.search.")).length;
  check(childCount >= 4, `search children ${childCount}`);

  const del = dispatchDesignTool("design_delete", { where: "id=feature.search" }, doc) as {
    deleted: string[];
    matched: number;
  };
  check(del.deleted.includes("feature.search"), "deleted root use instance");
  check(!doc.nodes.some((n) => n.id === "feature.search"), "search instance gone");
  check(!doc.nodes.some((n) => n.id.startsWith("feature.search.")), "search children gone");
  check(doc.nodes.filter((n) => n.type === "use").length === 2, "two feature cards remain");

  const fabric = JSON.parse(projectToFabricJSON(doc)) as { objects: Array<{ _id?: string }> };
  check(!fabric.objects.some((o) => o._id?.startsWith("feature.search")), "fabric has no search layers");
  console.log("ok: design_delete where=id=feature.search");
});

await suite("resolve-after-undo", () => {
  const full = buildFeatureCardsDocument();
  const deleted = buildFeatureCardsDocument();
  dispatchDesignTool("design_delete", { where: "id=feature.search" }, deleted);
  setActiveDocument(deleted);
  check(!full.nodes.some((n) => n.id === "feature.search") === false, "full doc still has search");
  check(!deleted.nodes.some((n) => n.id === "feature.search"), "deleted doc missing search");

  const undoStack = projectToFabricJSON(full);
  const resolved = resolveDesignDocument([undoStack]);
  check(resolved?.nodes.some((n) => n.id === "feature.search"), "resolve re-reads undo stack instead of stale active");
  setActiveDocument(null);
  console.log("ok: resolveDesignDocument after undo");
});

await suite("prune-deleted-canvas-nodes", () => {
  const dsl = [
    "canvas main 1920 1080",
    "widget feature-group w=420 h=220",
    "  shape bg x=0 y=0 w=100% h=100%",
    "shape screenshot.pane x=56 y=96 w=848 h=498",
    "shape cards.pane x=896 y=96 w=912 h=512",
    "use feature-group as=feature.chat x=920 y=120",
  ].join("\n");
  const doc = parseDsl(dsl);
  check(doc.nodes.some((n) => n.id === "screenshot.pane"), "dsl still lists screenshot.pane");
  const live = JSON.stringify({
    objects: [
      {
        _id: "group_1",
        type: "Group",
        objects: [
          { _id: "feature.chat.bg", type: "Rect" },
          { _id: "feature.chat.title", type: "Textbox" },
        ],
      },
    ],
  });
  const removed = pruneDocumentToCanvas(doc, live);
  check(removed.includes("screenshot.pane") && removed.includes("cards.pane"), "prune drops deleted panes");
  check(!doc.nodes.some((n) => n.id === "screenshot.pane"), "screenshot.pane gone from IR");
  check(doc.nodes.some((n) => n.id === "feature.chat"), "grouped use instance kept");
  check(doc.nodes.some((n) => n.id === "feature.chat.bg"), "grouped child kept");

  const stale = parseDsl(dsl);
  const resolved = resolveDesignDocument([stale, live]);
  check(!resolved?.nodes.some((n) => n.id === "screenshot.pane"), "resolve prunes stale in-memory IR against live canvas");
  check(!serializeDsl(resolved!).includes("screenshot.pane"), "serialized SCENE no longer defines screenshot.pane");

  const attached = JSON.parse(attachDesignDocument(live, parseDsl(dsl))) as { _designDsl?: string };
  check(!attached._designDsl?.includes("screenshot.pane"), "save attaches pruned DSL");
  console.log("ok: prune deleted canvas nodes from _designDsl");
});

await suite("uploads-and-backgrounds", async () => {
  const doc = buildFeatureCardsDocument();
  const bg = dispatchDesignTool("design_set_page_background", {
    src: "uploads/backgrounds/hero-v1.png",
  }, doc) as { ok?: boolean };
  check(bg.ok, "set page background");
  check(doc.pageBackground === "uploads/backgrounds/hero-v1.png", "pageBackground stored");
  const fabric = JSON.parse(projectToFabricJSON(doc)) as {
    objects: Array<{ _id?: string; src?: string; _isBgImage?: boolean }>;
  };
  const bgIdx = fabric.objects.findIndex((o) => o._id === "canvas.bg");
  const photoIdx = fabric.objects.findIndex((o) => o._id === "canvas.photo");
  check(bgIdx >= 0 && photoIdx > bgIdx, "canvas.photo stacks above theme fill");
  check(!fabric.objects[bgIdx]?._isBgImage, "theme fill is not a bg image layer");
  check(
    fabric.objects.some((o) => o._id === "canvas.photo" && o._isBgImage && o.src?.includes("hero-v1")),
    "canvas.photo projected",
  );
  const existingNoPhoto = projectToFabricJSON(buildFeatureCardsDocument());
  const persistedBg = JSON.parse(writeCliCanvasJson(existingNoPhoto, doc)) as {
    objects: Array<{ _id?: string; src?: string; _isBgImage?: boolean }>;
    _designDsl?: string;
  };
  check(
    persistedBg.objects.some((o) => o._id === "canvas.photo" && o._isBgImage && o.src?.includes("hero-v1")),
    "cli persist inserts canvas.photo when IR has a page background",
  );
  check(persistedBg._designDsl?.includes("background uploads/backgrounds/hero-v1.png") === true, "cli persist keeps background in DSL");

  const img = dispatchDesignTool("design_insert_image", {
    id: "hero.photo",
    src: "uploads/product-v1.png",
    x: 100,
    y: 80,
    w: 640,
    h: 480,
  }, doc) as { ok?: boolean; created?: string[] };
  check(img.ok && img.created?.[0] === "hero.photo", "insert image");
  const photo = fabric.objects.find((o) => o._id === "hero.photo")
    ?? JSON.parse(projectToFabricJSON(doc)).objects.find((o: { _id?: string }) => o._id === "hero.photo");
  check(photo?.src?.includes("product-v1"), "inserted image src");

  const dsl = serializeDsl(doc);
  check(dsl.includes("background uploads/backgrounds/hero-v1.png"), "background in DSL");
  const roundtrip = parseDsl(dsl);
  check(roundtrip.pageBackground === "uploads/backgrounds/hero-v1.png", "background DSL round-trip");
  check(roundtrip.nodes.some((n) => n.id === "hero.photo"), "image node round-trip");

  const applied = autoApplyUploadPath(buildFeatureCardsDocument(), "uploads/backgrounds/auto-v2.png");
  check(applied?.tool === "design_set_page_background", "auto apply backgrounds folder");
  const appliedImg = autoApplyUploadPath(buildFeatureCardsDocument(), "uploads/still-v1.png");
  check(appliedImg?.tool === "design_insert_image", "auto apply uploads image");
  let replaceDoc = buildFeatureCardsDocument();
  dispatchDesignTool(
    "design_insert_image",
    { id: "hero.photo", src: "uploads/hero-v1.png", x: 10, y: 20, w: 400, h: 300 },
    replaceDoc,
  );
  const replaced = replaceImageSrc(replaceDoc, "hero.photo", "uploads/hero-v2.png");
  check(replaced.ok && replaceDoc.nodes.find((n) => n.id === "hero.photo")?.src?.includes("hero-v2"), "replace image src");
  const replaceApply = autoApplyUploadPath(replaceDoc, "uploads/hero-v3.png", { replaceId: "hero.photo" });
  check(replaceApply?.tool === "design_update", "auto apply replaces selected image");
  check(
    designChatBrief(replaceDoc, { selectionIds: ["hero.photo"] }).includes("hero.photo type=img src=uploads/"),
    "brief selection includes image src",
  );
  const projectRoot = "C:/Users/zx/Desktop/pixlwiz/pixlwiz/infrastructure/OpenDesign/.OpenDesign";
  const pictured = designChatBrief(replaceDoc, {
    selectionIds: ["hero.photo"],
    projectRoot,
    attachments: [{ name: "clip.png", src: "uploads/clip.png" }],
  });
  check(pictured.includes("PICTURES"), "brief lists PICTURES");
  check(pictured.includes(`${projectRoot}/uploads/hero-v3.png`), "brief lists selected image as absolute path");
  check(
    pictured.includes(`${projectRoot}/uploads/clip.png`) || pictured.includes(`${projectRoot}\\uploads\\clip.png`),
    "brief lists chat attachment as absolute path",
  );
  check(/do not say you cannot see the picture/i.test(pictured), "brief tells agent to call image_understand");
  check(!/info_lookup/i.test(pictured) || pictured.includes("Do not use info_lookup"), "brief forbids info_lookup for pictures");
  const understandSelected = understandPicturePaths(replaceDoc, {
    selectionIds: ["hero.photo"],
    projectRoot,
    attachments: [{ name: "clip.png", src: "uploads/clip.png" }],
  });
  check(
    understandSelected.length === 1 && understandSelected[0]!.includes("uploads/hero-v3.png"),
    "understand prefers the selected canvas image over chat attachments",
  );
  const understandAttached = understandPicturePaths(replaceDoc, {
    projectRoot,
    attachments: [{ name: "clip.png", src: "uploads/clip.png" }],
  });
  check(understandAttached.length === 1 && understandAttached[0]!.includes("uploads/clip.png"), "understand falls back to attachments");
  const understandNone = understandPicturePaths(buildFeatureCardsDocument(), { projectRoot });
  check(understandNone.length === 0, "understand does not guess among many canvas images");
  const abs =
    "C:/Users/zx/Desktop/pixlwiz/pixlwiz/infrastructure/OpenDesign/.OpenDesign/uploads/backgrounds/soft-blue-abstract-v1.png";
  check(
    resolveUploadKey(abs) === "uploads/backgrounds/soft-blue-abstract-v1.png",
    "absolute Windows path normalizes to upload key",
  );
  const appliedAbs = autoApplyUploadPath(buildFeatureCardsDocument(), abs);
  check(appliedAbs?.tool === "design_set_page_background", "auto apply from absolute path");
  const transformApply = applyUploadFromToolResult(
    replaceDoc,
    "image_transform",
    {
      ok: true,
      results: [{ ok: true, output_path: `${projectRoot}/uploads/hero-v4.png` }],
    },
    { paths: [`${projectRoot}/uploads/hero-v3.png`] },
  );
  check(transformApply?.tool === "design_update", "transform result replaces the source img");
  check(replaceDoc.nodes.find((n) => n.id === "hero.photo")?.src?.includes("hero-v4"), "source img src updated");
  const srcHit = queryNodes(replaceDoc, { query: "id=hero.photo", fields: ["src"] });
  check(String(srcHit[0]?.src ?? "").startsWith("uploads/"), "query src is an upload key, not /api/uploads/file");
  const mediaOnly = await applyEmittedDesignTools(
    '{"name":"image_create","arguments":{"output_path":"uploads/backgrounds/x.png","options":{"prompt":"x"}}}',
    buildFeatureCardsDocument(),
  );
  check(!mediaOnly.some((r) => r.name === "image_create"), "design dispatch skips image_create");
  const stripped = stripDesignToolJsonFromText(
    '{"name":"image_transform","arguments":{"paths":["uploads/a.png"],"output_path":"uploads/b.png"}}',
  );
  check(!stripped.includes("image_transform"), "strip image_transform JSON from chat");
  const echoed =
    '{"name":"image_transform","arguments":{"paths":["uploads/old.png"],"output_path":"uploads/new.png"}}' +
    '\nDone.\n' +
    '{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.local","x":1,"y":2,"bindings":{"icon":"cpu","title":"T","caption":"C","body":"B"}}}';
  const echoedCalls = parseEmittedToolCalls(echoed);
  check(echoedCalls.length === 1 && echoedCalls[0]?.name === "design_use_widget", "last JSON tool blob wins");
  const noopPlan = planCanvasApply([
    {
      name: "design_update",
      result: { ok: true, matched: 5, changed: 0, touched: ["feature.local.bg", "feature.local.icon"] },
    },
  ]);
  check(noopPlan.mode === "patch" && noopPlan.styleNodeIds?.length === 2, "style-only update patches canvas in place");
  let cards = buildFeatureCardsDocument();
  dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.bg", set: { fill: "#112233", glass: true } }] },
    cards,
  );
  dispatchDesignTool("design_use_widget", {
    widget: "feature-group",
    id: "feature.local",
    x: 524,
    y: 324,
    bindings: { icon: "cpu", title: "Local", caption: "Cap", body: "Body" },
  }, cards);
  const copied = dispatchDesignTool("design_copy_styles", { from: "feature.chat", to: "feature.local" }, cards) as {
    ok?: boolean;
    changed?: number;
  };
  check(copied.ok, "copy styles");
  check(
    cards.nodes.find((n) => n.id === "feature.local.bg")?.props.glass === "true",
    "local bg glass copied",
  );
  check(
    cards.nodes.find((n) => n.id === "feature.local.icon")?.props.icon === "cpu",
    "copy styles keeps icon identity",
  );
  const pane = dispatchDesignTool(
    "design_create",
    {
      behind: true,
      objects: [
        {
          type: "shape",
          id: "cards.pane",
          x: 48,
          y: 48,
          w: 928,
          h: 528,
          fill: "#02061799",
          glass: true,
          radius: 32,
        },
      ],
    },
    cards,
  ) as { ok?: boolean; created?: string[] };
  check(pane.ok && pane.created?.includes("cards.pane"), "create pane");
  const aliasDoc = parseDsl("canvas main 800 600");
  const aliased = dispatchDesignTool(
    "design_create",
    {
      objects: [
        { type: "rect", id: "card1", x: 40, y: 40, w: 200, h: 120, fill: "#FFFFFF" },
        { type: "icon", id: "card1-icon", x: 56, y: 56, w: 32, h: 32, icon: "star" },
        { type: "text", id: "card1-title", x: 56, y: 96, w: 160, h: 28, text: "Fast" },
      ],
    },
    aliasDoc,
  ) as { ok?: boolean; created?: string[] };
  check(aliased.ok && aliased.created?.includes("card1"), "create accepts type=rect");
  check(aliasDoc.nodes.find((n) => n.id === "card1")?.type === "shape", "rect aliases to shape");
  check(aliasDoc.nodes.find((n) => n.id === "card1-icon")?.props.icon === "star", "create icon= lands on icon node");
  check(aliasDoc.nodes.find((n) => n.id === "card1-title")?.type === "txt", "text aliases to txt");
  const paneNode = cards.nodes.find((n) => n.id === "cards.pane");
  check(paneNode?.props.fill === "#02061799" && paneNode?.props.glass === "true", "create keeps fill/glass");
  const light = buildFeatureCardsDocument();
  dispatchDesignTool(
    "design_update",
    {
      where: "type=shape role=background",
      set: {
        fill: "#FFFFFFE8",
        stroke: "#DCE5F0",
        strokeWidth: 1,
        glass: true,
        shadow: { x: 0, y: 10, blur: 28, color: "#64748B1F" },
      },
    },
    light,
  );
  check(light.nodes.find((n) => n.id === "feature.chat.bg")?.props.fill === "#FFFFFFE8", "8-digit fill stays in IR");
  const lightDsl = serializeDsl(light);
  check(lightDsl.includes("feature.chat.bg.fill=#FFFFFFE8"), "save DSL keeps 8-digit fill");
  check(parseDsl(lightDsl).nodes.find((n) => n.id === "feature.chat.bg")?.props.fill === "#FFFFFFE8", "reload DSL keeps 8-digit fill");
  const lightFab = JSON.parse(projectToFabricJSON(light)) as {
    objects: Array<{ _id?: string; fill?: string; stroke?: string; _stylePreset?: string; shadow?: unknown }>;
    _designDsl?: string;
  };
  const lightBg = lightFab.objects.find((o) => o._id === "feature.chat.bg");
  check(lightBg?.fill === "#FFFFFFE8", "projected fabric fill is the authored color, not glass tint");
  check(lightBg?.stroke === "#DCE5F0", "projected fabric stroke survives glass");
  check(lightBg?._stylePreset === "glass", "glass flag still projected");
  check(!!lightBg?.shadow, "shadow is projected with glass");
  const attached = JSON.parse(attachDesignDocument(JSON.stringify({ objects: lightFab.objects }), light)) as {
    _designDsl?: string;
  };
  check(attached._designDsl?.includes("feature.chat.bg.fill=#FFFFFFE8"), "attachDesignDocument writes fill into saved JSON");
  const firstDrawable = cards.nodes.find((n) => !["canvas", "theme", "widget", "use"].includes(n.type));
  check(firstDrawable?.id === "cards.pane", "pane inserted behind cards");
  const fabricPane = JSON.parse(projectToFabricJSON(cards)) as { objects: Array<{ _id?: string }> };
  const paneIdx = fabricPane.objects.findIndex((o) => o._id === "cards.pane");
  const chatBgIdx = fabricPane.objects.findIndex((o) => o._id === "feature.chat.bg");
  check(paneIdx >= 0 && chatBgIdx > paneIdx, "projected pane under feature.chat.bg");
  const cover = dispatchDesignTool(
    "design_create",
    {
      behind: true,
      objects: [{ type: "shape", id: "page.bg.base", x: 0, y: 0, w: 1920, h: 1400, fill: "#F5F1EA" }],
    },
    cards,
  ) as { ok?: boolean };
  check(cover.ok === false, "rejects full-page shape as background");
  check(!cards.nodes.some((n) => n.id === "page.bg.base"), "did not insert covering frame");
  const existingFab = projectToFabricJSON(buildFeatureCardsDocument());
  const patched = JSON.parse(writeCliCanvasJson(existingFab, cards)) as { objects: Array<{ _id?: string }> };
  const patchPane = patched.objects.findIndex((o) => o._id === "cards.pane");
  const patchChat = patched.objects.findIndex((o) => o._id === "feature.chat.bg");
  check(patchPane >= 0 && patchChat > patchPane, "cli persist keeps behind:true under existing cards");
  const moved = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.bg", set: { x: 200, y: 90, w: 400, h: 200 } }] },
    cards,
  ) as { changed?: number; diff?: Array<Record<string, unknown>>; touched?: string[] };
  check(moved.changed === 1 && moved.touched?.includes("feature.chat.bg"), "geom update reports touched");
  check(
    moved.diff?.some((row) => row.id === "feature.chat.bg" && (row as { x?: { to?: number } }).x?.to === 200),
    "geom update returns x/y diff for canvas sync",
  );
  check(cards.nodes.find((n) => n.id === "feature.chat.bg")?.bounds.x === 200, "IR bounds moved");
  const slotLocal = dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.local.bg", set: { x: 0, y: 0 } }] },
    cards,
  ) as { diff?: Array<Record<string, unknown>> };
  check(
    cards.nodes.find((n) => n.id === "feature.local.bg")?.bounds.x === 524,
    "slot-local x=0 maps onto parent origin",
  );
  check(!slotLocal.diff?.some((row) => (row as { x?: { to?: number } }).x?.to === 0), "does not park card at canvas 0");
  const got = dispatchDesignTool("design_get", { ids: ["feature.chat.bg", "cards.pane"] }, cards) as Array<{
    id: string;
    props?: Record<string, string>;
  }>;
  check(!got.some((row) => row.props && "x" in row.props), "design_get props omit geometry");
  check(got.find((row) => row.id === "cards.pane")?.props?.glass === "true", "design_get keeps glass in props");
  const copyPlan = planCanvasApply([
    {
      name: "design_copy_styles",
      result: { ok: true, matched: 5, changed: 0, touched: ["feature.local.bg", "feature.local.title"] },
    },
  ]);
  check(copyPlan.mode === "patch" && copyPlan.styleNodeIds?.length === 2, "copy styles patches in place");
  const patchPlan = planCanvasApply([
    { name: "image_transform", result: { ok: true } },
    {
      name: "design_update",
      result: { ok: true, diff: [{ id: "image_1", src: { to: "/api/uploads/file/uploads/hero-v2.png" } }] },
    },
  ]);
  check(patchPlan.mode === "patch" && patchPlan.images?.[0]?.id === "image_1", "patch plan for image src replace");
  console.log("ok: uploads + page background + insert image");
});

await suite("iterative-edits", async () => {
  let doc = buildFeatureCardsDocument();
  dispatchDesignTool(
    "design_update",
    { patches: [{ id: "feature.chat.icon", set: { fill: "#2563eb" } }] },
    doc,
  );
  dispatchDesignTool(
    "design_update",
    {
      patches: [
        { id: "feature.chat.title", set: { text: "Чат и И" } },
        { id: "feature.files.icon", set: { fill: "#dc2626" } },
      ],
    },
    doc,
  );
  check(doc.nodes.find((n) => n.id === "feature.chat.icon")?.props.fill === "#2563eb", "icon fill kept after text patch");
  check(doc.nodes.find((n) => n.id === "feature.chat.title")?.text === "Чат и И", "title text updated");

  const dsl = serializeDsl(doc);
  check(dsl.includes("feature.chat.icon.fill=#2563eb"), "icon fill serialized in DSL");
  const roundtrip = parseDsl(dsl);
  check(
    roundtrip.nodes.find((n) => n.id === "feature.chat.icon")?.props.fill === "#2563eb",
    "icon fill survives DSL round-trip",
  );

  setActiveDocument(doc);
  const resolved = resolveDesignDocument([doc]);
  check(
    resolved?.nodes.find((n) => n.id === "feature.files.icon")?.props.fill === "#dc2626",
    "resolve prefers in-memory active IR",
  );

  const ran = await applyEmittedDesignTools(
    '{"name":"design_update","arguments":{"patches":[{"id":"feature.chat.caption","set":{"text":"Помощь"}}]}}',
    doc,
    {
      onChange: (next) => {
        doc = next;
      },
    },
  );
  check((ran[0]?.result as { ok?: boolean })?.ok === true, "second chat turn applies");
  check(doc.nodes.find((n) => n.id === "feature.chat.icon")?.props.fill === "#2563eb", "icon fill survives second chat turn");
  check(doc.nodes.find((n) => n.id === "feature.chat.caption")?.text === "Помощь", "caption updated on second turn");
  console.log("ok: iterative chat edits preserve style props");
});

await suite("chat-feedback", async () => {
  const glued =
    '{"name":"design_delete","arguments":{"where":"id=feature.search"}}{"name":"design_delete","arguments":{"where":"id=feature.search"}}';
  check(isDesignToolOnlyReply(glued), "glued JSON is tool-only reply");
  check(!isDesignToolOnlyReply("Done.\n" + glued), "prose + JSON is not tool-only");
  check(dedupeToolCalls(parseEmittedToolCalls(glued)).length === 1, "dedupeToolCalls");

  const doc = buildFeatureCardsDocument();
  const ran = await applyEmittedDesignTools(glued, doc);
  check(ran.length === 1 && ran[0].name === "design_delete", "host deduped duplicate delete");
  const summary = assistantReplyForDesignTools(ran);
  check(summary.includes("feature.search"), `human summary: ${summary}`);
  check(!doc.nodes.some((n) => n.id === "feature.search"), "delete applied from streamed JSON");
  const okRun = [{ name: "design_use_widget", result: { ok: true, created: ["feature.audio"] } }];
  const trailing =
    'Done.\n{"name":"design_use_widget","arguments":{"widget":"feature-group","id":"feature.audio"}}\n{"name":"design_';
  check(
    !shouldWarnDesignResponseTruncation({
      truncatedJson: true,
      runs: okRun,
      parsedCount: 1,
    }),
    "no warn when tools succeeded despite trailing junk",
  );
  check(
    shouldWarnDesignResponseTruncation({
      truncatedJson: true,
      finishReason: "length",
      runs: okRun,
      parsedCount: 1,
    }),
    "warn when provider finish_reason=length",
  );
  check(
    !assistantReplyForDesignTools(okRun, { truncated: false }).includes("cut off"),
    "success summary without cut-off note",
  );
  console.log("ok: chat feedback + dedupe");
});

await suite("custom-tools", async () => {
  const doc = parseDsl(EXAMPLE_DSL);
  setActiveDocument(doc);
  const tools = createDesignTools();
  const names = tools.map((t) => t.function.name);
  for (const need of designToolNames()) {
    check(names.includes(need), `schema missing ${need}`);
    const spec = tools.find((t) => t.function.name === need);
    check(typeof spec?.function.function === "function", `${need} has executor`);
  }

  const queryTool = tools.find((t) => t.function.name === "design_query");
  const raw = await queryTool!.function.function({ query: "type=img w>=800", fields: ["id", "w"] });
  const hits = JSON.parse(String(raw)) as Array<{ id: string; w: number }>;
  check(hits.length === 1 && hits[0].id === "hero" && hits[0].w === 1180, "runTools-style design_query");

  const updateTool = tools.find((t) => t.function.name === "design_update");
  const upd = JSON.parse(
    String(await updateTool!.function.function({ where: "id=hero.title", set: { x: 1400 } })),
  ) as { ok: boolean; changed: number };
  check(upd.ok && upd.changed === 1, "runTools-style design_update");
  check(doc.nodes.find((n) => n.id === "hero.title")?.bounds.x === 1400, "hero.title moved");

  const getTool = tools.find((t) => t.function.name === "design_get");
  const got = JSON.parse(
    String(await getTool!.function.function({ ids: ["feature.chat"], include_children: true })),
  ) as Array<{ id: string }>;
  check(got.some((g) => g.id === "feature.chat.title"), "design_get include_children");

  setActiveDocument(null);
  console.log("ok: createDesignTools executors");
});

await suite("chat-transcript", () => {
  const msgs = [
    { id: "u1", role: "user" as const, content: "add audio card", timestamp: 1 },
    {
      id: "a1",
      role: "assistant" as const,
      content: "Done.",
      timestamp: 2,
      toolRuns: [
        {
          name: "design_use_widget",
          arguments: { id: "feature.audio", widget: "feature-group" },
          result: { ok: true, created: ["feature.audio"] },
        },
      ],
    },
  ];
  const transcript = formatChatTranscript(msgs);
  check(transcript.includes("## Assistant"), "transcript has assistant section");
  check(transcript.includes("design_use_widget"), "transcript includes tool name");
  check(transcript.includes("feature.audio"), "transcript includes tool args");
  check(formatMessageCopyText(msgs[1]).includes("## Tool calls"), "bubble copy includes tools");
  console.log("ok: chat transcript copy");
});

await suite("stream-text-dedupe", () => {
  const half = "The canvas contains two feature cards.";
  const doubled = half + half;
  check(dedupeRepeatedContent(doubled) === half, "dedupe exact doubled reply");
  let acc = "";
  acc = appendStreamDelta(acc, "The ");
  acc = appendStreamDelta(acc, "canvas");
  acc = appendStreamDelta(acc, "The canvas");
  check(acc === "The canvas", "appendStreamDelta cumulative final chunk");
  acc = appendStreamDelta(acc, "The canvas");
  check(acc === "The canvas", "appendStreamDelta skips duplicate full replay");
  console.log("ok: stream text dedupe");
});

await suite("stream-tanit-tools", () => {
  const { frames, rest } = consumeSseBuffer(
    'event: tanit.tool_call\ndata: {"type":"tool_call","name":"design_update","arguments":{"id":"c1","arguments":{"where":"id=hero.title","set":{"text":"Hola"}}}}\n\n' +
      'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"Done."},"finish_reason":null}]}\n\n' +
      'event: tanit.tool_result\ndata: {"type":"tool_result","name":"design_update","id":"c1","result":{"ok":true,"saved":true}}\n\npartial',
  );
  check(frames.length === 3 && rest === "partial", "sse frames + tail");
  const call = unwrapTanitToolCall(JSON.parse(frames[0]!.data) as Record<string, unknown>);
  check(call.name === "design_update" && call.id === "c1" && call.arguments.where === "id=hero.title", "unwrap tool_call args");
  let state = { text: "", finishReason: null as string | null, toolRuns: [] as Array<{ name: string; result: unknown }> };
  for (const frame of frames) state = applySseFrame(frame, state);
  check(state.text === "Done.", "text delta still streams");
  check(state.toolRuns.length === 1 && state.toolRuns[0]!.name === "design_update", "one tracked tool");
  check((state.toolRuns[0]!.result as { saved?: boolean }).saved === true, "tool_result fills the run");
  const body = tanitCompletionBody({
    model: "quick",
    messages: [{ role: "user", content: "what is this?" }],
    selection: ["C:/proj/.OpenDesign/uploads/photo.png"],
  });
  check((body.tanit as { selection?: string[] })?.selection?.[0]?.endsWith("photo.png") === true, "request body carries tanit.selection");
  check(!("tanit" in tanitCompletionBody({ model: "quick", messages: [] })), "omit tanit.selection when empty");
  console.log("ok: tanit SSE tool tracking");
});

await suite("host-scene-apply", () => {
  check(hostToolRunNeedsSceneRefresh("design_query", { ok: true, result: [] }) === false, "query does not refresh scene");
  check(hostToolRunNeedsSceneRefresh("design_update", { ok: true, saved: true, changed: 3 }) === true, "saved update refreshes scene");
  check(hostToolRunNeedsSceneRefresh("design_update", { pending: true }) === false, "pending update waits");
  check(
    shouldReloadInsteadOfSave({ updated_by: "cli", updated_at: "2026-09-12T17:37:03.956Z" }, "2026-09-12T17:36:09.448Z"),
    "stale editor save must reload cli persist",
  );
  check(
    shouldReloadInsteadOfSave({ updated_by: "cli", updated_at: "t1" }, "t1") === false,
    "same revision can save",
  );
  check(
    latestHostRevisionAfter([
      { name: "design_update", result: { revision_after: "2026-09-12T18:00:29.400Z" } },
      { name: "design_set_page_background", result: { revision_after: "2026-09-12T18:02:05.144Z" } },
    ]) === "2026-09-12T18:02:05.144Z",
    "newest host revision wins",
  );
  const cards = buildFeatureCardsDocument();
  const existingFab = projectToFabricJSON(cards);
  const seen = new Set<string>();
  const fresh = takeFreshHostSceneRuns(
    [
      {
        id: "c1",
        name: "design_update",
        arguments: { where: "type=shape", set: { fill: "#FF0000" } },
        result: { ok: true, saved: true, changed: 3, touched: ["feature.chat.bg", "feature.files.bg"] },
      },
    ],
    seen,
  );
  check(fresh.length === 1, "first saved update is fresh");
  check(takeFreshHostSceneRuns(fresh, seen).length === 0, "same tool run is not applied twice");
  const { plan, replayed } = replayHostDesignRuns(cards, fresh);
  check(replayed === 1, "replays design_update onto local IR");
  check(plan.mode === "patch" && (plan.styleNodeIds?.length ?? 0) >= 2, "shape fill patches in place");
  check(cards.nodes.find((n) => n.id === "feature.chat.bg")?.props.fill === "#FF0000", "IR fill is red");
  const patched = JSON.parse(writeCliCanvasJson(existingFab, cards)) as {
    objects: Array<{ _id?: string; fill?: string; objects?: Array<{ _id?: string; fill?: string }> }>;
    _designDsl?: string;
  };
  const chatBg = patched.objects.find((o) => o._id === "feature.chat.bg");
  check(chatBg?.fill === "#FF0000", "cli persist writes red fill onto the shape");
  check(patched._designDsl?.includes("feature.chat.bg.fill=#FF0000") === true, "saved DSL keeps red fill");

  const scene = buildFeatureCardsDocument();
  const sceneFab = projectToFabricJSON(scene);
  const created = dispatchDesignTool(
    "design_create",
    {
      objects: [{ type: "txt", id: "hello", x: 80, y: 80, w: 400, h: 60, text: "hello", fill: "#111827" }],
    },
    scene,
  ) as { created?: string[] };
  check(created.created?.includes("hello") === true, "creates hello text");
  const withHello = JSON.parse(writeCliCanvasJson(sceneFab, scene)) as {
    objects: Array<{ _id?: string; text?: string; objects?: Array<{ _id?: string }> }>;
  };
  const helloObj = withHello.objects.find((o) => o._id === "hello");
  check(helloObj?.text === "hello", "persist appends hello onto the fabric tree");

  const used = dispatchDesignTool(
    "design_use_widget",
    {
      widget: "feature-group",
      id: "feature.light",
      x: 80,
      y: 280,
      bindings: { icon: "sparkles", title: "Feature highlight", caption: "Light glass card", body: "Body" },
    },
    scene,
  ) as { created?: string[] };
  check(used.created?.includes("feature.light") === true, "instantiates feature.light");
  const withCard = JSON.parse(writeCliCanvasJson(JSON.stringify(withHello), scene)) as {
    objects: Array<{ _id?: string; objects?: Array<{ _id?: string }> }>;
  };
  const collectIds = (rows: Array<{ _id?: string; objects?: Array<{ _id?: string }> }>, into: string[] = []) => {
    for (const row of rows) {
      if (row._id) into.push(row._id);
      if (row.objects) collectIds(row.objects, into);
    }
    return into;
  };
  const cardIds = collectIds(withCard.objects);
  check(cardIds.includes("feature.light.bg"), "persist appends the new card background");
  check(cardIds.includes("feature.light.title"), "persist appends the new card title");

  const removed = dispatchDesignTool("design_delete", { ids: ["hello"] }, scene) as { deleted?: string[] };
  check(removed.deleted?.includes("hello") === true, "deletes hello from IR");
  const afterDelete = JSON.parse(writeCliCanvasJson(JSON.stringify(withCard), scene)) as {
    objects: Array<{ _id?: string; objects?: Array<{ _id?: string }> }>;
  };
  const afterIds = collectIds(afterDelete.objects);
  check(!afterIds.includes("hello"), "persist removes hello from the fabric tree");
  check(afterIds.includes("feature.light.bg"), "delete hello keeps the feature card");
  console.log("ok: host scene apply");
});

await suite("standalone-coords", () => {
  const doc = parseDsl(`canvas main 1080 1080
theme tanit-light
`);
  dispatchDesignTool(
    "design_create",
    {
      objects: [
        { id: "dot.a", type: "shape", x: 100, y: 100, w: 100, h: 100, radius: 50, fill: "#ef4444" },
        { id: "dot.b", type: "shape", x: 300, y: 100, w: 100, h: 100, radius: 50, fill: "#3b82f6" },
      ],
    },
    doc,
  );
  const queried = dispatchDesignTool(
    "design_query",
    { query: "id^=dot.", fields: ["id", "width", "height", "fill"] },
    doc,
  ) as Array<{ id?: string; width?: number; height?: number; fill?: string }>;
  check(queried.length === 2, "prefix query finds standalone shapes");
  check(queried[0]?.width === 100 && queried[0]?.fill === "#ef4444", "query width/fill aliases work");

  const scaled = dispatchDesignTool(
    "design_update",
    { where: "id^=dot.", transform: { scale: 2, origin: { x: 100, y: 100 } } },
    doc,
  ) as { ok?: boolean; changed?: number };
  check(scaled.ok === true && (scaled.changed ?? 0) === 2, "transform.scale mutates the selection");
  const a = doc.nodes.find((n) => n.id === "dot.a");
  const b = doc.nodes.find((n) => n.id === "dot.b");
  check(a?.bounds.w === 200 && a?.bounds.x === 100, "scale keeps origin node in place");
  check(b?.bounds.x === 500 && b?.bounds.w === 200, "scale moves the other node from origin");
  check(a?.props.radius === "100", "scale grows corner radius");

  const dsl = serializeDsl(doc);
  check(dsl.includes("dot.a.fill=#ef4444"), "standalone fill is serialized");
  check(dsl.includes("dot.a.radius=100"), "standalone radius is serialized");
  const roundtrip = parseDsl(dsl);
  check(roundtrip.nodes.find((n) => n.id === "dot.a")?.props.fill === "#ef4444", "standalone fill survives DSL round-trip");
  const persisted = JSON.parse(writeCliCanvasJson(projectToFabricJSON(parseDsl(`canvas main 1080 1080\n`)), roundtrip)) as {
    objects: Array<{ _id?: string; fill?: string; width?: number; rx?: number }>;
  };
  const savedA = persisted.objects.find((o) => o._id === "dot.a");
  check(savedA?.fill === "#ef4444" && savedA?.width === 200, "persist keeps standalone fill and size");

  const fitted = dispatchDesignTool(
    "design_update",
    { where: "id^=dot.", layout: { type: "fit", area: { x: 40, y: 40, w: 400, h: 200 } } },
    doc,
  ) as { ok?: boolean; changed?: number };
  check(fitted.ok === true && (fitted.changed ?? 0) >= 1, "layout fit scales the selection");
  const boxRight = Math.max(
    ...(doc.nodes.filter((n) => n.id.startsWith("dot.")).map((n) => n.bounds.x + n.bounds.w)),
  );
  const boxBottom = Math.max(
    ...(doc.nodes.filter((n) => n.id.startsWith("dot.")).map((n) => n.bounds.y + n.bounds.h)),
  );
  check(boxRight <= 440.01 && boxBottom <= 240.01, "fit keeps the selection inside the area");
  console.log("ok: standalone coords + scale/fit");
});

function bboxOf(nodes: Array<{ bounds: { x: number; y: number; w: number; h: number } }>) {
  const x0 = Math.min(...nodes.map((n) => n.bounds.x));
  const y0 = Math.min(...nodes.map((n) => n.bounds.y));
  const x1 = Math.max(...nodes.map((n) => n.bounds.x + n.bounds.w));
  const y1 = Math.max(...nodes.map((n) => n.bounds.y + n.bounds.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

await suite("center-four-squares", () => {
  const doc = parseDsl(`canvas main 1080 1080
theme tanit-light
`);
  dispatchDesignTool(
    "design_create",
    {
      objects: [
        { id: "sq.tl", type: "shape", x: 40, y: 40, w: 120, h: 120, fill: "#ef4444" },
        { id: "sq.tr", type: "shape", x: 180, y: 40, w: 120, h: 120, fill: "#3b82f6" },
        { id: "sq.bl", type: "shape", x: 40, y: 180, w: 120, h: 120, fill: "#22c55e" },
        { id: "sq.br", type: "shape", x: 180, y: 180, w: 120, h: 120, fill: "#eab308" },
      ],
    },
    doc,
  );
  const squares = () => doc.nodes.filter((n) => n.id.startsWith("sq."));
  const before = bboxOf(squares());
  check(before.w === 260 && before.h === 260, "four selected squares start as a 2×2");

  const fitted = dispatchDesignTool(
    "design_update",
    { where: "id^=sq.", layout: { type: "fit", area: { x: 0, y: 0, w: 1080, h: 1080 } } },
    doc,
  ) as { ok?: boolean; changed?: number };
  check(fitted.ok === true && (fitted.changed ?? 0) === 4, "fit moves all four selected squares");

  const after = squares();
  const box = bboxOf(after);
  check(Math.abs(box.cx - 540) < 0.5 && Math.abs(box.cy - 540) < 0.5, "ungrouped 2×2 is centered on the 1:1 canvas");
  check(Math.abs(box.w - 1080) < 0.5 && Math.abs(box.h - 1080) < 0.5, "ungrouped 2×2 fills the 1:1 canvas");
  const tl = after.find((n) => n.id === "sq.tl")!;
  const tr = after.find((n) => n.id === "sq.tr")!;
  const bl = after.find((n) => n.id === "sq.bl")!;
  const scale = tl.bounds.w / 120;
  check(Math.abs(tr.bounds.x - tl.bounds.x - 140 * scale) < 0.5, "top row keeps the 2×2 spacing after fit");
  check(Math.abs(bl.bounds.y - tl.bounds.y - 140 * scale) < 0.5, "left column keeps the 2×2 spacing after fit");
  check(after.every((n) => Math.abs(n.bounds.w - tl.bounds.w) < 0.5), "all four squares stay the same size");

  const fabric = JSON.parse(projectToFabricJSON(doc)) as {
    objects: Array<{ _id?: string; left?: number; top?: number; width?: number; height?: number }>;
  };
  const fabTl = fabric.objects.find((o) => o._id === "sq.tl");
  check(fabTl?.left === tl.bounds.x && fabTl?.width === tl.bounds.w, "projected frames match centered IR");
  console.log("ok: four selected squares centered on 1:1 canvas");
});

await suite("center-four-grouped-squares", () => {
  const doc = parseDsl(`canvas main 1080 1080
theme tanit-light

widget quad w=260 h=260
  shape tl x=0 y=0 w=120 h=120
  shape tr x=140 y=0 w=120 h=120
  shape bl x=0 y=140 w=120 h=120
  shape br x=140 y=140 w=120 h=120
`);
  dispatchDesignTool("design_use_widget", { widget: "quad", id: "quad.1", x: 40, y: 40 }, doc);
  const inst = doc.nodes.find((n) => n.id === "quad.1")!;
  const kids = () => doc.nodes.filter((n) => n.parentId === "quad.1");
  const localBefore = kids().map((n) => ({
    id: n.id,
    x: n.bounds.x - inst.bounds.x,
    y: n.bounds.y - inst.bounds.y,
    w: n.bounds.w,
    h: n.bounds.h,
  }));
  check(localBefore.length === 4, "grouped widget has four squares");

  const fitted = dispatchDesignTool(
    "design_update",
    { where: "id=quad.1", layout: { type: "fit", area: { x: 0, y: 0, w: 1080, h: 1080 } } },
    doc,
  ) as { ok?: boolean; changed?: number };
  check(fitted.ok === true && (fitted.changed ?? 0) >= 1, "fit the grouped quad");

  const use = doc.nodes.find((n) => n.id === "quad.1")!;
  const box = bboxOf([use, ...kids()]);
  check(Math.abs(box.cx - 540) < 0.5 && Math.abs(box.cy - 540) < 0.5, "grouped 2×2 is centered on the 1:1 canvas");
  check(Math.abs(use.bounds.x + use.bounds.w / 2 - 540) < 0.5, "use instance center is the canvas center");

  const scale = use.bounds.w / 260;
  for (const prev of localBefore) {
    const child = kids().find((n) => n.id === prev.id)!;
    check(Math.abs(child.bounds.x - use.bounds.x - prev.x * scale) < 0.5, `${prev.id} keeps grouped local x`);
    check(Math.abs(child.bounds.y - use.bounds.y - prev.y * scale) < 0.5, `${prev.id} keeps grouped local y`);
    check(Math.abs(child.bounds.w - prev.w * scale) < 0.5, `${prev.id} scales with the group`);
  }

  const groupedJson = (() => {
    const flat = JSON.parse(projectToFabricJSON(doc)) as {
      objects: Array<Record<string, unknown> & { _id?: string; left?: number; top?: number }>;
    };
    const byId = new Map(flat.objects.map((o) => [String(o._id ?? ""), o]));
    const members = kids()
      .map((n) => byId.get(n.id))
      .filter((o): o is Record<string, unknown> & { _id?: string; left?: number; top?: number } => !!o);
    return JSON.stringify({
      ...flat,
      objects: [
        ...flat.objects.filter((o) => o._id === "canvas.bg" || o._id === "canvas.photo"),
        {
          type: "Group",
          originX: "left",
          originY: "top",
          left: use.bounds.x,
          top: use.bounds.y,
          _id: "group.quad.1",
          _isElementGroup: true,
          objects: members.map((kid) => ({
            ...kid,
            left: Number(kid.left ?? 0) - use.bounds.x,
            top: Number(kid.top ?? 0) - use.bounds.y,
          })),
        },
      ],
    });
  })();
  const saved = JSON.parse(writeCliCanvasJson(groupedJson, doc, { source: "agent" })) as {
    objects: Array<{ _id?: string; left?: number; top?: number; objects?: Array<{ _id?: string; left?: number; top?: number }> }>;
  };
  const group = saved.objects.find((o) => o._id === "group.quad.1");
  check(!!group, "persist keeps the four squares grouped");
  check(Math.abs((group?.left ?? 0) - use.bounds.x) < 0.5, "persisted group sits at the centered use origin");
  const localTl = group?.objects?.find((o) => o._id === "quad.1.tl");
  check(Math.abs(localTl?.left ?? 1) < 0.5 && Math.abs(localTl?.top ?? 1) < 0.5, "grouped child keeps local frame after persist");
  console.log("ok: four grouped squares centered on 1:1 canvas");
});

assert.equal(stats.failed, 0);
console.log(`\ntest:design PASS (${stats.passed})`);
