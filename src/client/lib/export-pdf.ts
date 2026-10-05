import * as fabric from "fabric";
import { canvasToDataUrl } from "./export-png";
import { buildJpegPdf, jpegBytesFromDataUrl, jpegPixelSize, pdfToDataUrl } from "../../shared/pdf-from-jpeg";
import { pdfPageSize } from "../../shared/pdf-page-size";

export function canvasToPdfBytes(
  canvas: fabric.StaticCanvas,
  sceneWidth: number,
  sceneHeight: number,
  multiplier = 2
): Uint8Array {
  const dataURL = canvasToDataUrl(canvas, { format: "jpeg", multiplier, quality: 0.92 });
  const jpeg = jpegBytesFromDataUrl(dataURL);
  if (!jpeg) throw new Error("Could not encode the canvas as JPEG");
  const pixels = jpegPixelSize(jpeg);
  const page = pdfPageSize(sceneWidth, sceneHeight);
  return buildJpegPdf([
    {
      jpeg,
      imageWidth: pixels?.width ?? Math.max(1, Math.round(sceneWidth * multiplier)),
      imageHeight: pixels?.height ?? Math.max(1, Math.round(sceneHeight * multiplier)),
      pageWidth: page.width,
      pageHeight: page.height,
    },
  ]);
}

export function canvasToPdfDataUrl(
  canvas: fabric.StaticCanvas,
  sceneWidth: number,
  sceneHeight: number,
  multiplier = 2
): string {
  return pdfToDataUrl(canvasToPdfBytes(canvas, sceneWidth, sceneHeight, multiplier));
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  link.href = href;
  link.click();
  URL.revokeObjectURL(href);
}
