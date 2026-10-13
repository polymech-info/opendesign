export const RULER_SIZE = 24;

/** CSS pixel. Physical ruler units use 96px = 1in. */
export const CSS_PX_PER_IN = 96;

export type MeasureUnit = "px" | "mm" | "cm" | "in" | "%";

export const MEASURE_UNITS: MeasureUnit[] = ["px", "mm", "cm", "in", "%"];

let measureUnit: MeasureUnit = "px";
const measureUnitListeners = new Set<(unit: MeasureUnit) => void>();

export function publishMeasureUnit(unit: MeasureUnit) {
  if (unit === measureUnit) return;
  measureUnit = unit;
  for (const listener of measureUnitListeners) listener(unit);
}

export function subscribeMeasureUnit(listener: (unit: MeasureUnit) => void) {
  measureUnitListeners.add(listener);
  listener(measureUnit);
  return () => {
    measureUnitListeners.delete(listener);
  };
}

export function pxPerMeasure(unit: MeasureUnit, span: number): number {
  if (unit === "in") return CSS_PX_PER_IN;
  if (unit === "cm") return CSS_PX_PER_IN / 2.54;
  if (unit === "mm") return CSS_PX_PER_IN / 25.4;
  if (unit === "%") return span > 0 ? span / 100 : 0;
  return 1;
}

const MIN_MAJOR_PX = 56;

export type RulerTick = {
  at: number;
  major: boolean;
  label: string | null;
  /** Canvas half, 50%. Drawn heavier than the other percent ticks. */
  half?: boolean;
};

export type RulerTheme = {
  major: string;
  minor: string;
  label: string;
};

/** Nice 1-2-5 step so major ticks stay at least ~56 screen px apart. */
export function rulerMajorStep(zoom: number): number {
  if (!(zoom > 0)) return 100;
  const raw = MIN_MAJOR_PX / zoom;
  const exp = Math.floor(Math.log10(raw));
  const pow = 10 ** exp;
  const n = raw / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * pow;
}

export function rulerMinorStep(major: number): number {
  if (!(major > 0)) return 1;
  const fifth = major / 5;
  if (Number.isInteger(fifth) && fifth > 0) return fifth;
  const half = major / 2;
  if (Number.isInteger(half) && half > 0) return half;
  return major;
}

export function formatRulerLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

export function formatMeasure(value: number, unit: MeasureUnit): string {
  const digits = unit === "cm" || unit === "in" ? 2 : 1;
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  if (rounded === 0) return "0";
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

export function formatDesignLength(px: number, unit: MeasureUnit, span: number): string {
  const per = pxPerMeasure(unit, span);
  if (!(per > 0)) return formatMeasure(px, "px");
  return formatMeasure(px / per, unit);
}

/** Parse a typed length in `unit`. Empty or unfinished input returns null so the field can revert. */
export function parseDesignLength(raw: string, unit: MeasureUnit, span: number): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text || text === "-" || text === "." || text === "-.") return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  const per = pxPerMeasure(unit, span);
  if (!(per > 0)) return null;
  return value * per;
}

function rememberStop(stops: Set<number>, span: number, value: number) {
  if (!Number.isFinite(value)) return;
  const at = Math.round(value * 100) / 100;
  if (at < -0.01 || at > span + 0.01) return;
  stops.add(Math.min(span, Math.max(0, at)));
}

/** Markers, divisions, division halves, canvas edges, canvas center, and construction lines. */
export function rulerSnapStops(span: number, zoom: number, lines: number[], unit: MeasureUnit = "px"): number[] {
  if (!(span > 0)) return [];
  const stops = new Set<number>();
  rememberStop(stops, span, 0);
  rememberStop(stops, span, span);
  rememberStop(stops, span, span / 2);
  const ticks = rulerTicks(span, zoom, unit);
  for (let i = 0; i < ticks.length; i++) {
    rememberStop(stops, span, ticks[i].at);
    // Percent halves are the canvas center. Midpoints of the 2% ticks land on 47, 49, …
    if (unit !== "%" && i + 1 < ticks.length) rememberStop(stops, span, (ticks[i].at + ticks[i + 1].at) / 2);
  }
  const sorted = lines.filter((v) => v >= 0 && v <= span).sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    rememberStop(stops, span, sorted[i]);
    if (i + 1 < sorted.length) rememberStop(stops, span, (sorted[i] + sorted[i + 1]) / 2);
  }
  return [...stops];
}

/** Snap to the nearest stop within `screenPx` screen pixels. Otherwise keep `value`. */
export function snapToStops(value: number, stops: number[], zoom: number, screenPx = 8): number {
  if (!(zoom > 0) || stops.length === 0) return value;
  const tol = screenPx / zoom;
  let best: number | null = null;
  let bestD = tol;
  for (const stop of stops) {
    const d = Math.abs(stop - value);
    if (d > tol) continue;
    if (best == null || d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && stop < best)) {
      best = stop;
      bestD = d;
    }
  }
  return best == null ? value : best;
}

/** Snap a design-pixel position. In percent, the canvas half grabs the band around 50%. */
export function snapDesignLength(
  value: number,
  span: number,
  zoom: number,
  lines: number[],
  unit: MeasureUnit = "px",
): number {
  const clamped = Math.min(span, Math.max(0, value));
  if (unit === "%") {
    const per = pxPerMeasure("%", span);
    const reach = (rulerMajorStep(per * zoom) * per) / 2;
    if (reach > 0 && Math.abs(clamped - span / 2) <= reach) return span / 2;
  }
  return snapToStops(clamped, rulerSnapStops(span, zoom, lines, unit), zoom);
}

export function rulerTicks(span: number, zoom: number, unit: MeasureUnit = "px"): RulerTick[] {
  if (!(span > 0) || !(zoom > 0)) return [];
  const per = pxPerMeasure(unit, span);
  if (!(per > 0)) return [];
  const major = rulerMajorStep(per * zoom);
  const minor = unit === "px" ? rulerMinorStep(major) : major / 5;
  if (!(minor > 0)) return [];
  const perMajor = Math.max(1, Math.round(major / minor));
  const n = Math.floor(span / (minor * per) + 1e-6);
  const ticks: RulerTick[] = [];
  for (let i = 0; i <= n; i++) {
    const unitAt = i * minor;
    const at = unitAt * per;
    if (at > span + 0.01) break;
    const isMajor = i % perMajor === 0;
    const half = unit === "%" && Math.abs(unitAt - 50) < 0.05;
    ticks.push({
      at,
      major: isMajor || half,
      half,
      label: isMajor || half ? formatMeasure(half ? 50 : unitAt, unit) : null,
    });
  }
  return ticks;
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  opts: { axis: "h" | "v"; span: number; zoom: number; theme: RulerTheme; unit?: MeasureUnit },
) {
  const { axis, span, zoom, theme, unit = "px" } = opts;
  const length = Math.max(1, span * zoom);
  const cross = RULER_SIZE;
  ctx.clearRect(0, 0, axis === "h" ? length : cross, axis === "h" ? cross : length);
  ctx.font = "500 9px Inter, ui-sans-serif, sans-serif";
  ctx.lineWidth = 1;
  const ticks = rulerTicks(span, zoom, unit);
  let labelEnd = -Infinity;
  for (const tick of ticks) {
    const p = tick.at * zoom;
    ctx.strokeStyle = tick.major ? theme.major : theme.minor;
    ctx.lineWidth = tick.half ? 2 : 1;
    ctx.beginPath();
    if (axis === "h") {
      const x = Math.round(p) + 0.5;
      ctx.moveTo(x, tick.half ? 6 : tick.major ? 13 : 18);
      ctx.lineTo(x, cross - 0.5);
    } else {
      const y = Math.round(p) + 0.5;
      ctx.moveTo(tick.half ? 6 : tick.major ? 13 : 18, y);
      ctx.lineTo(cross - 0.5, y);
    }
    ctx.stroke();
    if (!tick.label) continue;
    const textW = ctx.measureText(tick.label).width;
    ctx.fillStyle = theme.label;
    ctx.textBaseline = "middle";
    if (axis === "h") {
      const x = p + 3;
      if (x + textW <= length - 1) {
        if (x < labelEnd) continue;
        ctx.textAlign = "left";
        ctx.fillText(tick.label, x, 7);
        labelEnd = x + textW + 6;
      } else {
        const left = p - 3 - textW;
        if (left < labelEnd) continue;
        ctx.textAlign = "right";
        ctx.fillText(tick.label, p - 3, 7);
        labelEnd = p + 2;
      }
    } else {
      const y = p + 3;
      ctx.save();
      ctx.translate(7, y <= length - 1 - textW ? y : p - 3);
      ctx.rotate(Math.PI / 2);
      if (y + textW <= length - 1) {
        if (y < labelEnd) {
          ctx.restore();
          continue;
        }
        ctx.textAlign = "left";
        ctx.fillText(tick.label, 0, 0);
        labelEnd = y + textW + 6;
      } else {
        const top = p - 3 - textW;
        if (top < labelEnd) {
          ctx.restore();
          continue;
        }
        ctx.textAlign = "right";
        ctx.fillText(tick.label, 0, 0);
        labelEnd = p + 2;
      }
      ctx.restore();
    }
  }
}
