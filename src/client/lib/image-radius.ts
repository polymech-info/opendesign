import * as fabric from "fabric";

export const IMAGE_CORNER_RADIUS_DEFAULT = 24;

export const FABRIC_EXTRA_PROPS = [
  "_layerId",
  "_id",
  "_isBgImage",
  "_designBounds",
  "_cornerRadius",
  "_stylePreset",
  "_stylePresetBackup",
  "_glassOptions",
  "_isIcon",
  "_iconName",
  "_iconUrl",
  "_iconFill",
  "_isElementGroup",
  "_elementName",
  "_elementSource",
  "_sourceW",
  "_sourceH",
] as const;

type ImageWithRadius = fabric.FabricImage & { _cornerRadius?: number };

type RectWithRadius = fabric.Rect & {
  _cornerRadius?: number;
  _rectStrokeSync?: boolean;
};

export function readImageCornerRadius(obj: fabric.FabricObject): number {
  const stored = (obj as ImageWithRadius)._cornerRadius;
  if (typeof stored === "number") return stored;
  return 0;
}

export function readCornerRadius(obj: fabric.FabricObject): number {
  if (obj instanceof fabric.FabricImage) return readImageCornerRadius(obj);
  if (obj instanceof fabric.Rect) {
    const stored = (obj as RectWithRadius)._cornerRadius;
    if (typeof stored === "number") return stored;
    return (obj.rx || 0) * Math.abs(obj.scaleX || 1);
  }
  const stored = (obj as { _cornerRadius?: number })._cornerRadius;
  return typeof stored === "number" ? stored : 0;
}

export function traceRoundRectXY(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number
) {
  const maxRx = Math.max(0, Math.min(rx, w / 2));
  const maxRy = Math.max(0, Math.min(ry, h / 2));
  if (maxRx <= 0 && maxRy <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, { x: maxRx, y: maxRy });
    return;
  }
  const r = Math.min(maxRx, maxRy);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function installRectStrokeSync(rect: fabric.Rect) {
  const tagged = rect as RectWithRadius;
  if (tagged._rectStrokeSync) return;
  tagged._rectStrokeSync = true;
  rect._render = function (this: fabric.Rect, ctx: CanvasRenderingContext2D) {
    const w = this.width || 0;
    const h = this.height || 0;
    if (w <= 0 || h <= 0) return;
    const visual = (this as RectWithRadius)._cornerRadius ?? 0;
    const sx = Math.abs(this.scaleX || 1) || 1;
    const sy = Math.abs(this.scaleY || 1) || 1;
    const fillRx = visual > 0 ? Math.min(visual / sx, w / 2) : this.rx || 0;
    const fillRy = visual > 0 ? Math.min(visual / sy, h / 2) : this.ry || 0;

    const paintFill = () => {
      ctx.beginPath();
      traceRoundRectXY(ctx, -w / 2, -h / 2, w, h, fillRx, fillRy);
      this._renderFill(ctx);
    };

    const paintStroke = () => {
      if (!this.stroke || !this.strokeWidth) return;
      if (this.shadow && !this.shadow.affectStroke) {
        this._removeShadow(ctx);
      }
      const scaling = this.strokeUniform
        ? { x: Math.abs(this.scaleX || 1) || 1, y: Math.abs(this.scaleY || 1) || 1 }
        : { x: 1, y: 1 };
      ctx.save();
      if (this.strokeUniform) ctx.scale(1 / scaling.x, 1 / scaling.y);
      const pw = w * scaling.x;
      const ph = h * scaling.y;
      const pathR = Math.max(0, visual - (this.strokeWidth || 0) / 2);
      ctx.beginPath();
      traceRoundRectXY(
        ctx,
        -pw / 2,
        -ph / 2,
        pw,
        ph,
        Math.min(pathR, pw / 2),
        Math.min(pathR, ph / 2)
      );
      this._setLineDash(ctx, this.strokeDashArray);
      this._setStrokeStyles(ctx, this);
      ctx.stroke();
      ctx.restore();
    };

    if (this.paintFirst === "stroke") {
      paintStroke();
      paintFill();
    } else {
      paintFill();
      paintStroke();
    }
  };
}

export function applyRectCornerRadius(rect: fabric.Rect, radius: number) {
  const w = rect.width || 0;
  const h = rect.height || 0;
  const sx = Math.abs(rect.scaleX || 1) || 1;
  const sy = Math.abs(rect.scaleY || 1) || 1;
  const px = Math.max(0, radius);
  (rect as RectWithRadius)._cornerRadius = px;
  const stroke = Math.max(0, rect.strokeWidth || 0);
  const pathVisual = Math.max(0, px - stroke / 2);
  rect.set({
    rx: px <= 0 ? 0 : Math.min(pathVisual / sx, w / 2),
    ry: px <= 0 ? 0 : Math.min(pathVisual / sy, h / 2),
    strokeUniform: true,
    objectCaching: false,
  });
  installRectStrokeSync(rect);
  rect.dirty = true;
}

export function applyCornerRadius(obj: fabric.FabricObject, radius: number) {
  if (obj instanceof fabric.FabricImage) applyImageCornerRadius(obj, radius);
  else if (obj instanceof fabric.Rect) applyRectCornerRadius(obj, radius);
}

export function applyImageCornerRadius(img: fabric.FabricImage, radius: number) {
  const w = img.width || 0;
  const h = img.height || 0;
  const sx = Math.abs(img.scaleX || 1) || 1;
  const sy = Math.abs(img.scaleY || 1) || 1;
  const px = Math.max(0, radius);
  (img as ImageWithRadius)._cornerRadius = px;

  if (px <= 0 || w <= 0 || h <= 0) {
    img.clipPath = undefined;
    img.dirty = true;
    return;
  }

  const rx = Math.min(px / sx, w / 2);
  const ry = Math.min(px / sy, h / 2);
  // Clip is painted in object-local space, which Fabric always centers at 0,0.
  // Do not offset by originX/originY — that shifts the bitmap 50% after left/top
  // hydrates (user images start as center, IR sync flips origin to left/top).
  img.clipPath = new fabric.Rect({
    width: w,
    height: h,
    rx,
    ry,
    originX: "center",
    originY: "center",
    left: 0,
    top: 0,
    absolutePositioned: false,
    objectCaching: false,
  });
  img.dirty = true;
}

export function restoreImageCornerRadii(canvas: fabric.StaticCanvas | fabric.Canvas) {
  restoreCornerRadii(canvas);
}

export function restoreCornerRadii(root: fabric.StaticCanvas | fabric.Group) {
  for (const obj of root.getObjects()) {
    if (obj instanceof fabric.Group) restoreCornerRadii(obj);
    const stored = (obj as { _cornerRadius?: number })._cornerRadius;
    if (typeof stored !== "number") continue;
    if (obj instanceof fabric.FabricImage) {
      if ((obj as { _isBgImage?: boolean })._isBgImage) continue;
      applyImageCornerRadius(obj, stored);
    } else if (obj instanceof fabric.Rect) {
      applyRectCornerRadius(obj, stored);
    }
  }
}
