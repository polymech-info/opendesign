/** Default project guides written into `<cwd>/.OpenDesign/` when missing. */

export const DEFAULT_STYLE_GUIDE = `# Style guide

Tanit store stills and in-app feature cards. Follow this file unless the user asks for a different look.

## Canvas

- MS Store desktop screenshot: **1920×1080**. Do not change size unless asked.
- Dark photo background (\`uploads/backgrounds/dark-abstract-v1.png\` or the current page background). Do not invent a flat solid fill.
- Keep a quiet outer margin (~80px). Cards and shots sit on the photo, not on a new chrome frame.

## Type

- Family: **Inter**.
- Hero title: 56 / 700, fill \`#F8FAFC\`.
- Hero subtitle: 22 / 500, fill \`#CBD5E1\`.
- Card title: 26–30 / 650, fill \`#E5E7EB\`.
- Card caption: 16–18 / 500, fill \`#9CA3AF\`.
- Card body: 17–20 / 400, fill \`#D1D5DB\`.
- Hint labels on empty shots: 20 / 500, \`#94A3B8\`, centered.
- Copy stays short. Bindings ≤40 characters. No all-caps except product name **Tanit Chat**.

## Cards (feature-group)

- Widget \`feature-group\` — do not flatten slots into loose shapes when an instance exists.
- Glass pane: fill \`#0F172ACC\`, stroke \`#475569\` / 1px, radius 20–24, glass=true, shadow \`{x:0,y:12,blur:32,color:#00066}\`.
- Icon 48–64px, title + caption to the right, body under the row.
- Row of four cards along the bottom on 1920 canvases (gap 24). Column of three on older Feature Cards layouts.
- Copy styles between instances with \`design_copy_styles\`. Do not restyle one card a different palette.

## Screenshot slots

- Chat hero: id \`shot.chat\`, src \`uploads/screenshots/chat-ui.png\`.
- Settings: id \`shot.settings\`, src \`uploads/screenshots/settings.png\`.
- Frame behind each shot: fill \`#020617CC\`, stroke \`#334155\`, radius 16.
- Leave hint text until a real PNG is dropped. Do not generate fake UI chrome in the slot.
- Product stills sit above the card row; do not cover card titles.

## Motion / extras

- No new widgets, no extra badges, no gradients on type, no rainbow icons.
- Icons: Tabler one-word ids (\`message-circle\`, \`folder\`, \`sparkles\`, \`settings\`, \`shield\`).
`;

export const DEFAULT_SKILL = `---
name: opendesign-project
description: Edit Tanit Chat store screenshots and feature-card scenes in this OpenDesign project. Use when changing Store Chat, Feature Cards, or other listing stills under .OpenDesign.
---

# OpenDesign project skill

This folder (\`.OpenDesign/\` under the current working directory) is the **Tanit Chat** listing-still project. The Design DSL on the open canvas is the source of truth — do not rewrite workspace source files.

## Designs

| Name | Role |
|---|---|
| Store Chat | 1920×1080 MS Store still for the **chat** section |
| Feature Cards | Marketing feature-group row / column |
| Quote Card / Screenshot Card / Smoke | Other listing or test canvases |

## Store Chat (chat section)

Main features to show (from chat compositor + agent factory):

1. **Chat and agents** — sessions, composer, tool loop
2. **Files on your desktop** — drag/drop, path tools, filmstrip
3. **Local and cloud AI** — Settings / providers (Ollama → OpenRouter)
4. **MCP, skills, memory** — extensible agent

Placeholder images (replace in place, keep ids):

- \`shot.chat\` → \`uploads/screenshots/chat-ui.png\`
- \`shot.settings\` → \`uploads/screenshots/settings.png\`

## How to edit

- Emit \`design_*\` JSON. Host runs it. No prose inventory.
- Move a card by its \`use\` id (\`feature.agents\`), never by \`.bg\` / \`.title\` slot locals.
- One selected card = that use id only. Do not broaden to every \`type=txt\`.
- Follow \`.OpenDesign/style_guide.md\` for color, type, glass, and layout.
- Do not call \`design_export\` or \`design_screenshot\` unless the user asks.

## Uploads

Project uploads live in \`.OpenDesign/uploads/\` (backgrounds, screenshots, images). Prefer those keys over remote URLs.
`;
