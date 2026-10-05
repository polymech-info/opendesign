import assert from "node:assert/strict";

import { buildJpegPdf, jpegPixelSize, pdfBytesFromDataUrl, pdfToDataUrl } from "../../src/shared/pdf-from-jpeg.ts";
import { pdfPageSize } from "../../src/shared/pdf-page-size.ts";

const a4 = pdfPageSize(794, 1123);
assert.equal(a4.paper, "A4");
assert.ok(Math.abs(a4.width - 595.28) < 0.02, "A4 width in points");
assert.ok(Math.abs(a4.height - 841.89) < 0.02, "A4 height in points");

const a5 = pdfPageSize(559, 794);
assert.equal(a5.paper, "A5");
assert.ok(Math.abs(a5.width - 419.53) < 0.02);

const a6 = pdfPageSize(397, 559);
assert.equal(a6.paper, "A6");
assert.ok(Math.abs(a6.width - 297.64) < 0.02);

const a4land = pdfPageSize(1123, 794);
assert.equal(a4land.paper, "A4");
assert.ok(a4land.width > a4land.height, "landscape A4 flips the media box");

const hd = pdfPageSize(1920, 1080);
assert.equal(hd.paper, undefined);
assert.equal(hd.width, 1440);
assert.equal(hd.height, 810);

const jpeg = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x02, 0x00, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);
assert.deepEqual(jpegPixelSize(jpeg), { width: 3, height: 2 });

const pdf = buildJpegPdf([
  { jpeg, imageWidth: 3, imageHeight: 2, pageWidth: a4.width, pageHeight: a4.height },
]);
const text = Buffer.from(pdf).toString("latin1");
assert.ok(text.startsWith("%PDF-1.4"));
assert.ok(text.includes("/DCTDecode"));
assert.ok(text.includes("/MediaBox [0 0 595.28 841.89]"));
assert.ok(text.includes("%%EOF"));

const url = pdfToDataUrl(pdf);
assert.ok(url.startsWith("data:application/pdf;base64,"));
const roundtrip = pdfBytesFromDataUrl(url);
assert.ok(roundtrip);
assert.equal(roundtrip.length, pdf.length);

console.log("test-pdf-export: ok");
