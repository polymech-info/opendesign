const HOSTS = [
  "https://api.iconify.design",
  "https://api.simplesvg.com",
  "https://api.unisvg.com",
];

const ICON_ID_RE = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/i;
const MAX_PREVIEW_IDS = 48;
const PREFIX_CONCURRENCY = 2;
const cache = new Map<string, string>();

type IconifyIconBody = {
  body?: string;
  parent?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

type IconifyCollection = {
  icons?: Record<string, IconifyIconBody>;
  aliases?: Record<string, IconifyIconBody>;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

export function parseIconId(id: string): { prefix: string; name: string } | null {
  const trimmed = id.trim();
  if (!ICON_ID_RE.test(trimmed)) return null;
  const colon = trimmed.indexOf(":");
  return { prefix: trimmed.slice(0, colon), name: trimmed.slice(colon + 1) };
}

export function iconFilename(prefix: string, name: string) {
  return `${prefix}--${name}.svg`;
}

function cacheGet(id: string) {
  return cache.get(id) ?? null;
}

function cacheSet(id: string, svg: string) {
  if (cache.size > 500) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(id, svg);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function iconifyFetch(path: string): Promise<Response | null> {
  let rateLimited = false;
  for (const host of HOSTS) {
    try {
      const resp = await fetch(`${host}${path}`, {
        headers: { Accept: "application/json, image/svg+xml" },
      });
      if (resp.ok) return resp;
      if (resp.status === 429 || resp.status === 503) {
        rateLimited = true;
        continue;
      }
      if (resp.status === 404) return resp;
    } catch {
      continue;
    }
  }
  if (rateLimited) {
    await sleep(350);
    try {
      const resp = await fetch(`${HOSTS[0]}${path}`, {
        headers: { Accept: "application/json, image/svg+xml" },
      });
      if (resp.ok || resp.status === 404) return resp;
    } catch {
      return null;
    }
  }
  return null;
}

function svgFromIcon(icon: IconifyIconBody, defaults: IconifyCollection) {
  if (!icon.body) return null;
  const left = icon.left ?? defaults.left ?? 0;
  const top = icon.top ?? defaults.top ?? 0;
  const width = icon.width ?? defaults.width ?? 16;
  const height = icon.height ?? defaults.height ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${icon.body}</svg>`;
}

function resolveIcon(data: IconifyCollection, name: string): IconifyIconBody | null {
  const direct = data.icons?.[name];
  if (direct?.body) return direct;
  const alias = data.aliases?.[name];
  if (!alias) return null;
  if (alias.body) return alias;
  const parentName = alias.parent;
  const parent = parentName ? data.icons?.[parentName] : undefined;
  if (!parent?.body) return null;
  return { ...parent, ...alias, body: parent.body };
}

async function fetchPrefixIcons(prefix: string, names: string[]): Promise<void> {
  const missing = names.filter((name) => !cacheGet(`${prefix}:${name}`));
  if (missing.length === 0) return;
  const path = `/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(missing.join(","))}`;
  const resp = await iconifyFetch(path);
  if (!resp?.ok) return;
  const data = (await resp.json()) as IconifyCollection;
  for (const name of missing) {
    const icon = resolveIcon(data, name);
    const svg = icon ? svgFromIcon(icon, data) : null;
    if (svg) cacheSet(`${prefix}:${name}`, svg);
  }
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await fn(current);
    }
  });
  await Promise.all(workers);
}

export async function fetchIconifySvg(prefix: string, name: string): Promise<string | null> {
  const id = `${prefix}:${name}`;
  const hit = cacheGet(id);
  if (hit) return hit;
  await fetchPrefixIcons(prefix, [name]);
  const cached = cacheGet(id);
  if (cached) return cached;
  const svgResp = await iconifyFetch(
    `/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg?box=1`
  );
  if (!svgResp?.ok) return null;
  const svg = await svgResp.text();
  if (!svg.includes("<svg")) return null;
  cacheSet(id, svg);
  return svg;
}

export async function fetchIconifySvgs(ids: string[]): Promise<Record<string, string>> {
  const parsed = ids
    .slice(0, MAX_PREVIEW_IDS)
    .map((id) => ({ id, parsed: parseIconId(id) }))
    .filter((item): item is { id: string; parsed: { prefix: string; name: string } } => !!item.parsed);

  const byPrefix = new Map<string, string[]>();
  for (const item of parsed) {
    const list = byPrefix.get(item.parsed.prefix) ?? [];
    list.push(item.parsed.name);
    byPrefix.set(item.parsed.prefix, list);
  }

  await mapPool([...byPrefix.entries()], PREFIX_CONCURRENCY, ([prefix, names]) =>
    fetchPrefixIcons(prefix, names)
  );

  const svgs: Record<string, string> = {};
  for (const item of parsed) {
    const svg = cacheGet(item.id);
    if (svg) svgs[item.id] = svg;
  }
  return svgs;
}

export async function searchIconify(
  query: string,
  limit: number,
  start: number
): Promise<
  | { icons: string[]; total: number; limit: number; start: number }
  | { error: string; status: 429 | 502 }
> {
  const resp = await iconifyFetch(
    `/search?query=${encodeURIComponent(query)}&limit=${limit}&start=${start}`
  );
  if (!resp) return { error: "Iconify search failed", status: 502 };
  if (resp.status === 429 || resp.status === 503) {
    return { error: "Iconify is rate-limiting, try again in a moment", status: 429 };
  }
  if (!resp.ok) return { error: "Iconify search failed", status: 502 };
  const data = (await resp.json()) as { icons?: string[]; total?: number; limit?: number; start?: number };
  return {
    icons: Array.isArray(data.icons) ? data.icons : [],
    total: data.total ?? 0,
    limit: data.limit ?? limit,
    start: data.start ?? start,
  };
}
