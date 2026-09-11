import { useEffect, useMemo, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import {
  filterIconNames,
  ICON_COMPACT_PAGE_SIZE,
  ICON_PAGE_SIZE,
  loadTablerIconNames,
  SUGGESTED_TABLER_ICONS,
  tablerIconUrl,
} from "../lib/tabler-icons";
import {
  ICONIFY_PAGE_SIZE,
  listSavedIcons,
  loadIconifyPreviews,
  searchIconify,
  svgToMaskUrl,
  type IconPick,
  type SavedIcon,
} from "../lib/iconify-icons";

type Tab = "local" | "iconify";

interface Props {
  onPick: (pick: IconPick) => void;
  current?: string;
  compact?: boolean;
}

function IconMask({ src, current }: { src: string; current?: boolean }) {
  const mask = src ? `url("${src}")` : "none";
  return (
    <span
      class={`block w-full h-full ${current ? "bg-accent" : "bg-zinc-700"}`}
      style={{
        WebkitMaskImage: mask,
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
        maskImage: mask,
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
      }}
    />
  );
}

export function IconsPanel({ onPick, current, compact }: Props) {
  const [tab, setTab] = useState<Tab>("local");
  const [names, setNames] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [remote, setRemote] = useState<{ icons: string[]; total: number; error?: string }>({
    icons: [],
    total: 0,
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedIcon[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState("");
  const pageSize = compact ? ICON_COMPACT_PAGE_SIZE : ICON_PAGE_SIZE;
  const iconifyPageSize = ICONIFY_PAGE_SIZE;

  useEffect(() => {
    void loadTablerIconNames().then(setNames);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const load = () => void listSavedIcons().then(setSaved);
    load();
    window.addEventListener("opend-uploads-changed", load);
    return () => window.removeEventListener("opend-uploads-changed", load);
  }, []);

  useEffect(() => {
    if (tab !== "iconify") return;
    if (debounced.length < 2) {
      setRemote({ icons: [], total: 0 });
      setPreviews({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRemote((prev) => ({ ...prev, icons: [], error: undefined }));
    const start = page * iconifyPageSize;
    void searchIconify(debounced, start, iconifyPageSize).then(async (result) => {
      if (cancelled) return;
      setRemote(result);
      if (result.icons.length === 0) {
        setPreviews({});
        setLoading(false);
        return;
      }
      const svgs = await loadIconifyPreviews(result.icons);
      if (cancelled) return;
      setPreviews(svgs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, debounced, page, iconifyPageSize]);

  const suggested = useMemo(
    () => SUGGESTED_TABLER_ICONS.filter((n) => names.includes(n)),
    [names]
  );
  const filtered = useMemo(() => filterIconNames(names, query), [names, query]);
  const isSearch = query.trim().length > 0;
  const browsePool = useMemo(() => {
    const skip = new Set(suggested);
    return names.filter((n) => !skip.has(n));
  }, [names, suggested]);

  const localPageCount = isSearch
    ? Math.max(1, Math.ceil(filtered.length / pageSize))
    : 1 + Math.max(1, Math.ceil(browsePool.length / pageSize));
  const remotePageCount = Math.max(1, Math.ceil(remote.total / iconifyPageSize));
  const savedPageCount = Math.max(1, Math.ceil(saved.length / pageSize));
  const pageCount = tab === "local" ? localPageCount : isSearch ? remotePageCount : savedPageCount;
  const safePage = Math.min(page, pageCount - 1);

  const localVisible = useMemo(() => {
    if (isSearch) {
      const start = safePage * pageSize;
      return filtered.slice(start, start + pageSize);
    }
    if (safePage === 0) return suggested;
    const start = (safePage - 1) * pageSize;
    return browsePool.slice(start, start + pageSize);
  }, [isSearch, safePage, filtered, suggested, browsePool, pageSize]);

  const remoteVisible = remote.icons;

  const savedVisible = useMemo(() => {
    const start = safePage * pageSize;
    return saved.slice(start, start + pageSize);
  }, [saved, safePage, pageSize]);

  const localTotal = isSearch ? filtered.length : names.length;
  const status =
    tab === "local"
      ? isSearch
        ? `${localTotal} matches`
        : safePage === 0
          ? "Suggested"
          : `${localTotal} Tabler icons`
      : isSearch
        ? loading
          ? "Searching Iconify…"
          : remote.error
            ? remote.error
            : `${remote.total} matches — double-click to download`
        : saved.length
          ? `${saved.length} saved in uploads/icons/`
          : "Search Iconify, then double-click to download";

  return (
    <div>
      <div class="flex gap-1 mb-2">
        {(["local", "iconify"] as const).map((id) => (
          <button
            key={id}
            class={`flex-1 text-[10px] py-1 rounded-md border cursor-pointer ${
              tab === id ? "border-accent bg-accent/10 text-zinc-800" : "border-zinc-200 bg-white text-zinc-500"
            }`}
            onClick={() => {
              setTab(id);
              setPage(0);
            }}
          >
            {id === "local" ? "Local" : "Iconify"}
          </button>
        ))}
      </div>
      <input
        class="w-full mb-2 bg-white border border-zinc-200 rounded-md text-xs text-zinc-700 px-2 py-1.5 outline-none focus:border-accent"
        placeholder={tab === "local" ? "Search local icons…" : "Search Iconify…"}
        value={query}
        onInput={(e) => {
          setQuery((e.target as HTMLInputElement).value);
          setPage(0);
        }}
      />
      <p class="text-[10px] text-zinc-400 mb-2 m-0">{status}</p>
      {tab === "local" ? (
        localVisible.length === 0 ? (
          <p class="text-zinc-400 text-[11px]">{names.length === 0 ? "Loading icons…" : "No icons found."}</p>
        ) : (
          <div class={`grid gap-1 ${compact ? "grid-cols-5" : "grid-cols-4"}`}>
            {localVisible.map((name) => (
              <button
                key={name}
                class={`aspect-square rounded-md border cursor-pointer p-1.5 ${
                  current === name
                    ? "border-accent bg-accent/10"
                    : "border-zinc-200 bg-white hover:border-accent hover:bg-accent/5"
                }`}
                title={name.replace(/-/g, " ")}
                onClick={() => onPick({ source: "local", name })}
              >
                <IconMask src={tablerIconUrl(name)} current={current === name} />
              </button>
            ))}
          </div>
        )
      ) : isSearch ? (
        remoteVisible.length === 0 ? (
          <p class="text-zinc-400 text-[11px]">{loading ? "Searching…" : "No icons found."}</p>
        ) : (
          <div class={`grid gap-1 ${compact ? "grid-cols-5" : "grid-cols-4"}`}>
            {remoteVisible.map((id) => {
              const active = current === id || highlight === id;
              return (
              <button
                key={id}
                class={`aspect-square rounded-md border cursor-pointer p-1.5 ${
                  active
                    ? "border-accent bg-accent/10"
                    : "border-zinc-200 bg-white hover:border-accent hover:bg-accent/5"
                }`}
                title={`${id} — double-click to download`}
                onClick={() => setHighlight(id)}
                onDblClick={() => onPick({ source: "iconify", id })}
              >
                <IconMask src={previews[id] ? svgToMaskUrl(previews[id]) : ""} current={active} />
              </button>
              );
            })}
          </div>
        )
      ) : savedVisible.length === 0 ? (
        <p class="text-zinc-400 text-[11px]">Type at least two letters to search 200k+ icons.</p>
      ) : (
        <div class={`grid gap-1 ${compact ? "grid-cols-5" : "grid-cols-4"}`}>
          {savedVisible.map((item) => (
            <button
              key={item.key}
              class={`aspect-square rounded-md border cursor-pointer p-1.5 ${
                current === item.id
                  ? "border-accent bg-accent/10"
                  : "border-zinc-200 bg-white hover:border-accent hover:bg-accent/5"
              }`}
              title={item.id}
              onClick={() => onPick({ source: "saved", name: item.id, url: item.url })}
            >
              <IconMask src={item.url} current={current === item.id} />
            </button>
          ))}
        </div>
      )}
      {pageCount > 1 && (
        <div class="flex items-center justify-between mt-2">
          <button
            class="p-1 rounded border border-zinc-200 bg-white cursor-pointer disabled:opacity-30"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft size={14} />
          </button>
          <span class="text-[10px] text-zinc-400 font-mono">
            {safePage + 1} / {pageCount}
          </span>
          <button
            class="p-1 rounded border border-zinc-200 bg-white cursor-pointer disabled:opacity-30"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
