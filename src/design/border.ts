/** Parse shape.props.border into Fabric _stylePreset extras. */
export function borderFromProps(props: Record<string, string>): {
  enabled: boolean;
  extras: Record<string, unknown>;
} {
  const raw = props.border?.trim().toLowerCase();
  const kind = raw === "rim" ? "rim" : raw === "line" ? "line" : null;
  const enabled = raw === "true" || raw === "1" || raw === "border" || kind != null;
  if (!enabled) return { enabled: false, extras: {} };

  const extras: Record<string, unknown> = {
    _stylePreset: "border",
    objectCaching: false,
    stroke: "",
    strokeWidth: 0,
  };

  let options: Record<string, unknown> = {};
  const optsRaw = props.borderOptions?.trim();
  if (optsRaw) {
    try {
      const parsed = JSON.parse(optsRaw);
      if (parsed && typeof parsed === "object") options = parsed as Record<string, unknown>;
    } catch {
      /* ignore invalid JSON */
    }
  }
  if (kind) options = { ...options, kind };
  if (Object.keys(options).length) extras._borderOptions = options;
  return { enabled: true, extras };
}
