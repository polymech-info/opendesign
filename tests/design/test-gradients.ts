import assert from "node:assert/strict";
import * as fabric from "fabric";

import {
  applyPageBackgroundColor,
  applyPageBackgroundGradient,
  bezierPoint,
  cloneGradient,
  defaultGradient,
  edgeFadeGradient,
  editorStateForObject,
  sideFadeGradient,
  expandStops,
  nearestBezierT,
  parseCssLinear,
  parseStoredGradient,
  readPageBackgroundGradient,
  reverseGradientStops,
  sampleStops,
  sampleT,
  sanitizeGradient,
  stringifyGradient,
  uniqueGradientName,
} from "../../src/client/lib/gradient.ts";
import { parseDsl, serializeDsl } from "../../src/design/index.ts";

const parsed = parseCssLinear("linear-gradient(135deg, #667eea 0%, #764ba2 100%)");
assert.equal(parsed.kind, "linear");
assert.equal(parsed.angle, 135);
assert.equal(parsed.stops.length, 2);
assert.equal(parsed.stops[0].hex, "#667eea");
assert.equal(parsed.stops[0].alpha, 1);
assert.equal(parsed.stops[1].offset, 1);

const withAlpha = parseCssLinear("linear-gradient(90deg, #ff000080 0%, #00ff00 100%)");
assert.ok(withAlpha.stops[0].alpha < 0.6);
assert.equal(withAlpha.stops[0].hex, "#ff0000");

const cycle = sanitizeGradient({
  kind: "cycle",
  origin: { x: 0.25, y: 0.25 },
  scale: 0.5,
  stops: [
    { offset: 0, hex: "#ffffff", alpha: 1 },
    { offset: 1, hex: "#000000", alpha: 0 },
  ],
});
assert.equal(cycle.kind, "cycle");
assert.equal(sampleT(cycle, 0.25, 0.25), 0);
assert.ok(sampleT(cycle, 0.25, 0.75) > 0.7);

const ripple = sanitizeGradient({ ...cycle, kind: "ripple", cycles: 2, scale: 0.5 });
const a = sampleT(ripple, 0.25, 0.25);
const b = sampleT(ripple, 0.25 + 0.5, 0.25);
assert.ok(a < 0.05);
assert.ok(b < 0.05, "ripple wraps back to the start color");

const linear = defaultGradient("linear");
linear.angle = 90;
const mid = sampleT(linear, 0.5, 0.5);
assert.ok(mid > 0.4 && mid < 0.6);

const curve = defaultGradient("bezier").curve;
const p0 = bezierPoint(curve, 0);
assert.ok(Math.abs(p0.x - curve.p0.x) < 1e-6);
const t = nearestBezierT(curve, curve.p1.x, curve.p1.y);
assert.ok(t > 0.85);

const oklch = sanitizeGradient({
  kind: "linear",
  space: "oklch",
  stops: [
    { offset: 0, hex: "#ff0000", alpha: 1 },
    { offset: 1, hex: "#0000ff", alpha: 1 },
  ],
});
const expanded = expandStops(oklch, 12);
assert.ok(expanded.length > 2, "oklch expands intermediate stops");
const midColor = sampleStops(expanded, 0.5);
assert.ok(midColor.b > 20, "oklch mid point is not a muddy sRGB mix");

const cloned = cloneGradient(oklch);
cloned.stops[0].hex = "#111111";
assert.equal(oklch.stops[0].hex, "#ff0000");

const named = sanitizeGradient({ name: "  Sunset  ", kind: "linear" });
assert.equal(named.name, "Sunset");
assert.equal(uniqueGradientName("Sunset", [named]), "Sunset 2");
assert.equal(uniqueGradientName("Sunset", [named, sanitizeGradient({ name: "Sunset 2" })]), "Sunset 3");
assert.equal(uniqueGradientName("  ", []), "Gradient");

const faded = edgeFadeGradient();
assert.equal(faded.kind, "cycle");
assert.equal(faded.role, "mask");
assert.equal(faded.stops[faded.stops.length - 1].alpha, 0);
const sides = sideFadeGradient();
assert.equal(sides.kind, "linear");
assert.equal(sides.role, "mask");
assert.equal(sides.angle, 90);
assert.equal(sides.stops[0].alpha, 0);
assert.equal(sides.stops[1].offset, 0.2);
assert.equal(sides.stops[1].alpha, 1);
assert.equal(sides.stops[2].offset, 0.8);
assert.equal(sampleStops(expandStops(sides), sampleT(sides, 0, 0.5)).a, 0);
assert.equal(sampleStops(expandStops(sides), sampleT(sides, 0.5, 0.5)).a, 1);
assert.equal(sampleStops(expandStops(sides), sampleT(sides, 1, 0.5)).a, 0);
const roundtrip = parseStoredGradient(stringifyGradient({ ...faded, role: "mask", stops: [
  { offset: 0, hex: "#112233", alpha: 0.4 },
  { offset: 1, hex: "#abcdef", alpha: 0.8 },
] }));
assert.ok(roundtrip);
assert.equal(roundtrip.role, "mask");
assert.equal(roundtrip.stops[0].hex, "#112233");
assert.equal(roundtrip.stops[0].alpha, 0.4);
assert.equal(roundtrip.kind, "cycle");

const flipped = reverseGradientStops(sanitizeGradient({
  kind: "linear",
  stops: [
    { offset: 0, hex: "#ff0000", alpha: 1 },
    { offset: 0.25, hex: "#00ff00", alpha: 0.5 },
    { offset: 1, hex: "#0000ff", alpha: 0 },
  ],
}));
assert.equal(flipped.stops[0].hex, "#0000ff");
assert.equal(flipped.stops[0].offset, 0);
assert.equal(flipped.stops[0].alpha, 0);
assert.equal(flipped.stops[1].hex, "#00ff00");
assert.equal(flipped.stops[1].offset, 0.75);
assert.equal(flipped.stops[2].hex, "#ff0000");
assert.equal(flipped.stops[2].alpha, 1);

const opened = editorStateForObject(null, faded, "mask");
assert.equal(opened.role, "mask");
assert.equal(opened.def.kind, "cycle");

const doc = parseDsl(`canvas main 800 600
shape card x=10 y=10 w=120 h=80 fill=#334155
img photo x=10 y=100 w=200 h=120 src=uploads/demo.png
`);
const card = doc.nodes.find((n) => n.id === "card");
const photo = doc.nodes.find((n) => n.id === "img" || n.id === "photo");
assert.ok(card && photo);
card.props.gradient = stringifyGradient({
  ...defaultGradient("linear"),
  role: "fill",
  stops: [
    { offset: 0, hex: "#112233", alpha: 0.4 },
    { offset: 1, hex: "#abcdef", alpha: 0.8 },
  ],
});
photo.props.gradientMask = stringifyGradient(faded);
const again = parseDsl(serializeDsl(doc));
const card2 = again.nodes.find((n) => n.id === "card");
const photo2 = again.nodes.find((n) => n.id === "photo");
assert.ok(card2 && photo2);
const storedFill = parseStoredGradient(card2.props.gradient);
const storedMask = parseStoredGradient(photo2.props.gradientMask);
assert.ok(storedFill && storedMask);
assert.equal(storedFill.role, "fill");
assert.equal(storedFill.stops[0].hex, "#112233");
assert.equal(storedFill.stops[0].alpha, 0.4);
assert.equal(storedMask.role, "mask");
assert.equal(storedMask.kind, "cycle");
assert.equal(storedMask.stops[storedMask.stops.length - 1].alpha, 0);

const pageObjects: fabric.FabricObject[] = [];
const page = {
  backgroundColor: "#ffffff",
  getObjects: () => pageObjects,
  add: (obj: fabric.FabricObject) => {
    pageObjects.push(obj);
  },
  sendObjectToBack: (obj: fabric.FabricObject) => {
    const i = pageObjects.indexOf(obj);
    if (i > 0) {
      pageObjects.splice(i, 1);
      pageObjects.unshift(obj);
    }
  },
  moveObjectTo: () => {},
} as unknown as fabric.StaticCanvas;
const pageFill = sanitizeGradient({
  kind: "linear",
  role: "fill",
  angle: 90,
  stops: [
    { offset: 0, hex: "#112233", alpha: 1 },
    { offset: 1, hex: "#abcdef", alpha: 1 },
  ],
});
applyPageBackgroundGradient(page, pageFill, 200, 120);
const pageStored = readPageBackgroundGradient(page);
assert.ok(pageStored);
assert.equal(pageStored.role, "fill");
assert.equal(pageStored.kind, "linear");
assert.equal(pageStored.stops[0].hex, "#112233");
assert.equal(pageStored.angle, 90);
assert.equal((pageObjects[0] as { _id?: string })._id, "canvas.bg");
applyPageBackgroundColor(page, "#ffffff", 200, 120);
assert.equal(readPageBackgroundGradient(page), null);
assert.equal(page.backgroundColor, "#ffffff");

console.log("test:gradients PASS");
