import { useChatEngine } from "./useChatEngine";
import { ChatMessages } from "./ChatPanelMessages";
import { createDesignTools } from "./designTools";

/** Sidebar chat — messages + composer. Extra tools hook is for a later design DSL. */
export function ChatPanel() {
  const engine = useChatEngine("opend");
  engine.extraToolsRef.current = createDesignTools;
  return (
    <div class="flex flex-col h-full min-h-0 min-w-0">
      <ChatMessages engine={engine} />
    </div>
  );
}

export { ChatMessages };
export default ChatPanel;
