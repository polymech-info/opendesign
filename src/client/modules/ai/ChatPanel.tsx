import { useChatEngine } from "./useChatEngine";
import { ChatMessages } from "./ChatPanelMessages";
import { applyEmittedDesignTools, designChatBrief, resolveDesignDocument } from "./designTools";
import { useEditor } from "../../context";
import { readObjectId } from "../../lib/object-identity";

/** Sidebar chat — one design brief (tools + scene + selection); host runs emitted tool_calls. */
export function ChatPanel() {
  const { applyDesignDocument, scheduleSave, selectedObject, activePage, getCanvasJSON } = useEditor();
  const engine = useChatEngine("opend");
  const selectedId = readObjectId(selectedObject);
  const resolveDoc = () => resolveDesignDocument([activePage?.canvas_json, getCanvasJSON()]);
  engine.designContextRef.current = () => {
    const doc = resolveDoc();
    if (!doc) return null;
    return designChatBrief(doc, { selectionIds: selectedId ? [selectedId] : [] });
  };
  engine.runDesignToolsRef.current = (text) => {
    const doc = resolveDoc();
    return applyEmittedDesignTools(text, doc, {
      onChange: (next) => {
        void applyDesignDocument(next).then(() => scheduleSave());
      },
    });
  };
  return (
    <div class="flex flex-col h-full min-h-0 min-w-0">
      <ChatMessages engine={engine} />
    </div>
  );
}

export { ChatMessages };
export default ChatPanel;
