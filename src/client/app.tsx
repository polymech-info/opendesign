import { EditorContext } from "./context";
import { useCanvasState } from "./hooks/use-canvas";
import { useDesigns } from "./hooks/use-designs";
import { useRouter } from "./hooks/use-router";
import { Editor } from "./components/editor";
import { HeadlessExport } from "./components/headless-export";
import { Home } from "./components/home";
import WebFont from "webfontloader";
import { useEffect, useLayoutEffect } from "preact/hooks";

export function App() {
  const { navigate, designId, exportDesignId } = useRouter();
  const canvasState = useCanvasState();
  const designState = useDesigns(canvasState.getCanvasJSONForPage);

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

  if (exportDesignId) return <HeadlessExport designId={exportDesignId} />;

  if (designState.loading || (designId && designState.activeDesign?.id !== designId)) {
    return (
      <div class="flex items-center justify-center h-full bg-[#F3F4F7]">
        <div class="text-center">
          <div class="spinner !w-6 !h-6 !border-accent/30 !border-t-accent mb-3 mx-auto" />
          <p class="text-zinc-400 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!designId) {
    return (
      <Home
        designs={designState.designs}
        templates={designState.templates}
        navigate={navigate}
        createDesign={designState.createDesign}
        deleteDesign={designState.deleteDesign}
        renameDesign={designState.renameDesign}
        createFromTemplate={designState.createFromTemplate}
      />
    );
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
      <Editor />
    </EditorContext.Provider>
  );
}
