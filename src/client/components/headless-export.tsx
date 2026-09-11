import { useEffect, useRef } from "preact/hooks";
import * as fabric from "fabric";
import { listCanvasAssets, loadFabricJSON, parseFabricJSON } from "../lib/fabric-json";
import { canvasToPngDataUrl } from "../lib/export-png";
import type { DesignWithPages } from "../types";

function queryNum(key: string, fallback: number) {
  const raw = new URLSearchParams(window.location.search).get(key);
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

async function probeAsset(src: string) {
  const t0 = performance.now();
  try {
    const res = await fetch(src, { cache: "no-store" });
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    const ms = Math.round(performance.now() - t0);
    return { ok: res.ok, status: res.status, bytes, ms, error: res.ok ? "" : res.statusText || "missing" };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      bytes: 0,
      ms: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function HeadlessExport({ designId }: { designId: string }) {
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || "";
    const pageN = Math.max(1, Math.floor(queryNum("page", 1)));
    const scale = queryNum("scale", 2);
    const lines: string[] = [];

    const post = async (body: BodyInit, type: string) => {
      await fetch(`/api/export-jobs/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": type },
        body,
      });
    };

    const log = async (line: string) => {
      lines.push(line);
      if (!token) return;
      await fetch(`/api/export-jobs/${encodeURIComponent(token)}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line }),
      }).catch(() => undefined);
    };

    const fail = async (message: string) => {
      await log(`FAILED  ${message}`);
      await post(JSON.stringify({ error: message, logs: lines }), "application/json");
    };

    void (async () => {
      try {
        if (!token) throw new Error("missing export token");
        await log(`load design ${designId}  page ${pageN}  scale ${scale}`);
        await Promise.race([
          document.fonts.ready,
          new Promise((r) => setTimeout(r, 4000)),
        ]);
        const res = await fetch(`/api/designs/${encodeURIComponent(designId)}`);
        if (!res.ok) throw new Error(`design not found (${res.status})`);
        const design = (await res.json()) as DesignWithPages;
        const pages = [...(design.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        const page = pages[pageN - 1];
        const json = page?.canvas_json || design.canvas_json || "{}";
        const width = design.width || 1080;
        const height = design.height || 1080;
        await log(`design "${design.name}"  ${width}×${height}  ${pages.length} page(s)`);

        const parsed = parseFabricJSON(json);
        const assets = listCanvasAssets(parsed);
        await log(`${assets.length} remote asset(s) to fetch`);
        let missing = 0;
        for (const asset of assets) {
          const probe = await probeAsset(asset.src);
          const label = asset.id ? `${asset.kind} ${asset.id}` : asset.kind;
          if (probe.ok) {
            await log(`ok       ${label}  ${asset.src}  ${probe.status}  ${formatBytes(probe.bytes)}  ${probe.ms}ms`);
          } else {
            missing += 1;
            await log(
              `MISSING  ${label}  ${asset.src}  ${probe.status || "error"}  ${probe.error}  ${probe.ms}ms`
            );
          }
        }
        if (!assets.length) await log("no remote images/icons (inline data URLs only)");

        const pendingLogs: Promise<void>[] = [];
        const warn = (message: string) => {
          missing += 1;
          pendingLogs.push(log(`MISSING  ${message}`));
        };
        const el = document.createElement("canvas");
        const canvas = new fabric.StaticCanvas(el, {
          width,
          height,
          backgroundColor: "#ffffff",
        });
        await loadFabricJSON(canvas, json, { onWarn: warn });
        await Promise.all(pendingLogs);
        const objects = canvas.getObjects();
        await log(`canvas objects ${objects.length}  (bg images ${objects.filter((o) => (o as { _isBgImage?: boolean })._isBgImage).length})`);
        const dataUrl = canvasToPngDataUrl(canvas, scale);
        canvas.dispose();

        if (missing) await log(`export finished with ${missing} missing asset(s)`);
        else await log("export finished, all assets loaded");

        const blob = await (await fetch(dataUrl)).blob();
        await post(blob, "image/png");
      } catch (err) {
        await fail(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [designId]);

  return <div style={{ background: "#fff", width: "100%", height: "100%" }} />;
}
