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

## What we changed

- **`pm-opendesign`** — one process serves the UI and API, then opens the browser
- **Folders, not cloud** — JSON + files on disk. No D1, R2, or Wrangler
- **Merged libraries** — project + global uploads, icons, templates, and elements all show up together (union; project wins on the same name)
- **Published `dist` only** — one client bundle, one CLI bundle, plus Tabler filled icons
- **Editor** — named groups, glass, snap guides, Iconify search, extra shapes / gradients / opacity, copy-paste
- **Design DSL** — stable IDs, roles, widgets, styles, content, and geometry in a compact text format
- **Agent editing** — query or update many matching elements in one operation from chat or the CLI
- **Headless PNG** — Chrome/Edge renders the same canvas the editor uses (for store screenshots)

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

## CLI

```
pm-opendesign [--port 3727] [--no-browser]
pm-opendesign ls
pm-opendesign export [id|name] [-o out.png] [--page 1] [--scale 2]
pm-opendesign export [id|name] --format dsl [-o design.md] [--page 1]
pm-opendesign query [id|name] "type=txt role=title"
pm-opendesign prompt [id|name] "Move the title down 20px"
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

`prompt` runs the same Design DSL tool loop as editor chat, saves the selected
page, and exits without opening a browser:

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
