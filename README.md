<h1 align="center">OpenDesign</h1>

<p align="center">
  <strong>Local canvas editor for app-store screenshots.</strong>
</p>

<p align="center">
  Fork of <a href="https://github.com/clawnify/OpenDesign">clawnify/OpenDesign</a> · published as <code>@polymech/opendesign</code>
</p>

Design stills (store listings, feature cards, HD captures) as Fabric canvases on
disk. A compact Design DSL gives people and agents a shared, editable
representation for bulk changes, then OpenDesign renders the result to PNG.

[Demo](https://polymech.info/apps/opendesign) | Provided by [Polymech](https://service.polymech.info/) | [Github Sourcecode](https://github.com/polymech-info/opendesign)

## Quick start


```bash
npm i -g @polymech/opendesign
cd your-project
pm-opendesign
```

That's it. The editor opens in the browser. Tabler icons ship in the package.

Or without installing:

```bash
npx @polymech/opendesign
```

Original: [clawnify/OpenDesign](https://github.com/clawnify/OpenDesign). This fork is a local CLI — no Cloudflare Workers, no Wrangler, no cloud storage.

## Features

### Canvas editor

- Multi-page stills, canvas-size presets, undo/redo, snap guides, and layers
- Text, extra shapes, Tabler icons, Iconify search, uploads, and reusable elements
- Glass, gradients, opacity, patterns, shadows, and page color / gradient / image backgrounds
- Named groups, align / same width / same height (first selected is the source), front/back, maximize to canvas, hide/show, copy-paste objects and styles
- Snap guides for objects and multi-select, including canvas edges using the last drag direction
- Right-click context menu with icons and grouped edit / arrange / align / object actions
- Versions, templates, and merged project + global libraries (union; project wins on the same name)

### Images

- Paste from the clipboard (`Ctrl+V`)
- Drop a file on the canvas to add it, or on a photo to replace it (clip and zoom stay; the new aspect is fitted into the old frame)
- Crop a placed photo without stretching it: **Shift-drag** to pan the crop, **Shift-drag a corner** to zoom inside the frame, **Shift-drag a side handle** to clip. Inspector sliders set zoom and origin
- **Reset** (property panel, crop row, or right-click) restores an image's clip, origin, and default size
- **Maximize** in the property panel fits the selection to the canvas with room for resize handles. Photos keep their crop and inner scale (letterbox, not stretch)
- Lock an image as the page background

### Export

- **Copy** on the top toolbar writes the current page as a PNG to the system clipboard
- **PNG** downloads the same 2× render; Shift-click writes `.OpenDesign/designs/title_n.png`
- **Shot** on the top toolbar asks the Tanit Inspector Chrome extension for a real tab PNG and writes `docs/assets/screenshot_n.png` under the process cwd
- **JSON** downloads the multi-page canvas document
- Headless `pm-opendesign export` uses Chrome/Edge on the same canvas (store screenshots)

### Agents

- Design DSL — stable IDs, roles, widgets, styles, content, and geometry in a compact text format
- Chat in the editor (Tanit host tools) plus `pm-opendesign prompt` / `query` for batch edits
- MCP for Cursor / Claude Desktop (`pm-opendesign mcp` or `POST /api/mcp`)

### Local-first

- **`pm-opendesign`** — one process serves the UI and API, then opens the browser
- JSON and files on disk. No D1, R2, or Wrangler
- Published `dist` only — one client bundle, one CLI bundle, plus Tabler filled icons

## Design DSL and mass editing

OpenDesign stores a normalized Design DSL alongside the Fabric canvas. The DSL
describes what an element means—not only how Fabric happens to serialize it:

- stable IDs such as `feature.chat.title`
- semantic roles such as `title`, `caption`, `body`, and `background`
- reusable widget definitions and instances
- text, image references, styles, and canvas geometry
- presets and explicit per-instance overrides

This lets the agent understand a complete scene from a relatively small context
and edit sets of elements with one selector. It does not need to inspect or
rewrite every low-level canvas object individually.

Examples:

```bash
# Rewrite all user-facing copy while retaining IDs, layout, and styles
pm-opendesign prompt "Feature Cards" \
  "Translate all titles, captions, and body text to Spanish"

# Apply a coordinated visual change across the scene
pm-opendesign prompt "Feature Cards" \
  "Adjust the entire design for a dark theme with readable contrast"

# Inspect the affected elements before automating a change
pm-opendesign query "Feature Cards" \
  "type=txt" --fields id,role,text,fill
```

The agent can batch changes through predicates such as `type=txt`,
`role=title`, `id^=feature.`, or numeric geometry checks. Named elements and
roles make requests like “all titles,” “every card background,” or “the right
column” concrete and repeatable.

### Compared with HTML, SVG, and raw canvas JSON

HTML and CSS are excellent for interactive documents, responsive layout,
accessibility, and browser behavior. For a fixed design scene, however, the
agent must also reason about the DOM tree, CSS cascade, inherited rules,
classes, layout engines, and runtime state.

SVG is closer to a design scene, but its XML still contains substantial drawing
and transform detail. Raw Fabric JSON is more verbose again: it includes
renderer versions, object internals, coordinates, scales, control state, and
other projection details that are useful to Fabric but noisy for an agent.

OpenDesign DSL is intentionally narrower. It compresses a fixed canvas into
semantic primitives, reusable widgets, bindings, presets, and stable IDs. The
DSL remains the editable source of truth; Fabric JSON is the rendering
projection. This generally means less context, clearer selectors, and safer
mass edits.

It is not a replacement for HTML when building an interactive website or app.
Use it for deterministic visual compositions where exact scene structure and
batch editing matter.

## Storage

| | Path |
|---|---|
| Project | `<cwd>/.OpenDesign/` |
| Global | `%APPDATA%/OpenDesign` or `~/.OpenDesign` |

New designs and uploads go to the project folder. Iconify downloads go to the global icon library.

Chat, `pm-opendesign prompt`, and MCP `prompt_design` inject two project files into the system brief (created on first run if missing):

| | |
|---|---|
| `.OpenDesign/style_guide.md` | Visual rules (type, glass, 1920×1080 stills) |
| `.OpenDesign/SKILL.md` | What this cwd’s designs are and how to edit them |

Edit those files per project. The running server’s cwd is the folder that is read (`GET /api/guides`).

## CLI

```
pm-opendesign [--port 3727] [--no-browser]
pm-opendesign ls
pm-opendesign export [id|name] [-o out.png] [--page 1] [--scale 2]
pm-opendesign export [id|name] --format dsl [-o design.md] [--page 1]
pm-opendesign query [id|name] "type=txt role=title"
pm-opendesign prompt [id|name] "Move the title down 20px"
pm-opendesign mcp
```

### Export and query Design DSL

Export the selected page's Design DSL as a fenced Markdown document:

```bash
pm-opendesign export "Screenshot Card" --format dsl -o docs/screenshot-card.md
# Equivalent shorthand:
pm-opendesign dsl "Screenshot Card" -o docs/screenshot-card.md
```

The output contains an `opendesign` code fence and can be reviewed, versioned,
or supplied to another agent. Without `-o`, the file is written as
`<design-name>.md` (or `<design-name>-p2.md` for a multi-page design).

Query the normalized DSL/IR without starting the editor or LLM:

```bash
pm-opendesign query "Feature Cards" "type=txt role=title"
pm-opendesign query "Feature Cards" "id^=feature. x>=900" \
  --fields id,type,x,y,text --limit 20 --page 1
```

`query` prints a JSON envelope containing the design, page, query, count, and
matching items. Predicates can use `=`, `!=`, `^=`, `$=`, `*=`, `~=`, `>`,
`<`, `>=`, and `<=`; whitespace means AND, while `|` or `OR` means OR.
Use `-q`/`--query` instead of a trailing expression when convenient.

### Prompt from the CLI

`prompt` still uses the CLI emit-JSON Design DSL loop (not the editor chat
host provider). It saves the selected page and exits without opening a browser:

```bash
pm-opendesign ls
pm-opendesign prompt "Screenshot Card" "Move feature.chat to x 640 y 96"
pm-opendesign prompt 79cb30a2 "Make all card titles blue" --page 2
```

Use `-p` when the prompt is easier to pass as an option:

```bash
pm-opendesign prompt "Screenshot Card" -p "Align the feature cards in two columns"
```

Prompt options:

- `--page <n>` — page number, 1-based (default `1`)
- `--model <name>` — Tanit model/preset (default `quick`)
- `--max-rounds <n>` — maximum agent/tool rounds (default `8`)
- `--dry-run` — run the tool loop and print its result without saving

The page must already contain `_designDsl`; open and save legacy canvases once
in the editor first. CLI mode supports Design DSL query/create/update/delete and
widget tools. Canvas-only screenshot/export and image tools require the editor.

A successful `prompt` save stamps the design `updated_by=cli`. If that design is
open in the editor, the UI polls `/api/designs/{id}/revision` and reloads the
canvas (banner: **Reloaded from CLI**).
Set `OPEND_TANIT_CLI`, `OPEND_LLM_URL`, `OPEND_LLM_KEY`, or
`OPEND_LLM_PRESET` the same way as editor chat.

## MCP

OpenDesign speaks MCP JSON-RPC 2.0 (no SDK) so Cursor, Claude Desktop, or any
MCP client can create and edit designs on disk. Direct Design DSL tools plus
`prompt_design`, which is the same Tanit agent loop as `pm-opendesign prompt`.
Mutating calls save immediately and stamp `updated_by=cli` so an open editor
reloads. `prompt_design` needs `tanit-cli --serve` (the editor starts it, or set
`OPEND_LLM_URL` / `OPEND_TANIT_CLI`).

Editor chat must not own a second tool loop (no JSON scrape, no client `tools[]`
executor). Tanit `--serve` is the agent; host `IAgentToolProvider` is how
`design_*` attach. MCP here is for Cursor / other clients, not the editor chat
path. Contract: [docs/llm/llm-server.md](../../docs/llm/llm-server.md).

### Cursor — stdio (recommended)

`cwd` must be the folder that contains (or will contain) `.OpenDesign/`.

Published package:

```json
{
  "mcpServers": {
    "opendesign": {
      "command": "npx",
      "args": ["-y", "@polymech/opendesign", "mcp"],
      "cwd": "C:/path/to/your-project"
    }
  }
}
```

This repo (dev):

```json
{
  "mcpServers": {
    "opendesign": {
      "command": "npx",
      "args": ["tsx", "src/cli.ts", "mcp"],
      "cwd": "C:/path/to/your-project",
      "env": {
        "OPEND_CWD": "C:/path/to/your-project"
      }
    }
  }
}
```

Run the `npx tsx …` variant from `infrastructure/OpenDesign`, or pass the
absolute path to `src/cli.ts` in `args`. `OPEND_CWD` overrides the process
working directory if you cannot set `cwd`.

Put that block in `.cursor/mcp.json` (project) or Cursor Settings → MCP.

### Cursor — HTTP (editor already running)

Start the app (`pm-opendesign` or `npm run dev` in this repo), then **restart**
it after pulling MCP changes — an old process has no `/api/mcp` (Cursor logs
SSE 404). Streamable HTTP + SSE: `GET`/`POST` `/api/mcp` (also `/mcp`). Dev
default is port **3727**.

```json
{
  "mcpServers": {
    "opendesign": {
      "url": "http://127.0.0.1:3727/api/mcp"
    }
  }
}
```

HTTP uses whatever project folder the running server was started in.

### Tools

| | |
|---|---|
| Catalog | `list_designs`, `get_design`, `list_templates` |
| Create | `create_design` (`dsl` / `template` / blank), `add_page` |
| Prompt | `prompt_design` — natural language, same loop as `pm-opendesign prompt` |
| Change | `update_design`, `design_query`, `design_get`, `design_create`, `design_update`, `design_delete`, `design_use_widget`, `design_copy_styles`, `design_insert_image`, `design_insert_asset`, `design_set_page_background`, `design_search_icons` |
| Remove | `delete_design`, `delete_page` |
| Export | `design_export` — writes `path` (`dsl` / `md` / `json` / `png`) and returns the absolute file |

Pass `design` as an id or name on every edit tool. `page` is 1-based (default `1`).
`design_search_icons` query is **one word** (`shield`, not `security shield`).

```text
create_design name="Launch" template=feature-cards
prompt_design design="Launch" prompt="Translate all titles to Spanish"
get_design design="Launch"
design_update design="Launch" where="type=txt role=title" set={"text":"Hola"}
design_export design="Launch" format=png path=exports/launch.png
```

### Headless export

`export` is how you turn a saved design into a store screenshot from a script. It is **not** node-canvas.

1. Node starts the local API + client on localhost
2. Chrome or Edge opens `/export/:id` with `--headless=new` (set `OPEND_BROWSER` if it cannot find one)
3. The page loads Fabric JSON, fetches uploads/icons, draws, and POSTs the PNG back
4. Node writes the file, then kills the browser

Same 2× PNG as the toolbar (`--scale`). Needs a built client (`npm run build` in this repo, or the published package).

Logs go to **stderr** (`[export] ...`). The PNG path is the only stdout line. Missing backgrounds, images, and icons are tagged `MISSING`. Localhost URLs from the dev server (`http://127.0.0.1:5174/api/...`) are rewritten to `/api/...` so headless hits the export port.

```bash
pm-opendesign ls
pm-opendesign export "Screenshot Card" -o store/iphone.png --scale 2
```

## Dev (this repo)

```bash
cd infrastructure/OpenDesign
npm install
npm run dev
```

`npm run build` writes `dist/cli.js`, `dist/client/`, and `dist/tabler-icons/`.

## License

MIT. Upstream copyright Clawnify; this fork Polymech. Tabler icons are MIT ([tabler/tabler-icons](https://github.com/tabler/tabler-icons)).

![](./docs/assets/hopphopp.png)
