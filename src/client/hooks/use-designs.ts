import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { Design, DesignRevision, DesignVersion, DesignVersionDetail, DesignWithPages, Template, Page } from "../types";
import { api } from "../api";
import { bundledFeatureCardsTemplate } from "../../design/example";
import { documentFromCanvasJson } from "../../design/project";
import { setActiveDocument } from "../../design/tools";
import { shouldReloadInsteadOfSave } from "../../design/apply-host-scene";
import { designNeedsThumbnail } from "../../design/thumbnails";
import { renderDesignThumbnail } from "../lib/design-thumbnail";

function withFeatureCardsTemplate(templates: Template[]): Template[] {
  if (templates.some((t) => t.id === "feature-cards")) return templates;
  return [bundledFeatureCardsTemplate(), ...templates];
}

export function useDesigns(getCanvasJSONForPage: (pageId: string) => string) {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeDesign, setActiveDesign] = useState<Design | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const activePageIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenUpdatedAtRef = useRef<string | null>(null);
  const [diskReloadEpoch, setDiskReloadEpoch] = useState(0);
  const [diskNotice, setDiskNotice] = useState<string | null>(null);
  const [versions, setVersions] = useState<DesignVersion[]>([]);
  const [activeVersionRev, setActiveVersionRev] = useState<number | null>(null);
  const activeVersionRevRef = useRef<number | null>(null);
  const designsRef = useRef<Design[]>([]);
  const thumbsBusyRef = useRef(false);
  const thumbsQueuedRef = useRef(false);

  // Keep activePageIdRef in sync
  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

  useEffect(() => {
    designsRef.current = designs;
  }, [designs]);

  useEffect(() => {
    activeVersionRevRef.current = activeVersionRev;
  }, [activeVersionRev]);

  // Load designs + templates on mount
  useEffect(() => {
    (async () => {
      try {
        const [d, t] = await Promise.all([
          api<Design[]>("GET", "/api/designs"),
          api<Template[]>("GET", "/api/templates"),
        ]);
        setDesigns(d);
        setTemplates(withFeatureCardsTemplate(t));
      } catch (e) {
        console.error("Failed to load data:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refreshThumbnails = useCallback(async () => {
    if (thumbsBusyRef.current) {
      thumbsQueuedRef.current = true;
      return;
    }
    thumbsBusyRef.current = true;
    try {
      do {
        thumbsQueuedRef.current = false;
        for (const design of designsRef.current) {
          if (!designNeedsThumbnail(design)) continue;
          try {
            const image = await renderDesignThumbnail(design.canvas_json, design.width, design.height);
            if (!image) continue;
            if (design.id === activeIdRef.current) continue;
            const updated = await api<Design>("POST", `/api/designs/${design.id}/thumbnail`, { image });
            setDesigns((prev) =>
              prev.map((row) =>
                row.id === updated.id
                  ? { ...row, thumbnail_url: updated.thumbnail_url, thumbnail_at: updated.thumbnail_at }
                  : row,
              ),
            );
          } catch (e) {
            console.warn("Failed to export design thumbnail:", design.id, e);
          }
        }
      } while (thumbsQueuedRef.current);
    } finally {
      thumbsBusyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    void refreshThumbnails();
  }, [loading, refreshThumbnails]);

  const refreshVersions = useCallback(async (id?: string | null) => {
    const designId = id ?? activeIdRef.current;
    if (!designId) {
      setVersions([]);
      return;
    }
    try {
      setVersions(await api<DesignVersion[]>("GET", `/api/designs/${designId}/versions`));
    } catch (e) {
      console.error("Failed to load versions:", e);
    }
  }, []);

  const snapshotVersion = useCallback(
    async (kind: "auto" | "manual", title?: string, description?: string) => {
      const id = activeIdRef.current;
      if (!id) return null;
      try {
        const result = await api<{ version: DesignVersion; created: boolean }>(
          "POST",
          `/api/designs/${id}/versions`,
          { kind, title, description, created_by: "editor" },
        );
        if (result.created) {
          setVersions((prev) => [result.version, ...prev.filter((v) => v.rev !== result.version.rev)]);
        }
        return result;
      } catch (e) {
        console.error("Failed to snapshot version:", e);
        return null;
      }
    },
    [],
  );

  const collectPagePayload = useCallback(() => {
    return pages.map((page) => {
      const live = getCanvasJSONForPage(page.id);
      return {
        id: page.id,
        canvas_json: live && live !== "{}" ? live : page.canvas_json,
      };
    });
  }, [getCanvasJSONForPage, pages]);

  const reloadFromDisk = useCallback(async (id: string, rev: DesignRevision) => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const d = await api<DesignWithPages>("GET", `/api/designs/${id}`);
    seenUpdatedAtRef.current = d.updated_at;
    setActiveDesign(d);
    setPages(d.pages);
    const page = d.pages.find((p) => p.id === activePageIdRef.current) ?? d.pages[0] ?? null;
    if (page) setActivePageId(page.id);
    setActiveDocument(documentFromCanvasJson(page?.canvas_json));
    setDiskReloadEpoch((n) => n + 1);
    setDiskNotice(rev.updated_by === "cli" ? "Reloaded from CLI" : "Reloaded from disk");
    window.setTimeout(() => setDiskNotice(null), 4000);
  }, []);

  const refreshFromDisk = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      const rev = await api<DesignRevision>("GET", `/api/designs/${id}/revision`);
      await reloadFromDisk(id, rev);
    } catch (e) {
      console.error("Failed to refresh from disk:", e);
    }
  }, [reloadFromDisk]);

  const saveDesign = useCallback(async (opts?: { snapshot?: boolean }) => {
    if (!activeIdRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaving(true);
    try {
      if (activeVersionRevRef.current == null) {
        const rev = await api<DesignRevision>("GET", `/api/designs/${activeIdRef.current}/revision`);
        if (shouldReloadInsteadOfSave(rev, seenUpdatedAtRef.current)) {
          await reloadFromDisk(activeIdRef.current, rev);
          return;
        }
      }
      const pagePayload = collectPagePayload();
      const firstPageJson = pagePayload[0]?.canvas_json ?? "{}";
      const viewingRev = activeVersionRevRef.current;
      if (viewingRev != null) {
        await api<DesignVersionDetail>("PUT", `/api/designs/${activeIdRef.current}/versions/${viewingRev}`, {
          canvas_json: firstPageJson,
          pages: pagePayload,
        });
        setPages((prev) =>
          prev.map((page) => {
            const hit = pagePayload.find((row) => row.id === page.id);
            return hit ? { ...page, canvas_json: hit.canvas_json } : page;
          }),
        );
        return;
      }
      for (const page of pagePayload) {
        if (!page.canvas_json || page.canvas_json === "{}") continue;
        const updatedPage = await api<Page>("PUT", `/api/pages/${page.id}`, {
          canvas_json: page.canvas_json,
        });
        setPages((prev) => prev.map((p) => (p.id === updatedPage.id ? updatedPage : p)));
      }
      const updated = await api<Design>("PUT", `/api/designs/${activeIdRef.current}`, {
        canvas_json: firstPageJson,
      });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActiveDesign(updated);
      seenUpdatedAtRef.current = updated.updated_at;
      if (opts?.snapshot !== false) await snapshotVersion("auto");
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  }, [collectPagePayload, reloadFromDisk, snapshotVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void saveDesign();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveDesign]);

  const createDesign = useCallback(async (size?: { width: number; height: number }): Promise<string | undefined> => {
    try {
      const d = await api<Design>("POST", "/api/designs", {
        name: "Untitled Design",
        canvas_json: "{}",
        width: size?.width,
        height: size?.height,
      });
      const full = await api<DesignWithPages>("GET", `/api/designs/${d.id}`);
      setDesigns((prev) => [d, ...prev.filter((x) => x.id !== d.id)]);
      setActiveDesign(full);
      activeIdRef.current = full.id;
      setActiveVersionRev(null);
      setPages(full.pages);
      setActivePageId(full.pages[0]?.id ?? null);
      return full.id;
    } catch (e) {
      console.error("Failed to create design:", e);
    }
  }, []);

  const createFromTemplate = useCallback(async (template: Template): Promise<string | undefined> => {
    try {
      const d = await api<Design>("POST", "/api/designs", {
        name: template.name,
        canvas_json: template.canvas_json,
        width: template.width,
        height: template.height,
      });
      const full = await api<DesignWithPages>("GET", `/api/designs/${d.id}`);
      setDesigns((prev) => [d, ...prev.filter((x) => x.id !== d.id)]);
      setActiveDesign(full);
      activeIdRef.current = full.id;
      setActiveVersionRev(null);
      setPages(full.pages);
      setActivePageId(full.pages[0]?.id ?? null);
      return full.id;
    } catch (e) {
      console.error("Failed to create from template:", e);
    }
  }, []);

  const loadDesign = useCallback(
    async (id: string) => {
      try {
        const d = await api<DesignWithPages>("GET", `/api/designs/${id}`);
        setActiveDesign(d);
        activeIdRef.current = d.id;
        seenUpdatedAtRef.current = d.updated_at;
        setPages(d.pages);
        if (d.pages.length > 0) {
          setActivePageId(d.pages[0].id);
        } else {
          setActivePageId(null);
        }
        setActiveVersionRev(null);
        await refreshVersions(d.id);
      } catch (e) {
        console.error("Failed to load design:", e);
      }
    },
    [refreshVersions]
  );

  const acceptHostRevision = useCallback((updatedAt?: string, canvasJson?: string) => {
    if (updatedAt?.trim()) seenUpdatedAtRef.current = updatedAt.trim();
    const pageId = activePageIdRef.current;
    if (!pageId || !canvasJson || canvasJson === "{}") return;
    setPages((prev) => prev.map((page) => (page.id === pageId ? { ...page, canvas_json: canvasJson } : page)));
    setActiveDesign((prev) =>
      prev
        ? {
            ...prev,
            canvas_json: canvasJson,
            ...(updatedAt?.trim() ? { updated_at: updatedAt.trim() } : {}),
          }
        : prev,
    );
  }, []);

  const flashNotice = useCallback((message: string) => {
    setDiskNotice(message);
    window.setTimeout(() => setDiskNotice(null), 4000);
  }, []);

  const applyCheckout = useCallback((nextPages: Page[], notice: string | null) => {
    setPages(nextPages);
    const page = nextPages.find((p) => p.id === activePageIdRef.current) ?? nextPages[0] ?? null;
    if (page) setActivePageId(page.id);
    setActiveDocument(documentFromCanvasJson(page?.canvas_json));
    setDiskReloadEpoch((n) => n + 1);
    if (notice) flashNotice(notice);
  }, [flashNotice]);

  const switchVersion = useCallback(
    async (rev: number | null) => {
      const id = activeIdRef.current;
      if (!id || rev === activeVersionRevRef.current) return;
      await saveDesign({ snapshot: false });
      try {
        if (rev == null) {
          const d = await api<DesignWithPages>("GET", `/api/designs/${id}`);
          seenUpdatedAtRef.current = d.updated_at;
          setActiveDesign(d);
          setActiveVersionRev(null);
          applyCheckout(d.pages, "Current");
          return;
        }
        const version = await api<DesignVersionDetail>("GET", `/api/designs/${id}/versions/${rev}`);
        setActiveVersionRev(rev);
        applyCheckout(version.pages?.length ? version.pages : [{
          id: activePageIdRef.current ?? `${id}-page`,
          design_id: id,
          title: "Page 1",
          canvas_json: version.canvas_json,
          sort_order: 0,
          created_at: version.created_at,
        }], `#${rev}`);
      } catch (e) {
        console.error("Failed to switch version:", e);
      }
    },
    [applyCheckout, saveDesign],
  );

  const saveVersion = useCallback(
    async (description: string) => {
      if (activeVersionRevRef.current != null) await switchVersion(null);
      else await saveDesign({ snapshot: false });
      return snapshotVersion("manual", "", description);
    },
    [saveDesign, snapshotVersion, switchVersion],
  );

  const restoreVersion = useCallback(
    async (rev: number) => {
      const id = activeIdRef.current;
      if (!id) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      try {
        const d = await api<DesignWithPages>("POST", `/api/designs/${id}/versions/${rev}/restore`);
        const { pages: nextPages, ...listed } = d;
        seenUpdatedAtRef.current = listed.updated_at;
        setActiveDesign(listed);
        setDesigns((prev) => prev.map((row) => (row.id === listed.id ? listed : row)));
        setActiveVersionRev(null);
        applyCheckout(nextPages, `Restored #${rev}`);
      } catch (e) {
        console.error("Failed to restore version:", e);
      }
    },
    [applyCheckout],
  );

  const deleteVersion = useCallback(async (rev: number) => {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      if (activeVersionRevRef.current === rev) await switchVersion(null);
      await api<{ ok: boolean }>("DELETE", `/api/designs/${id}/versions/${rev}`);
      setVersions((prev) => prev.filter((v) => v.rev !== rev));
    } catch (e) {
      console.error("Failed to delete version:", e);
    }
  }, [switchVersion]);

  const deleteDesign = useCallback(async (id: string) => {
    try {
      await api<{ ok: boolean }>("DELETE", `/api/designs/${id}`);
      setDesigns((prev) => prev.filter((d) => d.id !== id));
      if (activeIdRef.current === id) {
        setActiveDesign(null);
        activeIdRef.current = null;
        setVersions([]);
      }
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }, []);

  const duplicateDesign = useCallback(async (id: string): Promise<string | undefined> => {
    try {
      if (activeIdRef.current === id && activeVersionRevRef.current == null) {
        await saveDesign({ snapshot: false });
      }
      const full = await api<DesignWithPages>("POST", `/api/designs/${id}/duplicate`);
      const { pages: _pages, ...listed } = full;
      setDesigns((prev) => [listed, ...prev.filter((x) => x.id !== listed.id)]);
      return full.id;
    } catch (e) {
      console.error("Failed to duplicate design:", e);
    }
  }, [saveDesign]);

  const renameDesign = useCallback(async (id: string, name: string) => {
    try {
      const updated = await api<Design>("PUT", `/api/designs/${id}`, { name });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      if (activeIdRef.current === id) {
        setActiveDesign(updated);
        seenUpdatedAtRef.current = updated.updated_at;
      }
    } catch (e) {
      console.error("Failed to rename:", e);
    }
  }, []);

  const setDesignDimensions = useCallback(async (width: number, height: number) => {
    if (!activeIdRef.current) return;
    try {
      const updated = await api<Design>("PUT", `/api/designs/${activeIdRef.current}`, { width, height });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActiveDesign(updated);
      seenUpdatedAtRef.current = updated.updated_at;
    } catch (e) {
      console.error("Failed to update canvas size:", e);
    }
  }, []);

  // ── Page management ─────────────────────────────────────────────────

  const addPage = useCallback(async (afterPageId?: string) => {
    if (!activeIdRef.current) return;
    try {
      const body: Record<string, unknown> = {};
      if (afterPageId) {
        const afterPage = pages.find((p) => p.id === afterPageId);
        if (afterPage) body.after_sort_order = afterPage.sort_order;
      }
      const page = await api<Page>("POST", `/api/designs/${activeIdRef.current}/pages`, body);
      // Re-fetch all pages to get correct sort_order after shifts
      const d = await api<DesignWithPages>("GET", `/api/designs/${activeIdRef.current}`);
      setPages(d.pages);
      setActivePageId(page.id);
    } catch (e) {
      console.error("Failed to add page:", e);
    }
  }, [pages]);

  const duplicatePage = useCallback(
    async (pageId: string) => {
      // Save current canvas state for the page being duplicated
      const json = getCanvasJSONForPage(pageId);
      if (json && json !== "{}") {
        try {
          await api<Page>("PUT", `/api/pages/${pageId}`, { canvas_json: json });
        } catch {
          // best effort
        }
      }
      try {
        const page = await api<Page>("POST", `/api/pages/${pageId}/duplicate`, {});
        // Re-fetch all pages to get correct sort_order
        if (activeIdRef.current) {
          const d = await api<DesignWithPages>("GET", `/api/designs/${activeIdRef.current}`);
          setPages(d.pages);
        }
        setActivePageId(page.id);
      } catch (e) {
        console.error("Failed to duplicate page:", e);
      }
    },
    [getCanvasJSONForPage]
  );

  const deletePage = useCallback(
    async (pageId: string) => {
      try {
        await api<{ ok: boolean }>("DELETE", `/api/pages/${pageId}`);
        const remaining = pages.filter((p) => p.id !== pageId);
        setPages(remaining);
        if (activePageIdRef.current === pageId && remaining.length > 0) {
          setActivePageId(remaining[0].id);
        }
      } catch (e) {
        console.error("Failed to delete page:", e);
      }
    },
    [pages]
  );

  const renamePage = useCallback(async (pageId: string, title: string) => {
    try {
      const updated = await api<Page>("PUT", `/api/pages/${pageId}`, { title });
      setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      console.error("Failed to rename page:", e);
    }
  }, []);

  // switchToPage is now just scrolling + activating — handled by CanvasArea/PagesBar
  const switchToPage = useCallback((pageId: string) => {
    setActivePageId(pageId);
  }, []);

  const activePage = pages.find((p) => p.id === activePageId) ?? null;

  useEffect(() => {
    if (loading) return;
    const tick = async () => {
      const id = activeIdRef.current;
      if (!id || saving) return;
      try {
        const rev = await api<DesignRevision>("GET", `/api/designs/${id}/revision`);
        if (!rev.updated_at) return;
        if (!seenUpdatedAtRef.current) {
          seenUpdatedAtRef.current = rev.updated_at;
          return;
        }
        if (rev.updated_at !== seenUpdatedAtRef.current) {
          if (activeVersionRevRef.current != null) {
            seenUpdatedAtRef.current = rev.updated_at;
            return;
          }
          await reloadFromDisk(id, rev);
        }
      } catch {
        /* server restarting or design deleted */
      }
    };
    const timer = window.setInterval(() => void tick(), 2000);
    return () => window.clearInterval(timer);
  }, [loading, saving, reloadFromDisk]);

  // Auto-save debounced
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveDesign(), 2000);
  }, [saveDesign]);

  return {
    designs,
    templates,
    activeDesign,
    setActiveDesign,
    activeIdRef,
    loading,
    saving,
    createDesign,
    createFromTemplate,
    loadDesign,
    saveDesign,
    deleteDesign,
    duplicateDesign,
    renameDesign,
    setDesignDimensions,
    scheduleSave,
    refreshFromDisk,
    acceptHostRevision,
    refreshThumbnails,
    diskReloadEpoch,
    diskNotice,
    flashNotice,
    versions,
    activeVersionRev,
    refreshVersions,
    saveVersion,
    restoreVersion,
    deleteVersion,
    switchVersion,
    // Pages
    pages,
    activePageId,
    activePage,
    addPage,
    duplicatePage,
    deletePage,
    renamePage,
    switchToPage,
  };
}
