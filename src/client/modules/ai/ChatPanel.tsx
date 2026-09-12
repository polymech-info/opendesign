import { useChatEngine, type DesignToolRunContext } from "./useChatEngine";

import { ChatMessages } from "./ChatPanelMessages";

import {

  applyEmittedDesignTools,

  applyEmittedMediaTools,

  designChatBrief,

  getActiveDocument,

  planCanvasApply,

  resolveDesignDocument,

  persistCanvasScreenshot,

  screenshotResultForLog,

  setActiveDocument,

} from "./designTools";

import { snapshotDesignDoc } from "../../../design/journal-snapshot";

import { useEditor } from "../../context";

import * as fabric from "fabric";

import { isBgImage } from "../../lib/background-image";

import { postDesignJournal } from "../../lib/design-journal";

import { readObjectId } from "../../lib/object-identity";
import { designSelectionIds } from "../../lib/design-selection";

import { resolveUploadKey } from "../../../design/upload-paths";



function runOk(result: unknown): boolean {

  return !!(result && typeof result === "object" && (result as { ok?: boolean }).ok !== false);

}



/** Sidebar chat — one design brief (tools + scene + selection); host runs emitted tool_calls. */

export function ChatPanel() {

  const {

    applyDesignDocument,

    patchDesignOnCanvas,

    scheduleSave,

    selectedObject,

    activePage,

    activeDesign,

    getCanvasJSON,

    captureCanvasScreenshot,

  } = useEditor();

  const engine = useChatEngine("opend");

  const resolveDoc = () =>

    resolveDesignDocument([getActiveDocument(), getCanvasJSON(), activePage?.canvas_json]);

  engine.designContextRef.current = () => {

    const doc = resolveDoc();

    if (!doc) return null;

    return designChatBrief(doc, { selectionIds: designSelectionIds(selectedObject, doc) });

  };

  engine.runDesignToolsRef.current = async (text, ctx: DesignToolRunContext) => {

    const resolvedBefore = resolveDoc();

    const docBefore = snapshotDesignDoc(resolvedBefore);

    let selectionId = resolvedBefore
      ? designSelectionIds(selectedObject, resolvedBefore)[0]
      : readObjectId(selectedObject) || undefined;

    let selectionSrcKey: string | undefined;

    if (selectedObject instanceof fabric.FabricImage && !isBgImage(selectedObject)) {

      const src =

        (typeof selectedObject.getSrc === "function" ? selectedObject.getSrc() : "") ||

        ((selectedObject.getElement() as { src?: string } | null)?.src ?? "");

      if (src) selectionSrcKey = resolveUploadKey(src);

    }



    postDesignJournal({

      phase: "parse",

      sessionId: ctx.sessionId,

      messageId: ctx.messageId,

      designId: activeDesign?.id,

      pageId: activePage?.id,

      selection: selectionId ? { id: selectionId, srcKey: selectionSrcKey } : undefined,

      stream: {

        chars: text.length,

        finishReason: ctx.finishReason,

        textTail: text.slice(-400),

      },

      parsed: ctx.parsedCalls.map((c) => ({ name: c.name, arguments: c.arguments })),

      docBefore,

      notes:

        ctx.jsonObjectCount > 1

          ? [`${ctx.jsonObjectCount} JSON blobs in reply — ran parsed design_* batch`]

          : undefined,

    });



    let doc = resolveDoc();

    let dirty = false;

    const mediaRuns = await applyEmittedMediaTools(text, doc, {

      selection: selectionId ? { id: selectionId, srcKey: selectionSrcKey } : undefined,

      onDocChange: (next) => {

        doc = next;

        dirty = true;

      },

    });

    const designRuns = await applyEmittedDesignTools(text, doc, {

      onChange: (next) => {

        doc = next;

        dirty = true;

      },

    });

    const rawRuns = [

      ...mediaRuns.map((row) => ({ name: row.name, result: row.result })),

      ...designRuns,

    ];

    const allRuns: Array<{ name: string; result: unknown }> = [];

    for (const row of rawRuns) {

      const pending = row.result && typeof row.result === "object" && (row.result as { pending?: string }).pending === "canvas";

      if (!pending && row.name !== "design_screenshot") {

        allRuns.push(row);

        continue;

      }

      allRuns.push({ name: row.name, result: await persistCanvasScreenshot(captureCanvasScreenshot()) });

    }



    postDesignJournal({

      phase: "tool-run",

      sessionId: ctx.sessionId,

      messageId: ctx.messageId,

      designId: activeDesign?.id,

      pageId: activePage?.id,

      ran: allRuns.map((row) => ({

        name: row.name,

        ok: runOk(row.result),

        result: screenshotResultForLog(row.name, row.result),

      })),

      docAfter: snapshotDesignDoc(doc),

    });



    if (dirty && doc) {

      setActiveDocument(doc);

      const plan = planCanvasApply(allRuns);

      const journalBase = {

        sessionId: ctx.sessionId,

        messageId: ctx.messageId,

        designId: activeDesign?.id,

        pageId: activePage?.id,

        apply: { mode: plan.mode, plan },

        docAfter: snapshotDesignDoc(doc),

      };



      if (plan.mode === "patch") {

        const ok = await patchDesignOnCanvas(doc, plan);

        postDesignJournal({ phase: "apply", ...journalBase, apply: { mode: plan.mode, plan, patched: ok } });

        // Never full-reload on a missed patch — that ungroups cards, drops live glass, and reinserts DSL ghosts.

        if (!ok) console.warn("[design] in-place patch missed canvas objects", plan);

        scheduleSave();

      } else if (plan.mode === "full") {

        await applyDesignDocument(doc);

        postDesignJournal({ phase: "apply", ...journalBase });

        scheduleSave();

      } else {

        postDesignJournal({ phase: "apply", ...journalBase, notes: ["dirty but no canvas apply"] });

        scheduleSave();

      }

    }

    return allRuns;

  };

  return (

    <div class="flex flex-col h-full min-h-0 min-w-0">

      <ChatMessages engine={engine} />

    </div>

  );

}



export { ChatMessages };

export default ChatPanel;


