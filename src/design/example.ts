import { parseDsl } from "./parse";
import { projectToFabricJSON } from "./project";
import { emulateToolScript, type ToolCall } from "./tools";
import type { DesignDocument } from "./types";

/** Widget-only seed: palette + feature-card. Tests instance 3× and align top-left. */
export const FEATURE_CARD_SEED = `canvas main 1920 1080
theme tanit-light

preset card.soft fill=#ffffffd8 stroke=#ffffff80 radius=24
preset h3 font=Inter size=30 weight=650
preset caption font=Inter size=18 weight=500
preset body font=Inter size=20 weight=400

widget feature-group w=420 h=220
  shape bg role=background x=0 y=0 w=100% h=100% preset=card.soft
  icon icon role=icon x=24 y=24 w=64 h=64
  txt title role=title x=108 y=24 w=280 h=38 style=h3
  txt caption role=caption x=108 y=64 w=280 h=26 style=caption
  txt body role=body x=24 y=112 w=370 h=84 style=body
`;

export const FEATURE_CARDS = [
  {
    id: "feature.chat",
    icon: "chat",
    title: "Chat & AI",
    caption: "Everyday assistance",
    body: "Chat, translate, generate and understand.",
  },
  {
    id: "feature.files",
    icon: "folder",
    title: "Files & Content",
    caption: "Everything in one place",
    body: "Browse, inspect and organize your files.",
  },
  {
    id: "feature.search",
    icon: "search",
    title: "Search",
    caption: "Find anything fast",
    body: "Query designs, files and history in one place.",
  },
] as const;

/** Same instance id as Search — swap copy + icon, keep column slot. */
export const AUDIO_PLAYER = {
  id: "feature.search",
  icon: "player-play",
  title: "Audio Player",
  caption: "Listen as you work",
  body: "Play, pause and queue audio without leaving the canvas.",
} as const;

/** Same tool script the offline / Gemma feature-card tests run. */
export function featureCardsToolScript(): Array<{ tool_calls: ToolCall[] }> {
  return [
    ...FEATURE_CARDS.map((card, i) => ({
      tool_calls: [
        {
          name: "design_use_widget",
          arguments: {
            widget: "feature-group",
            id: card.id,
            x: 400 + i * 40,
            y: 400 + i * 40,
            bindings: { icon: card.icon, title: card.title, caption: card.caption, body: card.body },
          },
        },
      ],
    })),
    {
      tool_calls: [
        {
          name: "design_update",
          arguments: {
            where: "type=use id^=feature.",
            layout: { type: "column", gap: 24, area: { x: 80, y: 80 } },
          },
        },
      ],
    },
  ];
}

/** Compiled feature-card scene: 3 instances, column at x=80 y=80/324/568. */
export function buildFeatureCardsDocument(): DesignDocument {
  const doc = parseDsl(FEATURE_CARD_SEED);
  emulateToolScript(doc, featureCardsToolScript());
  return doc;
}

/** Host-side “change search to audio player” against a live feature-cards IR. */
export function searchToAudioPlayerToolScript(): Array<{ tool_calls: ToolCall[] }> {
  return [
    {
      tool_calls: [
        {
          name: "design_update",
          arguments: {
            patches: [
              { id: `${AUDIO_PLAYER.id}.title`, set: { text: AUDIO_PLAYER.title } },
              { id: `${AUDIO_PLAYER.id}.icon`, set: { icon: AUDIO_PLAYER.icon } },
              { id: `${AUDIO_PLAYER.id}.caption`, set: { text: AUDIO_PLAYER.caption } },
              { id: `${AUDIO_PLAYER.id}.body`, set: { text: AUDIO_PLAYER.body } },
            ],
          },
        },
      ],
    },
  ];
}

export function applySearchToAudioPlayer(doc: DesignDocument): DesignDocument {
  emulateToolScript(doc, searchToAudioPlayerToolScript());
  return doc;
}

/** Home / sidebar template payload — same scene the feature-card test builds. */
export function bundledFeatureCardsTemplate() {
  const doc = buildFeatureCardsDocument();
  return {
    id: "feature-cards",
    name: "Feature Cards",
    category: "tanit",
    canvas_json: projectToFabricJSON(doc, { source: "feature-cards" }),
    width: doc.canvas.width,
    height: doc.canvas.height,
    sort_order: 0,
    thumbnail_url: null as string | null,
  };
}

/** Spec §17 sample — used by offline query / tool tests. */
export const EXAMPLE_DSL = `canvas main 1920 1080
theme tanit-light

preset card.soft fill=#ffffffd8 stroke=#ffffff80 radius=24
preset h1 font=Inter size=72 weight=700
preset h3 font=Inter size=30 weight=650
preset caption font=Inter size=18 weight=500
preset body font=Inter size=20 weight=400

widget feature-group w=420 h=220
  shape bg role=background x=0 y=0 w=100% h=100% preset=card.soft
  icon icon role=icon x=24 y=24 w=64 h=64
  txt title role=title x=108 y=24 w=280 h=38 style=h3
  txt caption role=caption x=108 y=64 w=280 h=26 style=caption
  txt body role=body x=24 y=112 w=370 h=84 style=body

img hero role=hero x=80 y=80 w=1180 h=720 src=@hero.image

txt hero.title role=title x=1320 y=160 w=500 h=120 style=h1 text=@hero.title
txt hero.body role=body x=1320 y=340 w=440 h=180 style=body text=@hero.body

use feature-group as=feature.chat x=80 y=840
feature.chat.icon=chat
feature.chat.title=@feature.chat.title
feature.chat.caption=@feature.chat.caption
feature.chat.body=@feature.chat.body

use feature-group as=feature.files x=520 y=840
feature.files.icon=folder
feature.files.title=@feature.files.title
feature.files.caption=@feature.files.caption
feature.files.body=@feature.files.body

@hero.image = asset:main-screenshot

@hero.title = Your AI. Right where you work.
@hero.body = Work with files, media and AI.

@feature.chat.title = Chat & AI
@feature.chat.caption = Everyday assistance
@feature.chat.body = Chat, translate, generate and understand.

@feature.files.title = Files & Content
@feature.files.caption = Everything in one place
@feature.files.body = Browse, inspect and organize your files.
`;
