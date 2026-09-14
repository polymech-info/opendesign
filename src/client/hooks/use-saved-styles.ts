import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";
import type { SavedStyle } from "../types";
import {
  hydrateCopiedStyle,
  serializeCopiedStyle,
  styleSwatchCss,
  type CopiedObjectStyle,
} from "../lib/object-style";

const CHANGED = "opend-styles-changed";
export const CREATE_STYLE_EVENT = "opend-create-style";

function emitChanged() {
  window.dispatchEvent(new Event(CHANGED));
}

export function useSavedStyles() {
  const [styles, setStyles] = useState<SavedStyle[]>([]);

  const refresh = useCallback(async () => {
    try {
      const rows = await api<SavedStyle[]>("GET", "/api/styles");
      setStyles(rows ?? []);
    } catch (err) {
      console.error("Failed to load styles:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(CHANGED, onChanged);
    return () => window.removeEventListener(CHANGED, onChanged);
  }, [refresh]);

  const createStyle = useCallback(async (name: string, style: CopiedObjectStyle) => {
    const row = await api<SavedStyle>("POST", "/api/styles", {
      name: name.trim() || "Style",
      swatch: styleSwatchCss(style),
      style: serializeCopiedStyle(style),
    });
    emitChanged();
    return row;
  }, []);

  const renameStyle = useCallback(async (id: string, name: string) => {
    await api<SavedStyle>("PUT", `/api/styles/${id}`, { name: name.trim() || "Style" });
    emitChanged();
  }, []);

  const deleteStyle = useCallback(async (id: string) => {
    await api("DELETE", `/api/styles/${id}`);
    emitChanged();
  }, []);

  return { styles, refresh, createStyle, renameStyle, deleteStyle };
}

export function styleFromSaved(row: SavedStyle): CopiedObjectStyle | null {
  return hydrateCopiedStyle(row.style);
}
