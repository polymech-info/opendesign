import assert from "node:assert/strict";
import * as fabric from "fabric";

import { applyObjectStyle, applyStyledTextPatch, captureObjectStyle } from "../../src/client/lib/object-style.ts";
import { applyStylePreset, readStylePreset } from "../../src/client/lib/style-presets.ts";

const shadow = new fabric.Shadow({
  color: "rgba(15, 23, 42, 0.4)",
  blur: 18,
  offsetX: 4,
  offsetY: 10,
  affectStroke: false,
  nonScaling: true,
});

const source = new fabric.Rect({
  width: 120,
  height: 80,
  fill: "#f8fafc",
  stroke: "#e2e8f0",
  strokeWidth: 2,
  shadow,
});
applyStylePreset(source, "glass");

const copied = captureObjectStyle(source);
assert.ok(copied.shadow, "glass source still copies the drop shadow");
assert.equal(copied.shadow?.blur, 18);
assert.equal(copied.shadow?.offsetX, 4);
assert.equal(copied.shadow?.offsetY, 10);
assert.equal(copied.shadow?.nonScaling, true);
assert.equal(copied.stylePreset, "glass");
assert.equal(copied.glassOptions.opacity, 1);

const faded = new fabric.Rect({ width: 80, height: 40, fill: "#fff" });
applyStylePreset(faded, "glass");
applyObjectStyle(faded, { ...copied, glassOptions: { ...copied.glassOptions, opacity: 0.4 } });
assert.equal(captureObjectStyle(faded).glassOptions.opacity, 0.4);

const bordered = new fabric.Rect({
  width: 100,
  height: 60,
  fill: "#1e293b",
  stroke: "#38bdf8",
  strokeWidth: 3,
});
applyStylePreset(bordered, "border");
assert.equal(readStylePreset(bordered), "border");
assert.equal(bordered.stroke, "");
assert.equal(bordered.strokeWidth, 0);

applyObjectStyle(bordered, {
  ...captureObjectStyle(bordered),
  stylePreset: "border",
  borderOptions: { kind: "line", width: 4, opacity: 0.5, color: "#f97316" },
});
const lineCopied = captureObjectStyle(bordered);
assert.equal(lineCopied.stylePreset, "border");
assert.equal(lineCopied.borderOptions.kind, "line");
assert.equal(lineCopied.borderOptions.width, 4);
assert.equal(lineCopied.borderOptions.opacity, 0.5);
assert.equal(lineCopied.borderOptions.color, "#f97316");
assert.equal(lineCopied.stroke, "#38bdf8", "copy keeps the native stroke from the overlay backup");
assert.equal(lineCopied.strokeWidth, 3);

const rimTarget = new fabric.Rect({ width: 80, height: 40, fill: "#111827", stroke: "#fff", strokeWidth: 1 });
applyObjectStyle(rimTarget, {
  ...lineCopied,
  borderOptions: { ...lineCopied.borderOptions, kind: "rim", width: 2.5, opacity: 0.8 },
});
assert.equal(readStylePreset(rimTarget), "border");
assert.equal(rimTarget.stroke, "");
const rimCopied = captureObjectStyle(rimTarget);
assert.equal(rimCopied.borderOptions.kind, "rim");
assert.equal(rimCopied.borderOptions.width, 2.5);
assert.equal(rimCopied.borderOptions.opacity, 0.8);

applyObjectStyle(rimTarget, { ...rimCopied, stylePreset: "none" });
assert.equal(readStylePreset(rimTarget), "none");
assert.equal(rimTarget.stroke, "#38bdf8", "leaving border restores the copied native stroke");
assert.equal(rimTarget.strokeWidth, 3);

const target = new fabric.Rect({
  width: 120,
  height: 80,
  fill: "#111827",
  shadow: new fabric.Shadow({ color: "#ff0000", blur: 2, offsetX: 1, offsetY: 1 }),
});
applyStylePreset(target, "glass");
applyObjectStyle(target, copied);

const live = target.shadow as fabric.Shadow | null;
assert.ok(live, "pasted style must keep the source shadow on a glass target");
assert.equal(live.blur, 18);
assert.equal(live.offsetX, 4);
assert.equal(live.offsetY, 10);
assert.equal(live.nonScaling, true);
assert.equal(target.fill, "#f8fafc");

const plain = new fabric.Rect({ width: 80, height: 40, fill: "#fff" });
applyObjectStyle(plain, { ...copied, stylePreset: "none", glassOptions: copied.glassOptions });
const plainShadow = plain.shadow as fabric.Shadow | null;
assert.ok(plainShadow, "shadow still pastes when the preset is none");
assert.equal(plainShadow.blur, 18);

const cleared = captureObjectStyle(new fabric.Rect({ width: 40, height: 40, fill: "#fff" }));
assert.equal(cleared.shadow, null);
applyObjectStyle(plain, cleared);
assert.equal(plain.shadow, null, "pasting a style without shadow clears the target shadow");

function fakeText(init: {
  styles?: Record<string, Record<string, Record<string, unknown>>>;
  isEditing?: boolean;
  selectionStart?: number;
  selectionEnd?: number;
}) {
  const styles = init.styles ?? {};
  const calls: Array<{ patch: Record<string, unknown>; start: number; end: number }> = [];
  return {
    styles,
    isEditing: init.isEditing ?? false,
    selectionStart: init.selectionStart ?? 0,
    selectionEnd: init.selectionEnd ?? 0,
    dirty: false,
    calls,
    removeStyle(property: string) {
      for (const lineNum of Object.keys(styles)) {
        const line = styles[lineNum];
        for (const charNum of Object.keys(line)) {
          delete line[charNum][property];
          if (Object.keys(line[charNum]).length === 0) delete line[charNum];
        }
        if (Object.keys(line).length === 0) delete styles[lineNum];
      }
    },
    setSelectionStyles(patch: object, start: number, end: number) {
      calls.push({ patch: { ...(patch as Record<string, unknown>) }, start, end });
    },
  };
}

const leftover = fakeText({
  styles: {
    2: { 0: { fontSize: 27, fontFamily: "Poppins" } },
    3: { 0: { fontSize: 27, fontFamily: "Poppins" } },
  },
});
applyStyledTextPatch(leftover, { fontSize: 40, fontFamily: "Inter" });
assert.deepEqual(leftover.styles, {});
assert.equal(leftover.dirty, true);
assert.equal(leftover.calls.length, 0);

const selected = fakeText({
  isEditing: true,
  selectionStart: 0,
  selectionEnd: 5,
  styles: { 1: { 0: { fontSize: 12 } } },
});
applyStyledTextPatch(selected, { fontSize: 30 });
assert.deepEqual(selected.calls, [{ patch: { fontSize: 30 }, start: 0, end: 5 }]);
assert.deepEqual(selected.styles, { 1: { 0: { fontSize: 12 } } }, "in-edit range keeps other rows");

console.log("test:object-style PASS");
