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
  buildFeatureCardsDocument,
  dedupeToolCalls,
  isDesignToolOnlyReply,
  bundledFeatureCardsTemplate,
  designChatBrief,
  documentFromCanvasJson,
  projectToFabricJSON,
  createDesignTools,
  designToolNames,
  dispatchDesignTool,
  emulateToolScript,
  parseDsl,
  parseEmittedToolCalls,
  queryNodes,
  serializeDsl,
  setActiveDocument,
} from "../../src/design/index.ts";

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
  check(many.length === 2 && many[1].name === "done", "tool_calls array + done");
  const glued =
    '{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search Files"}}}{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search Files"}}}';
  const duped = parseEmittedToolCalls(glued);
  check(duped.length === 2 && duped[0].name === "design_update", "concatenated JSON objects");
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
  check(brief.includes("SELECTION: feature.search.title"), "brief carries selection");
  check(brief.includes("not workspace files"), "tells agent not to edit workspace/screenshots");

  const emitted =
    '{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search files."}}}{"name":"design_update","arguments":{"where":"id=feature.search.title","set":{"text":"Search files."}}}';
  const ran = await applyEmittedDesignTools(emitted, doc);
  check(ran.length === 1 && ran[0].name === "design_update", "host deduped duplicate design_update");
  check(doc.nodes.find((n) => n.id === "feature.search.title")?.text === "Search files.", "title patched from streamed JSON");
  const fabric = JSON.parse(projectToFabricJSON(doc)) as { objects: Array<{ _id?: string; text?: string }> };
  check(fabric.objects.find((o) => o._id === "feature.search.title")?.text === "Search files.", "re-project shows Search files.");
  console.log("ok: brief + host-run streamed tool_calls");
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

assert.equal(stats.failed, 0);
console.log(`\ntest:design PASS (${stats.passed})`);
