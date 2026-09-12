import { useEffect, useRef } from "preact/hooks";
import { useChatEngine } from "./useChatEngine";
import { ChatMessages } from "./ChatPanelMessages";
import {
  documentFromCanvasJson,
  getActiveDocument,
  latestHostRevisionAfter,
  persistCanvasScreenshot,
  replayHostDesignRuns,
  resolveDesignDocument,
  setActiveDocument,
  takeFreshHostSceneRuns,
  understandPicturePaths,
  writeCliCanvasJson,
} from "./designTools";
import { useEditor } from "../../context";
import { designSelectionIds } from "../../lib/design-selection";
import { selectedCanvasObjects } from "../../lib/object-style";
import { canvasToScreenshotDataUrl } from "../../lib/export-png";
import { pictureUnderstandPath } from "../../../design/upload-paths";
import type { ToolRunRecord } from "./types";

async function putAgentToolSession(body: Record<string, unknown>) {
  try {
    await fetch("/api/agent-tools/session", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* heartbeat is best-effort; the next send retries */
  }
}

/** Sidebar chat — scene brief only. Tanit owns the tool loop. */
export function ChatPanel() {
  const editor = useEditor();
  const { selectedObject, selectionEpoch, canvas, activePage, activeDesign, getCanvasJSON } = editor;
  const engine = useChatEngine("opend");
  const projectRootRef = useRef("");
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    void fetch("/api/meta")
      .then((res) => (res.ok ? res.json() : {}))
      .then((meta: { project?: string }) => {
        if (typeof meta.project === "string" && meta.project.trim()) {
          projectRootRef.current = meta.project.trim();
        }
      })
      .catch(() => {});
  }, []);

  const resolveDoc = () => resolveDesignDocument([getActiveDocument(), getCanvasJSON(), activePage?.canvas_json]);

  const sessionPayload = () => {
    const pages = [...(activeDesign?.pages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const pageIndex = pages.findIndex((p) => p.id === activePage?.id);
    const attachments = [...engine.attachments, ...engine.messages.flatMap((m) => m.images ?? [])]
      .filter((img) => img.src)
      .map((img) => ({ name: img.name, src: img.src! }));
    const objects = selectedCanvasObjects(canvas, selectedObject);
    const doc = resolveDoc();
    const selectionIds = doc ? designSelectionIds(objects, doc) : [];
    const picturePaths = doc
      ? understandPicturePaths(doc, {
          selectionIds,
          projectRoot: projectRootRef.current || undefined,
          attachments,
        })
      : [];
    return {
      design: activeDesign?.id,
      page: pageIndex >= 0 ? pageIndex + 1 : 1,
      selectionIds,
      selectionCount: objects.length,
      projectRoot: projectRootRef.current || undefined,
      attachments,
      picturePaths,
      screenshotPath: undefined as string | undefined,
    };
  };

  engine.onSceneToolsRef.current = async (runs: ToolRunRecord[], seen: Set<string>) => {
    const fresh = takeFreshHostSceneRuns(runs, seen);
    if (!fresh.length) return;
    const {
      patchDesignOnCanvas,
      applyPatchedDocument,
      refreshFromDisk,
      getCanvasJSON: liveJson,
      activePage: page,
      acceptHostRevision,
    } = editorRef.current;
    const doc =
      getActiveDocument() ?? documentFromCanvasJson(liveJson() || page?.canvas_json);
    const accept = () => {
      const live = liveJson();
      acceptHostRevision(
        latestHostRevisionAfter(fresh),
        doc && live && live !== "{}" ? writeCliCanvasJson(live, doc, { source: "agent" }) : undefined,
      );
    };
    if (doc) {
      const { plan, replayed } = replayHostDesignRuns(doc, fresh);
      if (replayed) setActiveDocument(doc);
      if (plan.mode === "patch") {
        const ok = await patchDesignOnCanvas(doc, plan);
        if (ok) {
          accept();
          return;
        }
      }
      if (replayed && (await applyPatchedDocument(doc))) {
        accept();
        return;
      }
    }
    await refreshFromDisk();
  };

  engine.prepareTurnRef.current = async () => {
    const payload = sessionPayload();
    if (canvas) {
      try {
        const saved = await persistCanvasScreenshot(canvasToScreenshotDataUrl(canvas));
        if (saved.ok) {
          payload.screenshotPath =
            pictureUnderstandPath(projectRootRef.current || undefined, saved.path) ?? saved.path;
        }
      } catch {
        /* screenshot is best-effort; design_screenshot reports if missing */
      }
    }
    await putAgentToolSession(payload);
    return { picturePaths: payload.picturePaths };
  };

  useEffect(() => {
    void putAgentToolSession(sessionPayload());
  }, [activeDesign?.id, activePage?.id, selectedObject, selectionEpoch, engine.attachments.length]);

  return (
    <div class="flex flex-col h-full min-h-0 min-w-0">
      <ChatMessages engine={engine} />
    </div>
  );
}

export { ChatMessages };
export default ChatPanel;
