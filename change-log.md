# OpenDesign change log

## 2026-09-22

### Properties open with General, Transformation, Reset

- The right panel now starts with identity (name, id, visible), then Transformation.
- Visible is an eye toggle on the Id row, not a full-width Shown/Hidden button.
- Reset (rotation, skew, image crop) is the first row in Transformation.
- Text, Shape/Icon, and Image sit after that; Effects stay last.

### Left rail shows upload palettes again

- Images and Background in the left sidebar are a thumbnail grid again (click to place or apply).
- The modal image picker stays on the properties panel, where a one-off replace makes sense.

### Reset rotation and skew

- Transformation now has Rotation / Skew sliders for shapes, text, and images.
- Each row has a reset icon; the canvas menu has the same Reset rotation and Reset skew actions.

### Glass glare and sparks sit in different spots

- Each glass object gets its own sheen tilt and edge sparks, from a stored seed.
- The Flares row has a shuffle control to pick a new location.

### Font / size restyles the whole text box

- Changing font, size, weight, or color from the properties panel now applies to every line.
- Leftover Fabric per-row styles (from wrapping or pasting) no longer pin some bullets at the old size.

### tanit-cli starts only when chat needs it

- Opening the editor no longer launches `tanit-cli llm agent --serve`.
- The first chat (or `pm-opendesign prompt`) starts it, and later messages reuse it.

## 2026-09-14

### Chat starts the LLM again if it died

- Sending a chat message respawns `tanit-cli llm agent --serve` when it is down (port 8090 bind failure used to stick as a 502).
- If 8090 is taken, OpenDesign tries 8091–8099 instead of giving up.

### Left rail stays on Designs when switching

- The open left-rail section is part of the URL, e.g. `/design/{id}/designs` and `/design/{id}/chat`.
- Switching designs from the Designs list stays on Designs instead of jumping back to Templates.

### Canvas stays put when editing text / toggling panels

- Double-clicking text near the bottom of a page no longer pans the whole designer off-screen. Fabric's hidden caret is pinned, and window scroll is locked while editing.
- Zoom layout size matches the visible artboard, so the scroller can actually move the page.
- Hide/show of the left or right panel (and the left-rail section) refits the page when you were at fit zoom, and otherwise scrolls it back into the remaining canvas.

### Create style in the style palette

- The Effects **Style** grid has a **Create style** tile. Name it there; the swatch lands next to the other saved styles.
- Header bookmark and the canvas context menu open that same tile.

### Property sliders stay grabbed

- Dragging a slider no longer remounts the whole properties panel (so the thumb does not slip).
- Arrow keys on the value field keep focus and nudge the value instead of the object on the canvas.

### Zoom readout shows on-screen size

- After the fit percentage, the top bar shows the visible artboard size in parentheses, e.g. `72% (778 × 1383)`, from canvas size × zoom.

## 2026-09-12

### Versions

- Snapshots live next to the design as `{id}_{n}.json` (example: `79cb30a2-…json` → `79cb30a2-…_1.json`).
- **Auto** snapshots on editor save (when content changed) and on `pm-opendesign prompt`.
- **Manual** snapshots from the left-rail **Versions** panel. Description is optional; no title field.
- Version files are skipped by the design list and page lookup.
- Click **Current** or a snapshot to switch. Switching does not restore over Current.
- Copy on one view and paste on another — clipboard survives the canvas reload.
- Edits while viewing a snapshot write back to that `{id}_{n}.json` only.
- Delete a snapshot from the list. Deleting a design removes its version files.

### CLI prompt no longer explodes groups

- `pm-opendesign prompt` used to save with `projectToFabricJSON`, which is a flat IR projection and dropped Fabric card groups.
- Style/copy/frame updates now patch the existing Fabric JSON tree (`writeCliCanvasJson`). Groups and child-local frames stay put.
- Editor chat already patched in place; CLI now follows the same rule.

### Grouped copy / translations

- Fill patches reached grouped card text; `text` did not. Frame sync skipped grouped children so local coords would not jump to world space.
- In-place sync now writes `text` the same way as fill. A no-op IR update (`changed: 0`) still syncs the live canvas, so a retry after a missed translation updates the cards.
