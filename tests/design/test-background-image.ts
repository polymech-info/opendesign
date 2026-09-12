import assert from "node:assert/strict";

import { stretchedImageFrame } from "../../src/client/lib/design-images.ts";
import { canvasSceneSize } from "../../src/shared/canvas-json.ts";

const fromDsl = canvasSceneSize({
  _designDsl: "canvas main 1920 1080\ntheme tanit-dark\n",
  objects: [],
});
assert.deepEqual(fromDsl, { width: 1920, height: 1080 });

const fromThemeRect = canvasSceneSize({
  objects: [
    { _id: "canvas.bg", width: 960, height: 540, scaleX: 2, scaleY: 2 },
    { _id: "canvas.photo", width: 1376, height: 768, scaleX: 1, scaleY: 1 },
  ],
});
assert.deepEqual(fromThemeRect, { width: 1920, height: 1080 });

const stretched = stretchedImageFrame(1376, 768, 1920, 1080);
assert.equal(stretched.width, 1376);
assert.equal(stretched.height, 768);
assert.equal(stretched.scaleX, 1920 / 1376);
assert.equal(stretched.scaleY, 1080 / 768);
assert.equal(stretched.width * stretched.scaleX, 1920);
assert.equal(stretched.height * stretched.scaleY, 1080);

console.log("test:background-image PASS");
