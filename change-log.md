# OpenDesign change log

## 2026-10-13

### Rulers and construction lines

- Each artboard has a top ruler (X) and a left ruler (Y).
- Double-click a ruler to add a construction line. Double-click the same stop to remove it.
- Drag a line to move it. Drag it back onto its ruler to remove it.
- Lines snap to ruler marks, divisions, the canvas half, and other construction lines.
- Lines belong to the page and save with it. They are not drawn into PNG or PDF.
- The bottom bar, above Pages, shows the pointer, a px / mm / cm / in / % unit group, and toggles for rulers and construction lines.
- The same bar shows the selection's top-left and size. X and Y are editable there, and again under Transformation in the properties panel. The value applies when the field loses focus, in the current unit. A selected construction line reports its position the same way, and that position is editable too.
- In percent, the 50% tick and a line on the canvas half are thicker, and the half snaps to 50.
- Scaling an object snaps the dragged edge to construction lines.

### Rectangular pattern

- Pattern is on the bottom bar and in the canvas menu (Rectangular pattern).
- Select the shapes, then a construction line. Both stay selected, and the line fills Axis 1.
- A vertical line or a left/right edge steps copies sideways. A horizontal line or a top/bottom edge steps them up and down.
- Inside the dialog you can still pick a construction line or a shape edge for either axis.
- Distribution is Extent or Spacing. Direction is One direction or Symmetric.
- Distance accepts px, mm, cm, in, and %. The value applies when the field loses focus. A minus sign flips one direction.

### Mirror

- Mirror is on the bottom bar and in the canvas menu.
- Select the shapes, then a construction line. The line fills the axis.
- A vertical line or a left/right edge flips the copy left and right. A horizontal line or a top/bottom edge flips it up and down.
- The original stays in place. One undo removes the copies.
- Keep orientation moves each copy across the line without flipping it.

## 2026-09-23

### Shape gradients have a stop editor

- Hover a gradient swatch for a settings cog; it opens the editor.
- Stops keep color, alpha, and interpolation in sRGB, OKLCH, or HSL.
- Linear stays a 1D bar. Bezier stores a 2D curve. Cycle and ripple have a movable origin.
- Apply as fill (with object opacity) or as a visibility mask.
- Save as new stores a named copy in the local gradient list. Duplicate names get a number.
- Saved gradients appear at the front of the shape fill palette.
- A visibility mask composites on its own buffer, so editing no longer grays the rest of the page.
- Images use the same mask to fade outer pixels. Reopening the editor restores stops, alpha, color, and fill/mask.
- Sides fade is a preset: left and right ~20% transparent, middle opaque.
- Gradient dialog is draggable and previews on the canvas. Stops have Reverse.
- Image clip frames can go thinner; the old 24px / 4% height floor is gone.
- Clip frames snap to the canvas and to nearby object edges, same as a move.

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
