import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { packFromZip, packToZip, parseDesignPack, parsePackBytes } from "../../src/design/design-pack.ts";
import { ensureLayouts, resolveRoots } from "../../src/server/paths.ts";
import { exportDesignPack, importDesignPack } from "../../src/server/design-pack.ts";
import * as store from "../../src/server/store.ts";
import { getUpload, putUploadKey } from "../../src/server/uploads.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opend-pack-"));
process.env.OPEND_GLOBAL = path.join(root, "global");
const srcDir = path.join(root, "src");
const destDir = path.join(root, "dest");

function canvas(src: string) {
  return JSON.stringify({
    objects: [
      { type: "image", src },
      { type: "image", src: "data:image/png;base64,aaaa" },
      { type: "image", _isIcon: true, _iconName: "photo" },
      { type: "image", src: "https://cdn.example/uploads/remote.png" },
    ],
  });
}

try {
  const srcRoots = resolveRoots(srcDir);
  const destRoots = resolveRoots(destDir);
  ensureLayouts(srcRoots);
  ensureLayouts(destRoots);

  const hero = new Uint8Array([1, 2, 3, 4, 5]);
  const bg = new Uint8Array([9, 8, 7]);
  const thumb = new Uint8Array([4, 4, 4, 4]);
  putUploadKey(srcRoots, "uploads/hero.png", hero);
  putUploadKey(srcRoots, "uploads/backgrounds/bg.png", bg);

  const poster = store.createDesign(srcRoots, {
    name: "Poster",
    width: 800,
    height: 600,
    canvas_json: canvas("/api/uploads/file/uploads/hero.png"),
  });
  store.addPage(srcRoots, poster.id, {
    title: "Back",
    canvas_json: canvas("/api/uploads/file/uploads/backgrounds/bg.png"),
  });
  putUploadKey(srcRoots, `uploads/thumbs/${poster.id}.png`, thumb);
  store.setDesignThumbnail(srcRoots, poster.id, `/api/uploads/file/uploads/thumbs/${poster.id}.png`);

  const card = store.createDesign(srcRoots, {
    name: "Card",
    canvas_json: canvas("/api/uploads/file/uploads/hero.png"),
  });
  const broken = store.createDesign(srcRoots, {
    name: "Broken",
    canvas_json: canvas("/api/uploads/file/uploads/gone.png"),
  });

  const pack = await exportDesignPack(srcRoots, [poster.id, card.id, broken.id]);
  assert.equal(pack.format, "opendesign-pack");
  assert.equal(pack.designs.length, 3);
  assert.equal(pack.designs[0]?.pages.length, 2);
  const keys = pack.assets.map((asset) => asset.key).sort();
  assert.deepEqual(keys, [
    "uploads/backgrounds/bg.png",
    "uploads/hero.png",
    `uploads/thumbs/${poster.id}.png`,
  ]);
  assert.equal(keys.filter((key) => key === "uploads/hero.png").length, 1);
  assert.deepEqual(pack.missing, ["uploads/gone.png"]);
  assert.equal(pack.assets.some((asset) => asset.key.includes("tabler")), false);

  const imported = await importDesignPack(destRoots, pack);
  assert.equal(imported.designs.length, 3);
  assert.equal(imported.written, 3);
  assert.equal(imported.reused, 0);
  assert.deepEqual(imported.missing, ["uploads/gone.png"]);
  assert.deepEqual(getUpload(destRoots, "uploads/hero.png")?.data, Buffer.from(hero));
  assert.deepEqual(getUpload(destRoots, "uploads/backgrounds/bg.png")?.data, Buffer.from(bg));

  const copy = store.listDesigns(destRoots).find((design) => design.name === "Poster");
  assert.ok(copy);
  assert.notEqual(copy.id, poster.id);
  const full = store.getDesign(destRoots, copy.id);
  assert.equal(full?.pages.length, 2);
  assert.equal(full?.pages[1]?.title, "Back");
  assert.notEqual(full?.pages[0]?.id, store.getDesign(srcRoots, poster.id)?.pages[0]?.id);
  assert.match(full?.pages[0]?.canvas_json ?? "", /\/api\/uploads\/file\/uploads\/hero\.png/);
  assert.match(full?.thumbnail_url ?? "", /uploads\/thumbs\//);
  assert.equal(store.listDesigns(destRoots).filter((design) => design.name === "Card").length, 1);

  putUploadKey(destRoots, "uploads/hero.png", new Uint8Array([9, 9, 9]));
  const again = await importDesignPack(destRoots, pack);
  assert.equal(again.written, 1);
  assert.equal(again.reused, 2);
  const rewritten = store.getDesign(destRoots, again.designs[0].id);
  assert.match(rewritten?.canvas_json ?? "", /uploads\/hero-import-1\.png/);
  assert.deepEqual(getUpload(destRoots, "uploads/hero.png")?.data, Buffer.from([9, 9, 9]));
  assert.deepEqual(getUpload(destRoots, "uploads/hero-import-1.png")?.data, Buffer.from(hero));
  assert.equal(store.listDesigns(destRoots).length, 6);

  const zipped = packToZip(pack);
  assert.equal(zipped[0], 0x50);
  assert.equal(zipped[1], 0x4b);
  const fromZip = packFromZip(zipped);
  assert.equal(fromZip.designs.length, pack.designs.length);
  assert.deepEqual(
    fromZip.assets.map((asset) => asset.key).sort(),
    pack.assets.map((asset) => asset.key).sort(),
  );
  assert.equal(fromZip.assets.find((asset) => asset.key === "uploads/hero.png")?.data, pack.assets.find((asset) => asset.key === "uploads/hero.png")?.data);
  assert.deepEqual(fromZip.missing, pack.missing);
  assert.equal(parsePackBytes(zipped).format, "opendesign-pack");
  assert.equal(parsePackBytes(new TextEncoder().encode(JSON.stringify(pack))).designs.length, 3);

  assert.throws(() => parseDesignPack({ format: "nope" }), /Not an OpenDesign pack/);

  console.log("test:design-pack PASS");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
