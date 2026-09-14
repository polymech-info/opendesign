import { useCallback } from "preact/hooks";
import { useNavigate, useParams } from "@tanstack/react-router";
import { parseEditorPanel, type EditorPanel } from "../lib/editor-path";

export function useAppNavigate() {
  const navigate = useNavigate();
  return useCallback((to: string) => {
    void navigate({ href: to, resetScroll: false });
  }, [navigate]);
}

export function useRouteDesignId(): string | undefined {
  const params = useParams({ strict: false });
  return typeof params.designId === "string" ? params.designId : undefined;
}

export function useRoutePanel(): EditorPanel | null {
  const params = useParams({ strict: false });
  return parseEditorPanel(typeof params.panel === "string" ? params.panel : undefined);
}
