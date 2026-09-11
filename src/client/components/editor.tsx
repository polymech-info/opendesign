import { useEffect } from "preact/hooks";
import { CanvasArea } from "./canvas-area";
import { Toolbar } from "./toolbar";
import { LeftSidebar } from "./left-sidebar";
import { RightSidebar } from "./right-sidebar";
import { PagesBar } from "./pages-bar";
import { acceptFileDrag } from "../lib/file-drop";

export function Editor() {
  useEffect(() => {
    const allow = (e: DragEvent) => {
      acceptFileDrag(e);
    };
    window.addEventListener("dragover", allow);
    window.addEventListener("drop", allow);
    return () => {
      window.removeEventListener("dragover", allow);
      window.removeEventListener("drop", allow);
    };
  }, []);

  return (
    <div class="flex flex-col h-full w-full">
      <Toolbar />
      <div class="flex flex-1 min-h-0">
        <LeftSidebar />
        <div class="flex-1 flex flex-col min-w-0">
          <CanvasArea />
          <PagesBar />
        </div>
        <RightSidebar />
      </div>
    </div>
  );
}
