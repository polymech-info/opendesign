import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import type { Design, DesignWithPages, Template, Page } from "../types";
import { api } from "../api";
import { bundledFeatureCardsTemplate } from "../../design/example";

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

  // Keep activePageIdRef in sync
  useEffect(() => {
    activePageIdRef.current = activePageId;
  }, [activePageId]);

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

  const saveDesign = useCallback(async () => {
    if (!activeIdRef.current) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaving(true);
    try {
      // Save all pages' canvas JSON
      const currentPages = pages;
      for (const page of currentPages) {
        const json = getCanvasJSONForPage(page.id);
        if (json && json !== "{}") {
          const updatedPage = await api<Page>("PUT", `/api/pages/${page.id}`, {
            canvas_json: json,
          });
          setPages((prev) => prev.map((p) => (p.id === updatedPage.id ? updatedPage : p)));
        }
      }
      // Also update design's canvas_json with first page for backwards compat
      const firstPageJson = currentPages.length > 0 ? getCanvasJSONForPage(currentPages[0].id) : "{}";
      const updated = await api<Design>("PUT", `/api/designs/${activeIdRef.current}`, {
        canvas_json: firstPageJson,
      });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setActiveDesign(updated);
    } catch (e) {
      console.error("Failed to save:", e);
    } finally {
      setSaving(false);
    }
  }, [getCanvasJSONForPage, pages]);

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
        setPages(d.pages);
        if (d.pages.length > 0) {
          setActivePageId(d.pages[0].id);
        } else {
          setActivePageId(null);
        }
      } catch (e) {
        console.error("Failed to load design:", e);
      }
    },
    []
  );

  const deleteDesign = useCallback(async (id: string) => {
    try {
      await api<{ ok: boolean }>("DELETE", `/api/designs/${id}`);
      setDesigns((prev) => prev.filter((d) => d.id !== id));
      if (activeIdRef.current === id) {
        setActiveDesign(null);
        activeIdRef.current = null;
      }
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  }, []);

  const renameDesign = useCallback(async (id: string, name: string) => {
    try {
      const updated = await api<Design>("PUT", `/api/designs/${id}`, { name });
      setDesigns((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      if (activeIdRef.current === id) setActiveDesign(updated);
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
    renameDesign,
    setDesignDimensions,
    scheduleSave,
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
