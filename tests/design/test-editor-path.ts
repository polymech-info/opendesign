import assert from "node:assert/strict";

import {
  DEFAULT_EDITOR_PANEL,
  designIdFromPath,
  editorHref,
  exportIdFromPath,
  isEditorPanel,
  panelFromPath,
  parseEditorPanel,
} from "../../src/client/lib/editor-path.ts";

const id = "c72c3505-7e53-423d-9972-3383c32057fe";

assert.equal(editorHref(id, "designs"), `/design/${id}/designs`);
assert.equal(editorHref(id, "chat"), `/design/${id}/chat`);
assert.equal(editorHref(id, "templates"), `/design/${id}/templates`);
assert.equal(editorHref(id, null), `/design/${id}`);
assert.equal(editorHref(id), `/design/${id}`);

assert.equal(designIdFromPath(`/design/${id}/designs`), id);
assert.equal(designIdFromPath(`/design/${id}`), id);
assert.equal(designIdFromPath("/"), null);

assert.equal(panelFromPath(`/design/${id}/designs`), "designs");
assert.equal(panelFromPath(`/design/${id}/chat`), "chat");
assert.equal(panelFromPath(`/design/${id}`), null);
assert.equal(panelFromPath(`/design/${id}/not-a-panel`), null);

assert.equal(exportIdFromPath(`/export/${id}`), id);
assert.equal(exportIdFromPath(`/design/${id}`), null);

assert.equal(parseEditorPanel("designs"), "designs");
assert.equal(parseEditorPanel("nope"), null);
assert.equal(isEditorPanel("templates"), true);
assert.equal(DEFAULT_EDITOR_PANEL, "templates");

console.log("test-editor-path: ok");
