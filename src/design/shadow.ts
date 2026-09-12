const NAMED_SHADOWS: Record<string, Record<string, unknown>> = {
  soft: { color: "rgba(15, 23, 42, 0.25)", blur: 24, offsetX: 0, offsetY: 12 },
  hard: { color: "#0f172a40", blur: 0, offsetX: 8, offsetY: 8 },
};

function fabricShadow(
  color: string,
  blur: number,
  offsetX: number,
  offsetY: number,
): Record<string, unknown> {
  return {
    color: color || "rgba(15, 23, 42, 0.25)",
    blur: Number.isFinite(blur) ? blur : 0,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    affectStroke: false,
    nonScaling: false,
  };
}

/** Parse shape.props.shadow (JSON object or named preset) into Fabric shadow. */
export function shadowFromProps(props: Record<string, string>): Record<string, unknown> | undefined {
  const raw = props.shadow?.trim();
  if (!raw || raw === "none") return undefined;
  const named = NAMED_SHADOWS[raw.toLowerCase()];
  if (named) return { ...named, affectStroke: false, nonScaling: false };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const color = String(o.color ?? o.colour ?? "");
    const blur = Number(o.blur ?? 0);
    const offsetX = Number(o.offsetX ?? o.x ?? 0);
    const offsetY = Number(o.offsetY ?? o.y ?? 0);
    if (!color && blur <= 0 && offsetX === 0 && offsetY === 0) return undefined;
    return fabricShadow(color, blur, offsetX, offsetY);
  } catch {
    return undefined;
  }
}