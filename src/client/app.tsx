import { createContext } from "preact";
import { useContext, useEffect, useLayoutEffect } from "preact/hooks";
import { Outlet, useLocation, useParams } from "@tanstack/react-router";
import WebFont from "webfontloader";
import { EditorContext } from "./context";
import { useCanvasState } from "./hooks/use-canvas";
import { useDesigns } from "./hooks/use-designs";
import { useAppNavigate } from "./hooks/use-app-navigate";
import {
  DEFAULT_EDITOR_PANEL,
  designIdFromPath,
  editorHref,
  exportIdFromPath,
} from "./lib/editor-path";
import { Editor } from "./components/editor";
import { HeadlessExport } from "./components/headless-export";
import { Home } from "./components/home";
import { documentFromCanvasJson } from "../design/project";
import { setActiveDocument } from "../design/tools";

type CanvasState = ReturnType<typeof useCanvasState>;
type DesignState = ReturnType<typeof useDesigns>;

interface SessionValue {
  canvasState: CanvasState;
  designState: DesignState;
  navigate: (to: string) => void;
}

const SessionContext = createContext<SessionValue>(null!);

function useSession() {
  return useContext(SessionContext);
}

function LoadingScreen() {
  return (
    <div class="flex items-center justify-center h-full bg-surface">
      <div class="text-center">
        <div class="spinner !w-6 !h-6 !border-accent/30 !border-t-accent mb-3 mx-auto" />
        <p class="text-fg-muted text-sm">Loading...</p>
      </div>
    </div>
  );
}

export function AppShell() {
  const navigate = useAppNavigate();
  const pathname = useLocation({ select: (l) => l.pathname });
  const canvasState = useCanvasState();
  const designState = useDesigns(canvasState.getCanvasJSONForPage);
  const exportDesignId = exportIdFromPath(pathname);
  const designId = exportDesignId ? null : designIdFromPath(pathname);

  useEffect(() => {
    if (exportDesignId) return;
    WebFont.load({
      google: {
        families: [
          "Inter:400,500,600,700",
          "Playfair Display:400,500,600,700,800,900",
          "Montserrat:400,500,600,700,800,900",
          "Poppins:400,500,600,700",
          "Roboto:400,500,700",
          "Open Sans:400,600,700",
          "Lora:400,700",
          "Raleway:400,500,600",
          "Source Sans Pro:400,600,700",
          "Merriweather:400,700",
        ],
      },
    });
  }, [exportDesignId]);

  useEffect(() => {
    if (exportDesignId) return;
    if (designId && !designState.loading) {
      if (designState.activeDesign?.id !== designId) {
        designState.loadDesign(designId);
      }
    }
  }, [designId, designState.loading]);

  useEffect(() => {
    if (!designId) {
      setActiveDocument(null);
      return;
    }
    const raw = designState.activePage?.canvas_json || designState.activeDesign?.canvas_json;
    setActiveDocument(documentFromCanvasJson(raw));
  }, [designId, designState.activeDesign?.id, designState.activePage?.id]);

  useLayoutEffect(() => {
    if (!designState.activeDesign) return;
    const { width, height } = designState.activeDesign;
    if (width && height && (width !== canvasState.canvasWidth || height !== canvasState.canvasHeight)) {
      canvasState.setCanvasSize(width, height);
    }
  }, [designState.activeDesign]);

  useEffect(() => {
    if (designState.pages.length > 0 && !canvasState.activeCanvasId) {
      canvasState.setActiveCanvas(designState.pages[0].id);
    }
  }, [designState.pages, canvasState.activeCanvasId]);

  useEffect(() => {
    const name = designState.activeDesign?.name?.trim();
    document.title = designId && name ? `${name} · OpenDesign` : "OpenDesign";
    return () => {
      document.title = "OpenDesign";
    };
  }, [designId, designState.activeDesign?.name]);

  return (
    <SessionContext.Provider value={{ canvasState, designState, navigate }}>
      <Outlet />
    </SessionContext.Provider>
  );
}

export function HomePage() {
  const { designState, navigate } = useSession();
  if (designState.loading) return <LoadingScreen />;
  return (
    <Home
      designs={designState.designs}
      templates={designState.templates}
      navigate={navigate}
      createDesign={designState.createDesign}
      deleteDesign={designState.deleteDesign}
      duplicateDesign={designState.duplicateDesign}
      renameDesign={designState.renameDesign}
      createFromTemplate={designState.createFromTemplate}
      refreshThumbnails={designState.refreshThumbnails}
    />
  );
}

export function ExportPage() {
  const { designId } = useParams({ strict: false });
  return <HeadlessExport designId={designId as string} />;
}

export function EditorPage() {
  const { canvasState, designState, navigate } = useSession();
  const { designId } = useParams({ strict: false });
  const waiting = designState.loading || designState.activeDesign?.id !== designId;

  if (waiting && !designState.activeDesign) {
    return <LoadingScreen />;
  }

  const contextValue = {
    ...canvasState,
    ...designState,
    setCanvasSize: (width: number, height: number) => {
      canvasState.setCanvasSize(width, height);
      void designState.setDesignDimensions(width, height);
    },
    activePageId: canvasState.activeCanvasId ?? designState.activePageId,
    navigate,
  };

  return (
    <EditorContext.Provider value={contextValue}>
      <div class="relative h-full">
        <Editor key={designId} />
        {waiting && (
          <div class="absolute inset-0 z-50">
            <LoadingScreen />
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
}
