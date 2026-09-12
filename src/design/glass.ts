/** Parse shape.props.glass into Fabric _stylePreset extras. */
export function glassFromProps(props: Record<string, string>): {
  enabled: boolean;
  extras: Record<string, unknown>;
} {
  const raw = props.glass?.trim().toLowerCase();
  const enabled = raw === "true" || raw === "1" || raw === "glass";
  if (!enabled) return { enabled: false, extras: {} };
  const extras: Record<string, unknown> = {
    _stylePreset: "glass",
    objectCaching: false,
  };
  const optsRaw = props.glassOptions?.trim();
  if (optsRaw) {
    try {
      extras._glassOptions = JSON.parse(optsRaw);
    } catch {
      /* ignore invalid JSON */
    }
  }
  return { enabled: true, extras };
}
