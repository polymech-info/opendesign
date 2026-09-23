import { useRef, useEffect } from "preact/hooks";
import * as fabric from "fabric";
import { useEditor } from "../context";
import type { Page } from "../types";
import { loadFabricJSON } from "../lib/fabric-json";
import { applyResizeCursors } from "../lib/resize-cursor";

interface PageCanvasProps {
  page: Page;
  isActive: boolean;
  width: number;
  height: number;
}

export function PageCanvas({ page, isActive, width, height }: PageCanvasProps) {
  const { registerCanvas, unregisterCanvas, diskReloadEpoch } = useEditor();
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const loadedEpochRef = useRef(0);

  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;

    const c = new fabric.Canvas(canvasElRef.current, {
      width,
      height,
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
      selection: true,
      controlsAboveOverlay: true,
      fireRightClick: true,
      fireMiddleClick: false,
      stopContextMenu: true,
    });

    // Retina rendering
    const dpr = window.devicePixelRatio || 1;
    c.setDimensions({ width: width * dpr, height: height * dpr }, { cssOnly: false });
    c.setDimensions({ width, height }, { cssOnly: true });
    c.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);

    // Custom control appearance — applied per-object via object:added
    const CONTROL_STYLE = {
      transparentCorners: false,
      borderColor: "#6366f1",
      borderScaleFactor: 1.5,
      padding: 6,
      cornerSize: 14,
      cornerColor: "#ffffff",
      cornerStrokeColor: "#6366f1",
      cornerStyle: "circle" as const,
    };

    // Custom render for corner controls (white circles with accent stroke)
    const renderCircleCorner = (
      ctx: CanvasRenderingContext2D,
      left: number,
      top: number,
      _styleOverride: unknown,
      _fabricObject: fabric.FabricObject,
    ) => {
      const size = 14;
      ctx.save();
      ctx.translate(left, top);
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#6366f1";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // Custom render for side controls (rounded pill handles)
    const renderPillControl = (horizontal: boolean) => {
      return (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        _styleOverride: unknown,
        _fabricObject: fabric.FabricObject,
      ) => {
        const w = horizontal ? 28 : 8;
        const h = horizontal ? 8 : 28;
        ctx.save();
        ctx.translate(left, top);
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, 4);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
    };

    // Apply custom controls to an object
    const applyCustomControls = (obj: fabric.FabricObject) => {
      if ((obj as { _isBgImage?: boolean })._isBgImage) return;
      if ((obj as { _id?: string })._id === "canvas.bg") return;
      obj.set(CONTROL_STYLE);
      const lockAspect = !!(obj as { _isIcon?: boolean })._isIcon;
      if (lockAspect) obj.set({ uniformScaling: true, lockScalingFlip: true });
      applyResizeCursors(obj);
      if (obj.controls) {
        for (const key of ["tl", "tr", "bl", "br"]) {
          if (obj.controls[key]) {
            obj.controls[key].render = renderCircleCorner;
            obj.controls[key].sizeX = 18;
            obj.controls[key].sizeY = 18;
          }
        }
        for (const key of ["mt", "mb", "ml", "mr"]) {
          if (!obj.controls[key]) continue;
          if (lockAspect) {
            obj.controls[key].visible = false;
            continue;
          }
          const horizontal = key === "mt" || key === "mb";
          obj.controls[key].render = renderPillControl(horizontal);
          obj.controls[key].visible = true;
          if (horizontal) {
            obj.controls[key].sizeX = 32;
            obj.controls[key].sizeY = 12;
          } else {
            obj.controls[key].sizeX = 12;
            obj.controls[key].sizeY = 32;
          }
        }
      }
    };

    // Apply to all existing objects
    c.getObjects().forEach(applyCustomControls);

    // Apply to any newly added objects
    c.on("object:added", (e) => {
      if (
        e.target &&
        !(e.target as { _isBgImage?: boolean })._isBgImage &&
        (e.target as { _id?: string })._id !== "canvas.bg"
      ) {
        applyCustomControls(e.target);
      }
    });

    // Load page content
    if (page.canvas_json && page.canvas_json !== "{}") {
      void loadFabricJSON(c, page.canvas_json).then(() => {
        c.getObjects().forEach((o) => {
          if (o.shadow) {
            o.objectCaching = false;
            o.dirty = true;
          }
        });
        c.requestRenderAll();
      });
    }

    fabricRef.current = c;
    registerCanvas(page.id, c);

    return () => {
      unregisterCanvas(page.id);
      c.dispose();
      fabricRef.current = null;
    };
  }, [page.id]);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c || diskReloadEpoch === loadedEpochRef.current) return;
    loadedEpochRef.current = diskReloadEpoch;
    if (!page.canvas_json || page.canvas_json === "{}") return;
    void loadFabricJSON(c, page.canvas_json).then(() => {
      c.getObjects().forEach((o) => {
        if (o.shadow) {
          o.objectCaching = false;
          o.dirty = true;
        }
      });
      c.requestRenderAll();
    });
  }, [diskReloadEpoch, page.canvas_json]);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.setDimensions({ width: width * dpr, height: height * dpr }, { cssOnly: false });
    c.setDimensions({ width, height }, { cssOnly: true });
    c.setViewportTransform([dpr, 0, 0, dpr, 0, 0]);
    c.requestRenderAll();
  }, [width, height]);

  return (
    <div
      class={`shadow-lg rounded-lg overflow-hidden ${isActive ? "ring-2 ring-[#6366f1]" : ""}`}
      style={{ width, height }}
      data-page-canvas={page.id}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
}
