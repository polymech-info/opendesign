
# Tanit Design DSL — Agent Handover

Implement a compact, deterministic design language for OpenDesign/Fabric-based layouts.

Primary goals:

- optimized for LLM authoring/editing
- minimal token use
- fast parsing
- exact geometry
- trivial `rg` / grep querying
- stable IDs
- easy batch modification
- human-readable diffs
- no arbitrary HTML/CSS/JS
- widgets compile to normal primitives
- translations/content can be separated from layout
- full round-trip between DSL and internal scene graph

Do NOT make this a general programming language.

---

# 1. Core model

Use a flat, line-oriented DSL.

Canonical primitives:

```text
canvas
theme
shape
txt
icon
img
line
group
widget
use
````

Optional later:

```text
video
path
```

Canonical geometry keys:

```text
x=
y=
w=
h=
```

Always use the same property names and preferably stable property ordering.

Example:

```text
canvas main 1920 1080
theme tanit-light

img hero x=80 y=80 w=1180 h=720 preset=screenshot src=@hero.image

txt hero.title x=1320 y=180 w=480 h=100 style=h1 text=@hero.title
txt hero.body x=1320 y=340 w=440 h=180 style=body text=@hero.body
```

Long text may be block-form:

```text
txt hero.body x=1320 y=340 w=440 style=body
  Work with files, media and AI.
  Automate repetitive work visually.
```

Indented content belongs to the preceding declaration.

No braces required for ordinary objects.

---

# 2. Stable IDs

Every editable object MUST have a stable unique ID.

Examples:

```text
hero
hero.title
hero.body

feature.chat
feature.chat.icon
feature.chat.title
feature.chat.body
```

Prefer semantic IDs over generated UUIDs in the DSL.

Internal objects may still carry UUIDs, but preserve the human-facing DSL ID separately.

Useful queries must remain trivial:

```bash
rg '^txt '
rg '^img '
rg '^widget '
rg '^use '
rg '^feature\.chat'
rg 'preset=card.soft'
rg 'role=title'
rg 'text=@feature\.chat\.title'
```

---

# 3. Widgets

Widgets are reusable named groups of primitives.

They MUST NOT hide arbitrary behavior.

A widget is only:

```text
named reusable projection of primitives + slots + default layout
```

Example:

```text
widget feature-group w=420 h=220
  shape bg role=background x=0 y=0 w=100% h=100% preset=card.soft
  icon icon role=icon x=24 y=24 w=64 h=64 preset=icon.gradient
  txt title role=title x=108 y=24 w=280 h=38 style=h3
  txt caption role=caption x=108 y=64 w=280 h=26 style=caption
  txt body role=body x=24 y=112 w=370 h=84 style=body
```

Instantiate:

```text
use feature-group as=feature.chat x=80 y=180
feature.chat.icon=chat
feature.chat.title=@feature.chat.title
feature.chat.caption=@feature.chat.caption
feature.chat.body=@feature.chat.body
```

Widget-local IDs:

```text
bg
icon
title
caption
body
```

Compile to global internal IDs:

```text
feature.chat.bg
feature.chat.icon
feature.chat.title
feature.chat.caption
feature.chat.body
```

Support shallow composition:

```text
widget feature-grid w=1760 h=760 layout=grid cols=4 rows=3 gap=24
  item widget=feature-group repeat=12
```

Instance:

```text
use feature-grid as=features x=80 y=160
```

Bindings:

```text
features.1.icon=chat
features.1.title=@chat.title
features.1.body=@chat.body

features.2.icon=folder
features.2.title=@files.title
features.2.body=@files.body
```

Avoid arbitrary deep nesting.

Recommended max widget composition depth:

```text
3
```

---

# 4. Semantic roles

Every widget child SHOULD carry a semantic role when useful.

Example:

```text
shape bg role=background
icon icon role=icon
txt title role=title
txt caption role=caption
txt body role=body
```

This allows queries and tools such as:

```text
find role=title
find role=background
find widget=feature-group role=icon
```

Agents should prefer semantic roles over guessing object names.

---

# 5. Content binding

Separate layout from translatable/editable content where possible.

Layout:

```text
txt hero.title x=1320 y=180 w=480 style=h1 text=@hero.title
txt hero.body x=1320 y=340 w=440 style=body text=@hero.body
```

Content:

```text
@hero.title = Your AI. Right where you work.
@hero.body = Work with files, media and AI.
```

Feature content:

```text
@feature.chat.title = Chat & AI
@feature.chat.caption = Everyday assistance
@feature.chat.body = Chat, translate, create and understand.
```

German:

```text
@hero.title = Deine KI. Genau dort, wo du arbeitest.
```

This lets translation agents modify content without seeing geometry.

---

# 6. Presets / palette

Prefer presets over emitting repeated styling properties.

Example:

```text
preset card.soft fill=#ffffffcc stroke=#ffffff80 radius=24 shadow=soft
preset card.dark fill=#20242acc stroke=#ffffff20 radius=24 shadow=soft
preset h1 font=Inter size=72 weight=700
preset h3 font=Inter size=32 weight=650
preset body font=Inter size=22 weight=400
```

Usage:

```text
shape bg preset=card.soft
txt title style=h3
```

LLMs should choose from palette/preset IDs whenever possible.

Only emit direct overrides when necessary:

```text
feature.chat.bg.fill=#eef5ff
feature.chat.title.style=h2
feature.chat.icon.tint=#4388ff
```

---

# 7. Internal representation

Do NOT use the DSL directly as the runtime object model.

Parse into a normalized IR.

Suggested IR:

```cpp
enum class NodeType {
    Canvas,
    Shape,
    Text,
    Icon,
    Image,
    Line,
    Group,
    WidgetInstance
};

struct Rect {
    float x;
    float y;
    float w;
    float h;
};

struct Binding {
    std::string key;
};

struct DesignNode {
    std::string id;
    std::string uuid;

    NodeType type;

    std::optional<std::string> parent_id;
    std::optional<std::string> widget_source;
    std::optional<std::string> role;

    Rect bounds;

    std::optional<std::string> preset;
    std::optional<std::string> style;

    PropertyMap properties;

    std::optional<Binding> text_binding;
    std::optional<Binding> image_binding;

    std::vector<std::string> children;
};
```

Widget definition:

```cpp
struct WidgetDefinition {
    std::string id;

    float default_width;
    float default_height;

    std::vector<DesignNode> template_nodes;

    std::vector<WidgetSlot> slots;

    LayoutDefinition layout;
};
```

Slot:

```cpp
enum class SlotType {
    Text,
    Image,
    Icon,
    Shape,
    Widget
};

struct WidgetSlot {
    std::string id;
    SlotType type;
    std::string role;
    bool required;
};
```

Document:

```cpp
struct DesignDocument {
    CanvasDefinition canvas;
    ThemeDefinition theme;

    std::unordered_map<std::string, WidgetDefinition> widgets;
    std::unordered_map<std::string, PresetDefinition> presets;

    std::vector<DesignNode> nodes;

    std::unordered_map<std::string, std::string> content;

    AssetTable assets;
};
```

Fabric/OpenDesign objects are a projection of this IR.

Pipeline:

```text
DSL
 ↓
parser
 ↓
normalized IR
 ↓
validation
 ↓
widget expansion
 ↓
resolved scene graph
 ↓
Fabric/OpenDesign
```

Reverse:

```text
Fabric/OpenDesign
 ↓
scene extraction
 ↓
IR
 ↓
DSL serializer
```

Preserve stable IDs during round-trip.

---

# 8. Query language

Implement a minimal query language optimized for agents.

Do NOT implement XPath/CSS selectors.

Use simple predicates.

Examples:

```text
type=txt
type=img
id=hero.title
id^=feature.
role=title
widget=feature-group
preset=card.soft
parent=hero
text~="AI"
```

Combine with spaces as AND:

```text
type=txt role=title
widget=feature-group role=icon
type=img parent=hero
id^=features. preset=card.soft
```

Optional OR:

```text
type=img | type=icon
```

Useful operators:

```text
=      exact
!=     not equal
^=     prefix
$=     suffix
*=     contains
~=     text/search contains
> < >= <=   numeric properties
```

Examples:

```text
x>=1000
w>400
type=txt x>=1200
```

Query result should return compact data by default.

Example:

```json
[
  {
    "id": "hero.title",
    "type": "txt",
    "x": 1320,
    "y": 180,
    "w": 480,
    "h": 100,
    "style": "h1",
    "text": "@hero.title"
  }
]
```

Support projection:

```text
select id,type,x,y,w,h
where type=txt role=title
```

But keep query syntax optional/simple.

Minimal API can accept:

```json
{
  "query": "type=txt role=title",
  "fields": ["id", "x", "y", "w", "h", "style", "text"]
}
```

---

# 9. Agent tool schema

Expose a small number of high-leverage tools.

## design_query

```json
{
  "query": "type=txt role=title",
  "fields": ["id", "x", "y", "w", "h", "style", "text"],
  "limit": 50
}
```

Returns matching normalized objects.

---

## design_get

```json
{
  "ids": [
    "hero.title",
    "feature.chat"
  ],
  "include_children": true
}
```

---

## design_create

Prefer batch creation.

```json
{
  "objects": [
    {
      "type": "txt",
      "id": "hero.title",
      "x": 100,
      "y": 80,
      "w": 600,
      "h": 100,
      "style": "h1",
      "text": "@hero.title"
    },
    {
      "type": "img",
      "id": "hero.image",
      "x": 80,
      "y": 220,
      "w": 1200,
      "h": 700,
      "src": "asset:main"
    }
  ]
}
```

---

## design_update

Batch patch objects.

```json
{
  "where": "id^=feature.",
  "set": {
    "preset": "card.dark"
  }
}
```

Or explicit objects:

```json
{
  "patches": [
    {
      "id": "hero.title",
      "set": {
        "x": 120,
        "w": 700
      }
    },
    {
      "id": "hero.body",
      "set": {
        "style": "body.large"
      }
    }
  ]
}
```

---

## design_translate

Optional helper around content bindings.

```json
{
  "source_locale": "en-US",
  "target_locale": "de-DE",
  "keys": [
    "hero.title",
    "hero.body",
    "feature.*"
  ]
}
```

Translation itself may be performed by the LLM; tool persists bindings.

---

## design_insert_asset

```json
{
  "target": "hero.image",
  "asset": "asset:main-screenshot",
  "fit": "contain"
}
```

---

## design_use_widget

```json
{
  "widget": "feature-group",
  "id": "feature.chat",
  "x": 80,
  "y": 180,
  "bindings": {
    "icon": "chat",
    "title": "@feature.chat.title",
    "caption": "@feature.chat.caption",
    "body": "@feature.chat.body"
  }
}
```

---

## design_delete

```json
{
  "where": "id^=legacy."
}
```

or:

```json
{
  "ids": ["old.title", "old.image"]
}
```

---

## design_export

```json
{
  "format": "png",
  "width": 1920,
  "height": 1080,
  "scale": 2,
  "path": "output/store-01.png"
}
```

Also:

```text
svg
json
dsl
```

if supported.

---

# 10. Batch modification model

Batch operations are essential.

Do NOT force the model to perform one tool call per element.

Support:

```json
{
  "where": "widget=feature-group",
  "set": {
    "preset": "feature.dark"
  }
}
```

Support arithmetic transforms:

```json
{
  "where": "id^=features.",
  "transform": {
    "x": "+20",
    "y": "-10",
    "w": "*1.05"
  }
}
```

Support ordered layout operations:

```json
{
  "where": "id^=features.",
  "layout": {
    "type": "grid",
    "cols": 4,
    "gap_x": 24,
    "gap_y": 24,
    "area": {
      "x": 80,
      "y": 160,
      "w": 1760,
      "h": 760
    }
  }
}
```

Support style replacement:

```json
{
  "where": "preset=card.light",
  "replace": {
    "preset": "card.dark"
  }
}
```

Support binding replacement:

```json
{
  "where": "id^=feature.",
  "replace_binding_prefix": {
    "@en.": "@de."
  }
}
```

Support rename:

```json
{
  "rename": {
    "from": "feature.chat",
    "to": "feature.ai-chat"
  }
}
```

Rename must update:

```text
IDs
parent refs
bindings
widget child refs
queries if stored
```

---

# 11. Transaction support

All batch modifications should be transactional.

Tool request:

```json
{
  "transaction": true,
  "operations": [
    {
      "op": "update",
      "where": "widget=feature-group",
      "set": {
        "preset": "feature.dark"
      }
    },
    {
      "op": "layout",
      "where": "id^=features.",
      "layout": {
        "type": "grid",
        "cols": 4,
        "gap": 24
      }
    }
  ]
}
```

If validation fails:

```text
rollback entire transaction
```

Return:

```json
{
  "ok": false,
  "errors": [
    {
      "operation": 1,
      "id": "features.7",
      "error": "width would become negative"
    }
  ]
}
```

---

# 12. Dry-run / preview

Every destructive/batch tool SHOULD support:

```json
{
  "dry_run": true
}
```

Return diff summary:

```json
{
  "matched": 12,
  "changed": 12,
  "diff": [
    {
      "id": "features.1",
      "preset": {
        "from": "card.light",
        "to": "card.dark"
      }
    }
  ]
}
```

Allow compact summary mode:

```json
{
  "matched": 12,
  "changed": 12,
  "fields": ["preset"]
}
```

---

# 13. Validation

Validate before projecting to Fabric.

Checks:

```text
duplicate IDs
missing parent
missing widget
missing slot
invalid preset
invalid style
invalid asset reference
negative sizes
NaN coordinates
unsupported type
invalid percentage syntax
binding cycles
widget recursion
max nesting depth
out-of-bounds optional warning
text overflow optional warning
```

Return machine-readable validation errors.

Example:

```json
{
  "id": "feature.chat.body",
  "field": "style",
  "code": "UNKNOWN_STYLE",
  "message": "Unknown style 'bodyy'"
}
```

---

# 14. Compact agent editing workflow

Preferred workflow:

```text
1. query
2. inspect only relevant objects
3. batch modify
4. validate
5. optionally render preview
```

Example:

```text
query:
widget=feature-group

→ 12 matches

batch:
set preset=feature.dark

validate

render
```

Avoid sending full design JSON to the LLM unless explicitly requested.

---

# 15. Grep-friendly serialization

Serializer should produce deterministic output.

Rules:

```text
one object declaration per line
stable property ordering
stable object ordering
stable IDs
2-space indent only for widget definitions and text blocks
no insignificant formatting changes
no random UUIDs in visible DSL
```

Recommended property order:

```text
type id
parent=
role=
widget=
x=
y=
w=
h=
preset=
style=
src=
text=
```

Example:

```text
txt hero.title role=title x=1320 y=180 w=480 h=100 style=h1 text=@hero.title
```

This keeps diffs and `rg` queries predictable.

---

# 16. Suggested query examples

Find all headings:

```text
type=txt role=title
```

Find all images:

```text
type=img
```

Find large images:

```text
type=img w>=800
```

Find all objects in feature widgets:

```text
id^=features.
```

Find backgrounds:

```text
role=background
```

Find all dark cards:

```text
preset=card.dark
```

Find all text bound to feature translations:

```text
type=txt text^=@feature.
```

Find images using screenshots:

```text
type=img src*=screenshot
```

---

# 17. Example complete design

```text
canvas main 1920 1080
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
```

---

# 18. Implementation priorities

Implement in this order:

```text
1. parser + serializer
2. normalized IR
3. stable IDs
4. primitive projection to Fabric/OpenDesign
5. query engine
6. batch update engine
7. widget definitions / instances
8. content bindings
9. validation
10. transaction + dry-run
11. export
12. reverse serialization from edited Fabric scene
```

The canonical design source should remain:

```text
compact DSL + IR
```

Fabric/OpenDesign is the renderer/editor projection, not the source of truth.

Main design principle:

> Keep the syntax flat and cheap; keep the internal representation rich and normalized; let widgets provide reusable structure without turning the language into HTML or a programming language.

```
